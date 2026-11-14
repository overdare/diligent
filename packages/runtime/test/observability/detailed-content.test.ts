import { describe, expect, test } from "bun:test";
import { projectModelMessages, sanitizeDetailedValue } from "../../src/observability/detailed-content";

const mask = (text: string) => text.replaceAll("synthetic-secret", "[MASKED]");

describe("detailed observation content", () => {
  test("exports ordered SDK system, history, tool calls and response text without original media", () => {
    const request = {
      system: "system instructions",
      messages: [
        { role: "user", content: "previous question" },
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "call-1", name: "lookup", input: { query: "synthetic-secret" } }],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "call-1", content: "tool result" },
            { type: "text", text: "current question" },
            { type: "image", source: { type: "base64", media_type: "image/png", data: "IMAGE_ORIGINAL_BYTES" } },
            { type: "image_url", image_url: { url: "https://images.example/output.png" } },
          ],
        },
      ],
    };
    const attrs = {
      "input.value": JSON.stringify(request),
      "output.value": JSON.stringify({
        role: "assistant",
        content: [
          { type: "text", text: "final response" },
          { type: "thinking", thinking: "private reasoning", signature: "private signature" },
        ],
      }),
    };
    const result = projectModelMessages(attrs, mask);
    const messages = JSON.parse(String(result["gen_ai.input.messages"]));
    expect(messages[0]).toEqual({ role: "system", parts: [{ type: "text", content: "system instructions" }] });
    expect(messages.some((message: { role: string }) => message.role === "tool")).toBe(true);
    const wire = JSON.stringify(result);
    for (const value of [
      "previous question",
      "current question",
      "tool result",
      "final response",
      "https://images.example/output.png",
      "[MASKED]",
    ])
      expect(wire).toContain(value);
    for (const value of ["synthetic-secret", "IMAGE_ORIGINAL_BYTES", "private reasoning", "private signature"])
      expect(wire).not.toContain(value);
    expect(request.messages[1]?.content).toBeDefined();
    expect(attrs["input.value"]).toContain("IMAGE_ORIGINAL_BYTES");
  });

  test("supports OpenAI Responses inputs and tool call outputs", () => {
    const result = projectModelMessages(
      {
        "input.value": JSON.stringify({
          instructions: "system",
          input: [
            { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] },
            { type: "function_call", call_id: "c", name: "read", arguments: '{"path":"file.txt"}' },
            { type: "function_call_output", call_id: "c", output: "contents" },
          ],
        }),
        "output.value": JSON.stringify({
          output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "answer" }] }],
        }),
      },
      mask,
    );
    const input = JSON.parse(String(result["gen_ai.input.messages"]));
    expect(input.map((message: { role: string }) => message.role)).toEqual(["system", "user", "assistant", "tool"]);
    expect(JSON.parse(String(result["gen_ai.output.messages"]))[0].parts).toEqual([
      { type: "text", content: "answer" },
    ]);
  });

  test("masks credential fields and inline media while retaining JSON and file references", () => {
    const value = {
      apiKey: "do-not-send",
      token: "do-not-send",
      path: "/tmp/image.png",
      url: "https://images.example/output.png?token=do-not-send",
      text: "prefix data:image/png;base64,aW1hZ2VieXRlcw== suffix",
      image: { type: "image", data: "ORIGINAL", mimeType: "image/png" },
      bytes: new Uint8Array([1, 2, 3]),
      query: "synthetic-secret",
    };
    const result = sanitizeDetailedValue(value, mask);
    expect(JSON.parse(result.value).path).toBe("/tmp/image.png");
    expect(JSON.parse(result.value).url).toBe("https://images.example/output.png?token=%5BREDACTED%5D");
    expect(result.value).toContain("[MASKED]");
    for (const secret of ["do-not-send", "aW1hZ2VieXRlcw==", "ORIGINAL"]) expect(result.value).not.toContain(secret);
    expect(value.apiKey).toBe("do-not-send");
  });

  test("bounds UTF-8 content and preserves valid message JSON with a truncation marker", () => {
    const result = projectModelMessages(
      { "input.value": JSON.stringify({ messages: [{ role: "user", content: "한".repeat(200000) }] }) },
      mask,
    );
    const input = String(result["gen_ai.input.messages"]);
    expect(Buffer.byteLength(input)).toBeLessThanOrEqual(262144);
    expect(JSON.parse(input)[0].parts[0].content).toContain("[TRUNCATED]");
    expect(result["diligent.content.truncated"]).toBe(true);
    expect(input).not.toContain("�");
  });

  test("falls back to SDK indexed messages without serializing unknown attributes", () => {
    const result = projectModelMessages(
      {
        "llm.input_messages.0.message.role": "user",
        "llm.input_messages.0.message.content": "hello",
        "llm.output_messages.0.message.role": "assistant",
        "llm.output_messages.0.message.content": "answer",
        unknown: "never-export",
      },
      mask,
    );
    expect(JSON.parse(String(result["gen_ai.input.messages"]))[0].parts).toEqual([{ type: "text", content: "hello" }]);
    expect(JSON.stringify(result)).not.toContain("never-export");
  });
});

