// @summary Isolated real-SDK loopback probe for Claude 5.5 Messages wire contracts
import assert from "node:assert/strict";
import { resolveModel } from "../../src/llm/models";
import { createAnthropicStream } from "../../src/llm/provider/anthropic";
import type { StreamContext } from "../../src/llm/types";

// Synthetic responses prove serialization and parsing, never live model behavior.
const modelId = process.argv[2] ?? "claude-sonnet-5-5";
const model = resolveModel({ provider: "anthropic", modelId });
const requests: Array<{ path: string; headers: Headers; body: Record<string, unknown> }> = [];
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    requests.push({ path: new URL(request.url).pathname, headers: request.headers, body: await request.json() });
    const events = [
      {
        type: "message_start",
        message: {
          id: "local",
          type: "message",
          role: "assistant",
          model: model.modelId,
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
    return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), {
      headers: { "Content-Type": "text/event-stream" },
    });
  },
});
try {
  const stream = createAnthropicStream("local-test-key", server.url.toString());
  const context: StreamContext = {
    systemPrompt: [{ label: "system", content: "Changed instructions" }],
    messages: [
      { role: "user", content: "Earlier question", timestamp: 1 },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Earlier reasoning", signature: "synthetic-signature" },
          { type: "text", text: "Earlier answer" },
        ],
        model,
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
        stopReason: "end_turn",
        timestamp: 2,
      },
      {
        role: "user",
        content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "aW1hZ2U=" } }],
        timestamp: 3,
      },
    ],
    tools: [{ kind: "function", name: "read_file", description: "Read a file", inputSchema: { type: "object" } }],
  };
  for (const effort of ["low", "medium", "high", "xhigh", "max"] as const) {
    const result = await stream(model, context, { effort, temperature: 0.5 }).result();
    assert.deepEqual(result.message.content, [{ type: "text", text: "fixture" }]);
    const captured = requests.at(-1);
    assert(captured);
    assert.equal(captured.path, "/v1/messages");
    assert.equal(captured.headers.get("anthropic-beta"), "thinking-binding-controls-2026-08-01");
    assert.equal(captured.body.model, modelId);
    assert.equal(captured.body.max_tokens, 128_000);
    assert.equal(captured.body.stream, true);
    assert.deepEqual(captured.body.output_config, { effort });
    assert.deepEqual(captured.body.thinking, {
      type: "adaptive",
      display: "summarized",
      block_binding: { prefix_mismatch_behavior: "drop_block" },
    });
    assert.equal(captured.body.temperature, undefined);
    assert.equal(captured.body.tool_choice, undefined);
    const tools = captured.body.tools as Array<{ name: string }>;
    assert.equal(tools[0].name, "read_file");
    const messages = captured.body.messages as Array<{ content: unknown }>;
    assert.deepEqual(messages[1].content, context.messages[1].role === "assistant" ? context.messages[1].content : []);
    assert.deepEqual(messages[2].content, [
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "aW1hZ2U=" },
        cache_control: { type: "ephemeral" },
      },
    ]);
  }
  assert.equal(requests.length, 5);
  console.log(`${modelId} loopback wire contract: 5 efforts verified`);
} finally {
  await server.stop(true);
}
