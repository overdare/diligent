// @summary Code mode prompt surface: exec/exec_wait descriptions and TypeScript declarations for nested tools

import type { Tool } from "@diligent/core/tool-contract";
import { toToolInputSchema } from "@diligent/core/tool-contract";

export const EXEC_TOOL_NAME = "exec";
export const EXEC_WAIT_TOOL_NAME = "exec_wait";
export const DEFAULT_YIELD_TIME_MS = 10_000;
export const DEFAULT_MAX_OUTPUT_TOKENS = 10_000;

const MAX_SCHEMA_DEPTH = 6;

const EXEC_DESCRIPTION = `Run JavaScript code to orchestrate/compose tool calls.
- \`code\` is evaluated as the body of an async function in a fresh, isolated JavaScript context, so top-level \`await\` works.
- Nested tools are available on the global \`tools\` object, for example \`await tools.read({ file_path: "/abs/path" })\`. Tool names are exposed as JavaScript identifiers (characters outside [A-Za-z0-9_$] become \`_\`).
- Nested tool methods take one JSON-serializable object argument and resolve to the tool's complete text output (only this \`exec\` result is truncated to \`max_output_tokens\`). A failed tool call rejects with an Error whose message is the tool output; use try/catch to handle it.
- Tool outputs are text, usually formatted for reading. Call \`JSON.parse\` only on output a tool documents as JSON; otherwise process it as a string.
- Nested tools run with the same approvals and permissions as direct tool calls. Independent calls may run concurrently with \`Promise.all\`; tools that are not parallel-safe still run one at a time.
- Runs plain JavaScript only: no Node or Bun APIs, no require/import, no file system, no network, no console. Do all I/O through \`tools\`.
- \`code\` is raw JavaScript source, not JSON, quoted strings, or markdown code fences. Write multi-line text (shell heredocs, file contents, patches, reports) as template literals (\`\` \`...\` \`\`); a raw line break inside "..." or '...' is a SyntaxError.
- \`yield_time_ms\` makes \`exec\` return early while the script keeps running. Defaults to ${DEFAULT_YIELD_TIME_MS} ms.
- \`max_output_tokens\` sets the token budget for the returned output. Defaults to ${DEFAULT_MAX_OUTPUT_TOKENS} tokens.
- When the script finishes, its context ends and unawaited promises and pending nested calls are discarded.
- A non-undefined value returned from the top level is appended to the output like \`text(value)\`.

- Global helpers:
- \`exit()\`: Immediately ends the current script successfully (like an early return from the top level).
- \`text(value: string | number | boolean | undefined | null)\`: Appends a text item. Non-string values are stringified with \`JSON.stringify(...)\` when possible.
- \`image(imageUrlOrItem: string | { image_url: string })\`: Appends an image item. \`image_url\` must be a base64-encoded \`data:\` URL (png, jpeg, gif, or webp).
- \`store(key: string, value: any)\`: Stores a JSON-serializable value under a string key for later \`exec\` calls in the same session.
- \`load(key: string)\`: Returns the stored value for a string key, or \`undefined\` if it is missing.
- \`setTimeout(callback: () => void, delayMs?: number)\`: Schedules a callback and returns a timeout id. Pending timeouts do not keep \`exec\` alive by themselves; await an explicit promise if you need to wait for one.
- \`clearTimeout(timeoutId?: number)\`: Cancels a timeout created by \`setTimeout\`.
- \`ALL_TOOLS\`: Metadata for the nested tools as \`{ name, description }\` entries.
- \`yield_control()\`: Returns the accumulated output to the model immediately while the script keeps running.

The result starts with one status line: \`Script completed\`, \`Script failed\` (followed by the script error), \`Script terminated\`, or \`Script running with cell ID <id>\`. Use \`${EXEC_WAIT_TOOL_NAME}\` only for the last case.`;

export const EXEC_WAIT_DESCRIPTION = `Waits on a yielded \`${EXEC_TOOL_NAME}\` cell and returns new output or completion.
- Use \`${EXEC_WAIT_TOOL_NAME}\` only after \`${EXEC_TOOL_NAME}\` returns \`Script running with cell ID ...\`.
- \`cell_id\` identifies the running \`${EXEC_TOOL_NAME}\` cell to resume.
- \`yield_time_ms\` controls how long to wait for more output before yielding again. Defaults to ${DEFAULT_YIELD_TIME_MS} ms.
- \`max_tokens\` limits how much new output this call returns. Defaults to ${DEFAULT_MAX_OUTPUT_TOKENS} tokens.
- \`terminate: true\` stops the running cell; false or omitted waits for output.
- Returns only the new output since the last yield, or the final completion or termination result for that cell.
- If the cell is still running, \`${EXEC_WAIT_TOOL_NAME}\` may yield again with the same \`cell_id\`.
- Nested tool calls requested while no \`${EXEC_TOOL_NAME}\`/\`${EXEC_WAIT_TOOL_NAME}\` call is waiting are held until the next wait.`;

