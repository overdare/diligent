import { expect } from "bun:test";

const cases: Array<{ name: string; run: () => Promise<void> }> = [];
function test(name: string, run: () => Promise<void>) {
  cases.push({ name, run });
}

import { createAnthropicStream } from "@diligent/core/providers/anthropic";
import { createOpenAIStream } from "@diligent/core/providers/openai";
import { NodeTracerProvider, type ReadableSpan } from "@opentelemetry/sdk-trace-node";
import { attachModelInstrumentation } from "../../../src/observability/model-instrumentation";
import { ConsentSpanProcessor } from "../../../src/observability/span-processor";

test("attaches to the actual provider SDKs and captures failed requests without content", async () => {
  const spans: ReadableSpan[] = [];
  const processor = new ConsentSpanProcessor({
    getPolicy: () => ({ granted: true, generation: 1, userId: "test-user", contentMode: "none" }),
    isAuthorizedContext: () => true,
    onSpan: (span) => spans.push(span),
  });
  const provider = new NodeTracerProvider({ spanProcessors: [processor] });
  const instrumentation = attachModelInstrumentation(provider);
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => Response.json({ error: { type: "rate_limit_error", message: "private error" } }, { status: 429 }),
  });
  try {
    for (const name of ["openai", "anthropic"] as const) {
      const streamFn = name === "openai" ? createOpenAIStream : createAnthropicStream;
      const model = {
        provider: name,
        modelId: "test-model",
        contextWindow: 4096,
        maxOutputTokens: 64,
        supportsThinking: false,
      };
      const stream = streamFn("test-key", `http://127.0.0.1:${server.port}`)(
        model as never,
        {
          systemPrompt: [],
          messages: [{ role: "user", content: [{ type: "text", text: "private prompt" }], timestamp: 1 }],
          tools: [],
        },
        { maxTokens: 64 },
      );
      await stream.result().catch(() => undefined);
      await stream.waitForInnerWork();
    }
    expect(spans.filter((span) => span.attributes["openinference.span.kind"] === "LLM")).toHaveLength(2);
    expect(
      JSON.stringify(spans.map((span) => ({ attributes: span.attributes, events: span.events, status: span.status }))),
    ).not.toContain("private");
  } finally {
    instrumentation.disable();
    server.stop(true);
    await provider.shutdown();
  }
});

test("preserves Anthropic streaming and exports token usage without input or output", async () => {
  const spans: ReadableSpan[] = [];
  const provider = new NodeTracerProvider({
    spanProcessors: [
      new ConsentSpanProcessor({
        getPolicy: () => ({ granted: true, generation: 1, userId: "test-user", contentMode: "none" }),
        isAuthorizedContext: () => true,
        onSpan: (span) => spans.push(span),
      }),
    ],
  });
  const instrumentation = attachModelInstrumentation(provider);
  const events = [
    {
      type: "message_start",
      message: {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "test-model",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 11, output_tokens: 0, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 },
      },
    },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello " } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "world" } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 7 } },
    { type: "message_stop" },
  ];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () =>
      new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), {
        headers: { "content-type": "text/event-stream" },
      }),
  });
  try {
    const model = {
      provider: "anthropic",
      modelId: "test-model",
      contextWindow: 4096,
      maxOutputTokens: 64,
      supportsThinking: false,
    };
    const stream = createAnthropicStream("test-key", `http://127.0.0.1:${server.port}`)(
      model as never,
      {
        systemPrompt: [],
        messages: [{ role: "user", content: [{ type: "text", text: "secret prompt" }], timestamp: 1 }],
        tools: [],
      },
      { maxTokens: 64 },
    );
    const result = stream.result();
    const deltas: string[] = [];
    for await (const event of stream) if (event.type === "text_delta") deltas.push(event.delta);
    await result;
    await stream.waitForInnerWork();
    expect(deltas).toEqual(["Hello ", "world"]);
    const llm = spans.find((span) => span.attributes["openinference.span.kind"] === "LLM");
    expect(llm?.attributes["llm.token_count.prompt"]).toBe(16);
    expect(llm?.attributes["llm.token_count.completion"]).toBe(7);
    expect(llm?.attributes["llm.token_count.prompt_details.cache_read"]).toBe(3);
    expect(llm?.attributes["llm.token_count.prompt_details.cache_write"]).toBe(2);
    expect(JSON.stringify(llm?.attributes)).not.toContain("secret");
    expect(JSON.stringify(llm?.attributes)).not.toContain("Hello");
  } finally {
    instrumentation.disable();
    server.stop(true);
    await provider.shutdown();
  }
});

