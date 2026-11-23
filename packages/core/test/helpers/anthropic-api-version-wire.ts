// @summary Isolated real-SDK probe for the Anthropic API version 2026-10-21 request contract
import assert from "node:assert/strict";
import { resolveModel } from "../../src/llm/models";
import { createAnthropicNativeCompaction, createAnthropicStream } from "../../src/llm/provider/anthropic";
import type { Model, StreamContext } from "../../src/llm/types";

// Synthetic responses prove what the real SDK and the raw-fetch paths send, never live model behavior.
const apiKey = "wire-test-key";
const catalogModel = resolveModel({ provider: "anthropic", modelId: "claude-opus-5-5" });
const models: Model[] = [catalogModel, { ...catalogModel, modelId: "claude-custom", supportsThinking: false }];
const requests: Array<{ path: string; headers: Headers; body?: Record<string, unknown> }> = [];
const events = [
  {
    type: "message_start",
    message: {
      id: "local",
      type: "message",
      role: "assistant",
      model: catalogModel.modelId,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 5, output_tokens: 0 },
    },
  },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "fixture" } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } },
  { type: "message_stop" },
];

// Intercept every request so the official base URL, the only one with Files API uploads, stays local.
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const request = new Request(input, init);
  const path = new URL(request.url).pathname;
  if (path === "/v1/files") {
    requests.push({ path, headers: request.headers });
    return Response.json({ id: "file_wire", type: "file" });
  }
  const body = (await request.json()) as Record<string, unknown>;
  requests.push({ path, headers: request.headers, body });
  if (body.context_management) {
    return Response.json({ content: [{ type: "compaction", content: "summary" }], stop_reason: "compaction" });
  }
  return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "Content-Type": "text/event-stream" },
  });
}) as unknown as typeof fetch;

const context: StreamContext = {
  systemPrompt: [{ label: "system", content: "Instructions" }],
  messages: [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "Cited question",
          citations: [
            { type: "char_location", documentIndex: 0, startCharIndex: 0, endCharIndex: 4, citedText: "Cite" },
          ],
        },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "aW1hZ2U=" } },
      ],
      timestamp: 1,
    },
    {
      role: "assistant",
      content: [{ type: "text", text: "Earlier answer" }],
      model: catalogModel,
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      stopReason: "end_turn",
      timestamp: 2,
    },
    { role: "user", content: "Follow up", timestamp: 3 },
  ],
  tools: [],
};

function assertKeyHeaders(headers: Headers): void {
  assert.equal(headers.get("anthropic-version"), "2026-10-21");
  assert.equal(headers.get("x-api-key"), apiKey);
  assert.equal(headers.get("authorization"), null);
}

function assertAcceptedMessages(body: Record<string, unknown>): void {
  for (const parameter of ["temperature", "top_p", "top_k"]) assert.equal(parameter in body, false, parameter);
  const messages = body.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>;
  for (const message of messages) {
    for (const block of message.content) {
      if (message.role === "user" && block.type === "text") assert.equal(block.citations, undefined);
      if (message.role === "assistant") assert.notEqual(block.type, "document");
    }
  }
  assert.deepEqual(messages[0].content[1].source, { type: "file", file_id: "file_wire" });
}

const stream = createAnthropicStream(apiKey);
for (const model of models) {
  const result = await stream(model, context, { effort: "medium", temperature: 0.25 }).result();
  assert.deepEqual(result.message.content, [{ type: "text", text: "fixture" }]);
  const captured = requests.at(-1);
  assert(captured?.body);
  assert.equal(captured.path, "/v1/messages");
  assertKeyHeaders(captured.headers);
  assert.match(captured.headers.get("anthropic-beta") ?? "", /files-api-2025-04-14/);
  assertAcceptedMessages(captured.body);
}

const compaction = await createAnthropicNativeCompaction(apiKey)({
  model: catalogModel,
  systemPrompt: [],
  messages: context.messages,
});
assert.equal(compaction.status, "ok");
const compactionRequest = requests.at(-1);
assert(compactionRequest?.body);
assertKeyHeaders(compactionRequest.headers);
assert.equal(compactionRequest.headers.get("anthropic-beta"), "compact-2026-01-12,files-api-2025-04-14");
assertAcceptedMessages(compactionRequest.body);

const uploads = requests.filter((request) => request.path === "/v1/files");
assert.equal(uploads.length, 1);
assertKeyHeaders(uploads[0].headers);
assert.equal(uploads[0].headers.get("anthropic-beta"), null);
assert.equal(requests.length, models.length + 2);
console.log("anthropic api version wire contract verified");