/** Normalizes a catalog tool name into the identifier used on the guest `tools` object. */
export function toCodeModeIdentifier(name: string): string {
  const identifier = name.replace(/^[^A-Za-z_$]/, "_").replace(/[^A-Za-z0-9_$]/g, "_");
  return identifier || "_";
}

/**
 * Builds the `exec` description. In `only` mode the nested tools are hidden from the model's tool
 * list, so their descriptions and TypeScript declarations move into this description.
 */
export function buildExecDescription(codeMode: "on" | "only", nestedTools: Tool[]): string {
  if (codeMode === "on") {
    return `${EXEC_DESCRIPTION}\n\nEvery direct tool listed beside \`${EXEC_TOOL_NAME}\` that is not a code mode control tool is also callable from \`tools\`, with the same input object.`;
  }
  const sections = nestedTools.map((tool) => {
    const globalName = toCodeModeIdentifier(tool.name);
    const heading = globalName === tool.name ? `### \`${globalName}\`` : `### \`${globalName}\` (\`${tool.name}\`)`;
    const declaration = `declare const tools: { ${globalName}(args: ${renderJsonSchemaType(toToolInputSchema(tool), 1)}): Promise<string>; };`;
    return `${heading}\n${tool.description.trim()}\n\n\`\`\`ts\n${declaration}\n\`\`\``;
  });
  return [EXEC_DESCRIPTION, "## Nested tools", ...sections].join("\n\n");
}

/** Renders a JSON Schema as a TypeScript type expression for model-facing declarations. */
export function renderJsonSchemaType(schema: unknown, indentLevel = 0, depth = 0): string {
  if (!schema || typeof schema !== "object" || depth > MAX_SCHEMA_DEPTH) return "unknown";
  const node = schema as Record<string, unknown>;
  const next = (child: unknown) => renderJsonSchemaType(child, indentLevel, depth + 1);

  if ("const" in node) return JSON.stringify(node.const);
  if (Array.isArray(node.enum)) return node.enum.map((value) => JSON.stringify(value)).join(" | ") || "never";
  for (const key of ["anyOf", "oneOf"] as const) {
    const variants = node[key];
    if (Array.isArray(variants) && variants.length > 0) return variants.map((variant) => next(variant)).join(" | ");
  }
  if (Array.isArray(node.allOf) && node.allOf.length > 0) return node.allOf.map((part) => next(part)).join(" & ");
  if (Array.isArray(node.type)) return node.type.map((type) => next({ ...node, type })).join(" | ");

  switch (node.type) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array": {
      const item = next(node.items);
      return /^[\w.$]+$/.test(item) ? `${item}[]` : `Array<${item}>`;
    }
  }
  if (node.type === "object" || node.properties) return renderObjectType(node, indentLevel, depth);
  return "unknown";
}

function renderObjectType(node: Record<string, unknown>, indentLevel: number, depth: number): string {
  const properties =
    node.properties && typeof node.properties === "object"
      ? Object.entries(node.properties as Record<string, unknown>)
      : [];
  const required = new Set(Array.isArray(node.required) ? node.required : []);
  const additional = node.additionalProperties;
  if (properties.length === 0) {
    return additional && typeof additional === "object"
      ? `Record<string, ${renderJsonSchemaType(additional, indentLevel, depth + 1)}>`
      : "Record<string, unknown>";
  }

  const indent = "  ".repeat(indentLevel);
  const lines = properties.map(([key, value]) => {
    const name = /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
    const description =
      value && typeof value === "object" && typeof (value as { description?: unknown }).description === "string"
        ? (value as { description: string }).description.replace(/\s+/g, " ").replace(/\*\//g, "* /").trim()
        : "";
    const comment = description ? `${indent}  /** ${description} */\n` : "";
    const optional = required.has(key) ? "" : "?";
    return `${comment}${indent}  ${name}${optional}: ${renderJsonSchemaType(value, indentLevel + 1, depth + 1)};`;
  });
  if (additional && typeof additional === "object") {
    lines.push(`${indent}  [key: string]: ${renderJsonSchemaType(additional, indentLevel + 1, depth + 1)};`);
  }
  return `{\n${lines.join("\n")}\n${indent}}`;
}