test("preserves OpenAI streaming and exports token usage without input or output", async () => {
  const spans: ReadableSpan[] = [];
  const provider = new NodeTracerProvider({
    spanProcessors: [
      new ConsentSpanProcessor({
        getPolicy: () => ({ granted: true, generation: 1, userId: "test-user", contentMode: "none" }),
        isAuthorizedContext: () => true,
        onSpan: (span) => spans.push(span),
      }),
    ],
  });
  const instrumentation = attachModelInstrumentation(provider);
  const content = { type: "output_text", text: "Hello world", annotations: [] };
  const item = { id: "msg_1", type: "message", role: "assistant", status: "completed", content: [content] };
  const response = {
    id: "resp_1",
    object: "response",
    created_at: 1,
    status: "in_progress",
    model: "test-model",
    output: [],
  };
  const events = [
    { type: "response.created", sequence_number: 0, response },
    {
      type: "response.output_item.added",
      sequence_number: 1,
      output_index: 0,
      item: { ...item, status: "in_progress", content: [] },
    },
    {
      type: "response.content_part.added",
      sequence_number: 2,
      output_index: 0,
      item_id: item.id,
      content_index: 0,
      part: { ...content, text: "" },
    },
    {
      type: "response.output_text.delta",
      sequence_number: 3,
      output_index: 0,
      item_id: item.id,
      content_index: 0,
      delta: "Hello ",
    },
    {
      type: "response.output_text.delta",
      sequence_number: 4,
      output_index: 0,
      item_id: item.id,
      content_index: 0,
      delta: "world",
    },
    {
      type: "response.output_text.done",
      sequence_number: 5,
      output_index: 0,
      item_id: item.id,
      content_index: 0,
      text: content.text,
    },
    { type: "response.output_item.done", sequence_number: 6, output_index: 0, item },
    {
      type: "response.completed",
      sequence_number: 7,
      response: {
        ...response,
        status: "completed",
        output: [item],
        usage: {
          input_tokens: 11,
          output_tokens: 7,
          total_tokens: 18,
          input_tokens_details: { cached_tokens: 3 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      },
    },
  ];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () =>
      new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), {
        headers: { "content-type": "text/event-stream" },
      }),
  });
  try {
    const model = {
      provider: "openai",
      modelId: "test-model",
      contextWindow: 4096,
      maxOutputTokens: 64,
      supportsThinking: false,
    };
    const stream = createOpenAIStream("test-key", `http://127.0.0.1:${server.port}`)(
      model as never,
      {
        systemPrompt: [],
        messages: [{ role: "user", content: [{ type: "text", text: "secret prompt" }], timestamp: 1 }],
        tools: [],
      },
      { maxTokens: 64 },
    );
    const result = stream.result();
    const deltas: string[] = [];
    for await (const event of stream) if (event.type === "text_delta") deltas.push(event.delta);
    await result;
    await stream.waitForInnerWork();
    expect(deltas).toEqual(["Hello ", "world"]);
    const llm = spans.find((span) => span.attributes["openinference.span.kind"] === "LLM");
    expect(llm?.attributes["llm.token_count.prompt"]).toBe(11);
    expect(llm?.attributes["llm.token_count.completion"]).toBe(7);
    expect(llm?.attributes["llm.token_count.prompt_details.cache_read"]).toBe(3);
    expect(JSON.stringify(llm?.attributes)).not.toContain("secret");
    expect(JSON.stringify(llm?.attributes)).not.toContain("Hello");
  } finally {
    instrumentation.disable();
    server.stop(true);
    await provider.shutdown();
  }
});

for (const entry of cases) {
  await entry.run();
  console.log(`passed: ${entry.name}`);
}
