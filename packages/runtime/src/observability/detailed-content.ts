// @summary Projects opted-in textual SDK/tool content without inline media or credentials.
export const MAX_DETAIL_BYTES = 262144;
const TRUNCATED = "[TRUNCATED]";
const OMITTED = "[MEDIA OMITTED]";
const CREDENTIAL_KEYS = new Set(
  [
    "xapikey",
    "xauthtoken",
    "xamzsecuritytoken",
    "authorization",
    "proxyauthorization",
    "apikey",
    "accesskey",
    "secretkey",
    "awsaccesskeyid",
    "awssecretaccesskey",
    "accessToken",
    "refreshToken",
    "authtoken",
    "bearertoken",
    "sessiontoken",
    "token",
    "password",
    "passwd",
    "secret",
    "clientsecret",
    "privatekey",
    "credential",
    "credentials",
    "auth",
    "cookie",
    "setcookie",
    "signature",
    "encryptedcontent",
  ].map((key) => key.toLowerCase()),
);
const credentialKey = (key: string) => CREDENTIAL_KEYS.has(key.replace(/[^a-z0-9]/gi, "").toLowerCase());
const RAW_BINARY =
  /^(?:buffer|binary|blob|bytes|bytearray|base64|arraybuffer|sharedarraybuffer|dataview|(?:u?int(?:8|16|32)|uint8clamped|float(?:16|32|64)|big(?:u?int)64)array)$/i;