test("removes singular media, serialized Buffers and normalized credential keys at the client boundary", () => {
  const unsafe = {
    image: { data: "RAW_IMAGE" },
    audio: { data: "RAW_AUDIO" },
    encoded: JSON.stringify({ type: "Buffer", data: [11, 22, 33] }),
    cookie: "RAW_COOKIE",
    "set-cookie": "RAW_COOKIE",
    aws_secret_access_key: "RAW_KEY",
    privateKey: "RAW_KEY",
    credentials: "RAW_KEY",
    auth: "RAW_KEY",
  };
  const result = sanitizeDetailedValue(unsafe, (text) => text);
  for (const value of ["RAW_IMAGE", "RAW_AUDIO", "RAW_COOKIE", "RAW_KEY", "11,22,33"])
    expect(result.value).not.toContain(value);
});

test("retains Chat Completions tool-call-only messages and tool result identifiers", () => {
  const result = projectModelMessages(
    {
      "input.value": JSON.stringify({
        messages: [
          {
            role: "assistant",
            content: null,
            tool_calls: [{ id: "call-1", type: "function", function: { name: "lookup", arguments: '{"x":1}' } }],
          },
          { role: "tool", tool_call_id: "call-1", content: "found" },
          { role: "function", name: "lookup", content: "legacy result" },
        ],
      }),
    },
    (text) => text,
  );
  const messages = JSON.parse(String(result["gen_ai.input.messages"]));
  expect(messages[0].parts[0]).toEqual({ type: "tool_call", id: "call-1", name: "lookup", arguments: { x: 1 } });
  expect(messages[1].parts[0]).toEqual({ type: "tool_call_response", id: "call-1", response: "found" });
  expect(messages[2].role).toBe("tool");
});

test("does not throw or invent image modality for malformed SDK choices and file references", () => {
  expect(() =>
    projectModelMessages({ "output.value": '{"choices":{"message":"invalid"}}' }, (text) => text),
  ).not.toThrow();
  const result = projectModelMessages(
    {
      "input.value": JSON.stringify({
        messages: [{ role: "user", content: [{ type: "uri", uri: "/tmp/reference.txt", modality: "file" }] }],
      }),
    },
    (text) => text,
  );
  expect(JSON.parse(String(result["gen_ai.input.messages"]))[0].parts[0].modality).toBe("file");
});

test("redacts credential header aliases in JSON and URL query parameters", () => {
  const result = sanitizeDetailedValue(
    {
      "x-api-key": "RAW_KEY",
      "x-auth-token": "RAW_AUTH",
      "x-amz-security-token": "RAW_AWS",
      url: "https://example.test/image.png?x-api-key=RAW_KEY&x-auth-token=RAW_AUTH&x-amz-security-token=RAW_AWS&size=small",
    },
    (text) => text,
  );
  for (const secret of ["RAW_KEY", "RAW_AUTH", "RAW_AWS"]) expect(result.value).not.toContain(secret);
  expect(result.value).toContain("size=small");
});

test("excludes serialized typed arrays and binary views including nested JSON", () => {
  const types = [
    "Uint8Array",
    "Uint8ClampedArray",
    "Int8Array",
    "Uint16Array",
    "Int16Array",
    "Uint32Array",
    "Int32Array",
    "Float32Array",
    "Float64Array",
    "BigInt64Array",
    "BigUint64Array",
    "ArrayBuffer",
    "SharedArrayBuffer",
    "DataView",
  ];
  for (const type of types) {
    const value = { type, data: [11, 22, 33] };
    const result = sanitizeDetailedValue(
      { direct: value, nested: JSON.stringify(value), path: "/tmp/safe.png" },
      (text) => text,
    );
    expect(result.value).not.toContain("11,22,33");
    expect(result.value).toContain("/tmp/safe.png");
  }
});

test("truncates collections to the relay contract while retaining system and newest history", () => {
  const result = projectModelMessages(
    {
      "input.value": JSON.stringify({
        messages: [
          { role: "system", content: "instructions" },
          ...Array.from({ length: 300 }, (_, i) => ({ role: "user", content: String(i) })),
        ],
      }),
    },
    (text) => text,
  );
  const messages = JSON.parse(String(result["gen_ai.input.messages"]));
  expect(messages.length).toBeLessThanOrEqual(256);
  expect(messages[0].role).toBe("system");
  expect(messages.at(-1).parts[0].content).toBe("299");
  expect(result["diligent.content.truncated"]).toBe(true);
  const tool = sanitizeDetailedValue(
    {
      rows: Array.from({ length: 1500 }, (_, i) => i),
      columns: Object.fromEntries(Array.from({ length: 1500 }, (_, i) => [String(i), i])),
    },
    (text) => text,
  );
  const value = JSON.parse(tool.value);
  expect(value.rows.length).toBeLessThanOrEqual(1024);
  expect(Object.keys(value.columns).length).toBeLessThanOrEqual(1024);
  expect(tool.truncated).toBe(true);
});

test("removes repeated data scheme markers even without a terminating comma", () => {
  const result = sanitizeDetailedValue(`prefix ${"data:".repeat(2000)} suffix`, (text) => text);
  expect(result.value).toBe("prefix [MEDIA OMITTED] suffix");
});