const BINARY = /^(?:data|base64|bytes|buffer|b64_json)$/i;
const DATA_URI = /\bdata:[^\s"'<>]*/gi;
interface CleanState {
  mask(text: string): string;
  truncated: boolean;
  nodes: number;
}
type JsonObject = Record<string, unknown>;
interface ObservationMessage {
  role: string;
  parts: JsonObject[];
}

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : undefined;
}
function clip(text: string, limit: number): string {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= limit) return text;
  let end = Math.max(0, limit - Buffer.byteLength(TRUNCATED));
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString("utf8") + TRUNCATED;
}
function text(value: string, state: CleanState): string {
  let result = value.replace(DATA_URI, OMITTED);
  if (/^https?:\/\//i.test(result)) {
    try {
      const url = new URL(result);
      if (url.username) url.username = "[REDACTED]";
      if (url.password) url.password = "[REDACTED]";
      for (const key of url.searchParams.keys())
        if (credentialKey(key) || /signature|credential/i.test(key)) url.searchParams.set(key, "[REDACTED]");
      result = url.toString();
    } catch {
      /* Keep non-URL text subject to the normal masker. */
    }
  }
  result = state.mask(result);
  if (Buffer.byteLength(result, "utf8") > MAX_DETAIL_BYTES) {
    state.truncated = true;
    result = clip(result, MAX_DETAIL_BYTES);
  }
  return result;
}
function clean(value: unknown, state: CleanState, depth = 0, media = false, ancestors = new Set<object>()): unknown {
  if (++state.nodes > 20000 || depth > 24) {
    state.truncated = true;
    return TRUNCATED;
  }
  if (typeof value === "string") {
    if (/^[\s]*[[{]/.test(value)) {
      try {
        return JSON.stringify(clean(JSON.parse(value), state, depth + 1, media, ancestors));
      } catch {
        /* Text need not be JSON. */
      }
    }
    return text(value, state);
  }
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return OMITTED;
  if (typeof value !== "object") return undefined;
  if (ancestors.has(value)) {
    state.truncated = true;
    return TRUNCATED;
  }
  const next = new Set(ancestors).add(value);
  if (Array.isArray(value)) {
    if (value.length > 1024) state.truncated = true;
    return value.slice(0, 1024).map((item) => clean(item, state, depth + 1, media, next));
  }
  const source = value as JsonObject;
  if (RAW_BINARY.test(String(source.type ?? source.encoding ?? "").replace(/[^a-z0-9]/gi, ""))) return OMITTED;
  const mediaNode =
    media ||
    /image|audio|blob|base64/i.test(
      String(source.type ?? source.mimeType ?? source.mime_type ?? source.media_type ?? ""),
    );
  const result: JsonObject = {};
  const entries = Object.entries(source);
  if (entries.length > 1024) state.truncated = true;
  for (const [key, item] of entries.slice(0, 1024)) {
    if (credentialKey(key)) result[key] = "[REDACTED]";
    else if (
      (mediaNode && BINARY.test(key)) ||
      RAW_BINARY.test(key.replace(/[^a-z0-9]/gi, "")) ||
      /^(?:b64_json|thinking|reasoning)$/i.test(key)
    )
      result[key] = OMITTED;
    else
      result[key] = clean(
        item,
        state,
        depth + 1,
        mediaNode || /^(?:image|images|audio|audios|outputImages)$/i.test(key),
        next,
      );
  }
  return result;
}
export function sanitizeDetailedValue(
  value: unknown,
  mask: (text: string) => string,
): { value: string; truncated: boolean } {
  const state: CleanState = { mask, truncated: false, nodes: 0 };
  const sanitized = clean(value, state);
  let rendered = typeof sanitized === "string" ? sanitized : (JSON.stringify(sanitized) ?? "");
  if (Buffer.byteLength(rendered) > MAX_DETAIL_BYTES) {
    state.truncated = true;
    rendered =
      typeof sanitized === "string"
        ? clip(rendered, MAX_DETAIL_BYTES)
        : JSON.stringify({ truncated: true, preview: clip(rendered, Math.floor(MAX_DETAIL_BYTES / 4)) });
  }
  return { value: rendered, truncated: state.truncated };
}
function parse(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
function parts(content: unknown, state: CleanState): JsonObject[] {
  if (typeof content === "string") return [{ type: "text", content: text(content, state) }];
  if (!Array.isArray(content))
    return content === undefined
      ? []
      : [{ type: "text", content: text(JSON.stringify(clean(content, state)) ?? "", state) }];
  return content.flatMap((item): JsonObject[] => {
    const block = object(item);
    if (!block) return typeof item === "string" ? [{ type: "text", content: text(item, state) }] : [];
    const kind = String(block.type ?? "");
    if (["text", "input_text", "output_text"].includes(kind))
      return [{ type: "text", content: text(String(block.text ?? block.content ?? ""), state) }];
    if (["thinking", "reasoning", "redacted_thinking"].includes(kind)) return [];
    if (["tool_use", "function_call", "tool_call"].includes(kind))
      return [
        {
          type: "tool_call",
          id: text(String(block.call_id ?? block.id ?? ""), state),
          name: text(String(block.name ?? ""), state),
          arguments: clean(parse(block.arguments ?? block.input), state),
        },
      ];
    if (["tool_result", "function_call_output", "tool_call_response"].includes(kind))
      return [
        {
          type: "tool_call_response",
          id: text(String(block.tool_use_id ?? block.call_id ?? block.id ?? ""), state),
          response: clean(block.response ?? block.content ?? block.output ?? block.result, state),
        },
      ];
    if (/image|audio|blob|uri|file/.test(kind)) {
      const source = object(block.source);
      const image = object(block.image_url);
      const reference =
        block.uri ??
        block.url ??
        block.path ??
        block.filePath ??
        (typeof block.image_url === "string" ? block.image_url : image?.url) ??
        source?.url;
      if (typeof reference === "string" && !reference.startsWith("data:"))
        return [
          {
            type: "uri",
            modality:
              typeof block.modality === "string"
                ? text(block.modality, state)
                : kind.includes("audio")
                  ? "audio"
                  : kind.includes("file") || kind === "uri"
                    ? "file"
                    : "image",
            uri: text(reference, state),
          },
        ];
      if (typeof block.file_id === "string") return [{ type: "file", file_id: text(block.file_id, state) }];
      return [{ type: "text", content: OMITTED }];
    }
    return [];
  });
}
function messages(value: unknown, direction: "input" | "output", state: CleanState): ObservationMessage[] {
  const decoded = parse(value);
  if (typeof decoded === "string")
    return decoded ? [{ role: direction === "input" ? "user" : "assistant", parts: parts(decoded, state) }] : [];
  const root = object(decoded);
  const result: ObservationMessage[] = [];
  if (direction === "input" && root) {
    const system = root.system ?? root.instructions;
    if (system !== undefined) result.push({ role: "system", parts: parts(system, state) });
  }
  const list = Array.isArray(decoded)
    ? decoded
    : root
      ? (root.messages ??
        root.input ??
        root.output ??
        (Array.isArray(root.choices) ? root.choices.map((choice: unknown) => object(choice)?.message) : [root]))
      : [];
  if (typeof list === "string")
    result.push({ role: direction === "input" ? "user" : "assistant", parts: parts(list, state) });
  if (Array.isArray(list) && list.length > 4096) state.truncated = true;
  if (Array.isArray(list))
    for (const item of list.slice(0, 4096)) {
      const message = object(item);
      if (!message) continue;
      const kind = String(message.type ?? "");
      if (["reasoning", "thinking"].includes(kind)) continue;
      if (kind === "function_call") {
        result.push({ role: "assistant", parts: parts([message], state) });
        continue;
      }
      if (kind === "function_call_output") {
        result.push({ role: "tool", parts: parts([message], state) });
        continue;
      }
      const content = message.content ?? message.parts;
      if (content === undefined && !Array.isArray(message.tool_calls)) continue;
      const blocks = Array.isArray(content) ? content : [content];
      const toolResults = blocks.filter((block) =>
        ["tool_result", "tool_call_response"].includes(String(object(block)?.type)),
      );
      for (const block of toolResults) result.push({ role: "tool", parts: parts([block], state) });
      const rest = Array.isArray(content)
        ? blocks.filter((block) => !["tool_result", "tool_call_response"].includes(String(object(block)?.type)))
        : content;
      const resultId = message.tool_call_id ?? (message.role === "function" ? message.name : undefined);
      const mapped =
        (message.role === "tool" || message.role === "function") && typeof resultId === "string"
          ? [{ type: "tool_call_response", id: text(resultId, state), response: clean(content, state) }]
          : parts(rest, state);
      if (Array.isArray(message.tool_calls))
        for (const tool of message.tool_calls) {
          const call = object(tool);
          const fn = object(call?.function);
          if (call && fn)
            mapped.push(
              ...parts([{ type: "function_call", id: call.id, name: fn.name, arguments: fn.arguments }], state),
            );
        }
      const role =
        typeof message.role === "string" && /^(system|developer|user|assistant|tool|function)$/.test(message.role)
          ? message.role === "function"
            ? "tool"
            : message.role
          : direction === "input"
            ? "user"
            : "assistant";
      if (mapped.length) result.push({ role, parts: mapped });
    }
  return result;
}
function indexed(
  attributes: Readonly<Record<string, unknown>>,
  direction: "input" | "output",
  state: CleanState,
): ObservationMessage[] {
  const rows = new Map<number, { role: string; parts: JsonObject[] }>();
  const regex = new RegExp(
    `^llm\\.${direction}_messages\\.(\\d+)\\.message\\.(role|content|contents\\.\\d+\\.message_content\\.(text|image\\.image\\.url))$`,
  );
  for (const [key, value] of Object.entries(attributes)) {
    const match = key.match(regex);
    if (!match || typeof value !== "string") continue;
    const index = Number(match[1]);
    if (index >= 4096) continue;
    const row = rows.get(index) ?? { role: direction === "input" ? "user" : "assistant", parts: [] };
    if (match[2] === "role")
      row.role = /^(system|developer|user|assistant|tool|function)$/.test(value)
        ? value === "function"
          ? "tool"
          : value
        : row.role;
    else if (match[2]?.endsWith("image.image.url"))
      row.parts.push(...parts([{ type: "image_url", image_url: value }], state));
    else row.parts.push({ type: "text", content: text(value, state) });
    rows.set(index, row);
  }
  return [...rows.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, row]) => row)
    .filter((row) => row.parts.length);
}
function boundedMessages(value: ObservationMessage[], state: CleanState, limit = MAX_DETAIL_BYTES): string {
  if (value.length > 256) {
    state.truncated = true;
    value = [value[0]!, ...value.slice(-255)];
  }
  for (const message of value) {
    if (message.parts.length > 1024) {
      state.truncated = true;
      message.parts = message.parts.slice(0, 1024);
    }
  }
  let result = JSON.stringify(value);
  while (Buffer.byteLength(result) > limit) {
    state.truncated = true;
    let longest = { length: 0, object: undefined as JsonObject | undefined, key: "" };
    const visit = (item: unknown) => {
      if (Array.isArray(item)) {
        item.forEach(visit);
        return;
      }
      const record = object(item);
      if (!record) return;
      for (const [key, current] of Object.entries(record)) {
        if (typeof current === "string" && Buffer.byteLength(current) > longest.length)
          longest = { length: Buffer.byteLength(current), object: record, key };
        else if (typeof current === "object") visit(current);
      }
    };
    visit(value);
    if (longest.object && longest.length > 128)
      longest.object[longest.key] = clip(String(longest.object[longest.key]), Math.floor(longest.length / 2));
    else if (value.length > 1) value.splice(1, 1);
    else {
      value = [{ role: "user", parts: [{ type: "text", content: TRUNCATED }] }];
    }
    result = JSON.stringify(value);
  }
  return result;
}
export function projectModelMessages(
  attributes: Readonly<Record<string, unknown>>,
  mask: (text: string) => string,
): Record<string, string | boolean> {
  const state: CleanState = { mask, truncated: false, nodes: 0 };
  const result: Record<string, string | boolean> = {};
  for (const direction of ["input", "output"] as const) {
    let content = messages(attributes[`${direction}.value`], direction, state);
    if (!content.length) content = indexed(attributes, direction, state);
    if (content.length) result[`gen_ai.${direction}.messages`] = boundedMessages(content, state);
  }
  if (state.truncated) result["diligent.content.truncated"] = true;
  return result;
}

/** Leave ample room for the OTLP envelope, resource and safe metadata after JSON escaping. */
export function boundDetailedAttributes(
  attributes: Record<string, string | boolean>,
): Record<string, string | boolean> {
  const result = { ...attributes };
  const state: CleanState = { mask: (text) => text, truncated: false, nodes: 0 };
  while (Buffer.byteLength(JSON.stringify(result)) > 524288) {
    const largest = Object.entries(result)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .sort((a, b) => Buffer.byteLength(JSON.stringify(b[1])) - Buffer.byteLength(JSON.stringify(a[1])))[0];
    if (!largest) break;
    const [key, value] = largest;
    const limit = Math.max(128, Math.floor(Buffer.byteLength(value) / 2));
    if (value.length < 64) {
      delete result[key];
    } else if (key === "gen_ai.input.messages" || key === "gen_ai.output.messages") {
      try {
        result[key] = boundedMessages(JSON.parse(value) as ObservationMessage[], state, limit);
      } catch {
        delete result[key];
      }
    } else {
      const parsed = parse(value);
      result[key] =
        typeof parsed === "object" && parsed !== null
          ? JSON.stringify({ truncated: true, preview: clip(value, Math.floor(limit / 4)) })
          : clip(value, limit);
    }
    result["diligent.content.truncated"] = true;
  }
  return result;
}
