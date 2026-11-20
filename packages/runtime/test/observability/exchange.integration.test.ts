import { expect, spyOn, test } from "bun:test";
import { resolveModel } from "@diligent/core/model-registry";
import { withRetry } from "@diligent/core/provider-contract";
import { createChatGPTStream } from "@diligent/core/providers/chatgpt";
import { createObservationRuntime } from "../../src/observability/runtime";

interface CapturedSpan {
  spanId: string;
  parentSpanId?: string;
  name: string;
  status: { code: number; message?: string };
  attributes: Array<{ key: string; value: { stringValue?: string; intValue?: number; doubleValue?: number } }>;
}
function recorder(
  permission = { granted: true, generation: 1, full: true },
  maskText = (s: string) => s.replaceAll("private-marker", "[MASKED]"),
) {
  const spans: CapturedSpan[] = [];
  const runtime = createObservationRuntime({
    baseUrl: "https://example.invalid",
    getPolicy: () => ({
      granted: permission.granted,
      userId: "user",
      generation: permission.generation,
      contentMode: permission.full ? "full" : "none",
    }),
    maskText,
    captureModelContent: true,
    resolveToken: async () => "test",
    fetch: async (_url, init) => {
      spans.push(...JSON.parse(String(init?.body)).resourceSpans[0].scopeSpans[0].spans);
      return Response.json({});
    },
  });
  return { runtime, spans };
}
const attr = (s: CapturedSpan, key: string) => s.attributes.find((a) => a.key === key)?.value;

test("each login HTTP exchange reports actual usage, masked messages and its attempt parent", async () => {
  const { runtime, spans } = recorder();
  const previous = globalThis.fetch;
  try {
    const stream = withRetry(
      createChatGPTStream(
        () => ({
          access_token: "credential",
          refresh_token: "unused",
          expires_at: Date.now() + 60000,
          id_token: "test",
          account_id: "account",
        }),
        { useWebSocket: false },
      ),
      { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1 },
      undefined,
      undefined,
      runtime.observeModelAttempt,
    );
    for (const usage of [
      { input_tokens: 73, output_tokens: 9, input_tokens_details: { cached_tokens: 10 } },
      undefined,
      { input_tokens: 0, output_tokens: 0 },
    ]) {
      globalThis.fetch = (async () =>
        new Response(
          [
            { type: "response.output_text.delta", delta: "reply" },
            { type: "response.completed", response: { status: "completed", usage } },
          ]
            .map((event) => `data: ${JSON.stringify(event)}\n\n`)
            .join(""),
        )) as typeof fetch;
      await runtime.run(async () => {
        const result = await stream(
          resolveModel({ provider: "chatgpt", modelId: "gpt-6-luna" }),
          {
            messages: [{ role: "user", content: "private-marker question", timestamp: 1 }],
            tools: [],
            systemPrompt: [],
          },
          {},
        ).result();
        expect(result.message.stopReason).toBe("end_turn");
      });
    }
    await runtime.flush();
    const models = spans.filter((s) => s.name === "diligent.llm");
    expect(models).toHaveLength(3);
    for (const model of models) {
      expect(
        spans.find((s) => s.spanId === model.parentSpanId)?.attributes.some((a) => a.key === "diligent.retry.attempt"),
      ).toBe(true);
      expect(attr(model, "gen_ai.input.messages")?.stringValue).toContain("[MASKED] question");
      expect(attr(model, "gen_ai.output.messages")?.stringValue).toContain("reply");
    }
    expect(attr(models[0]!, "llm.token_count.prompt")?.intValue).toBe(73);
    expect(attr(models[0]!, "llm.token_count.prompt_details.cache_read")?.intValue).toBe(10);
    expect(attr(models[0]!, "llm.token_count.total")?.intValue).toBe(82);
    expect(attr(models[1]!, "llm.token_count.prompt")).toBeUndefined();
    expect(attr(models[2]!, "llm.token_count.prompt")?.intValue).toBe(0);
    expect(JSON.stringify(spans)).not.toContain("private-marker");
  } finally {
    globalThis.fetch = previous;
    await runtime.shutdown();
  }
});

test("login HTTP sends the request before projecting input and measures first text without masking time", async () => {
  let clock = 1000;
  const steps: string[] = [];
  const { runtime, spans } = recorder(undefined, (text) => {
    if (text === "question") {
      steps.push("mask input");
      clock += 80;
    }
    return text;
  });
  const previous = globalThis.fetch;
  const now = spyOn(performance, "now").mockImplementation(() => clock);
  try {
    globalThis.fetch = (async () => {
      steps.push("send");
      clock += 10;
      return new Response(
        'data: {"type":"response.output_text.delta","delta":"reply"}\n\n' +
          'data: {"type":"response.completed","response":{"status":"completed"}}\n\n',
      );
    }) as typeof fetch;
    const stream = withRetry(
      createChatGPTStream(
        () => ({
          access_token: "credential",
          refresh_token: "unused",
          expires_at: Date.now() + 60000,
          id_token: "test",
        }),
        { useWebSocket: false },
      ),
      { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1 },
      undefined,
      undefined,
      runtime.observeModelAttempt,
    );
    await runtime.run(() =>
      stream(
        resolveModel({ provider: "chatgpt", modelId: "gpt-6-luna" }),
        { messages: [{ role: "user", content: "question", timestamp: 1 }], tools: [], systemPrompt: [] },
        {},
      ).result(),
    );
    await runtime.flush();
    const model = spans.find((span) => span.name === "diligent.llm")!;
    const firstText = attr(model, "diligent.first_text_ms");
    expect(steps).toEqual(["send", "mask input"]);
    expect(firstText?.intValue ?? firstText?.doubleValue).toBe(10);
    expect(attr(model, "gen_ai.input.messages")?.stringValue).toContain("question");
  } finally {
    now.mockRestore();
    globalThis.fetch = previous;
    await runtime.shutdown();
  }
});

test("failed turns retain their question and error-only tools export an owned masked reason", async () => {
  const { runtime, spans } = recorder();
  try {
    await runtime.run(
      async () => {
        await runtime.runTool("edit", async () => ({
          metadata: {
            error: true,
            phase: "execute",
            code: -32000,
            errorReason: "private-marker failure\nrequest dump",
          },
        }));
        return { status: "failed" };
      },
      { sessionId: "session", readTurnContent: () => ({ input: "question" }) },
    );
    await runtime.flush();
    const root = spans.find((s) => !s.parentSpanId)!;
    expect(attr(root, "input.value")?.stringValue).toBe("question");
    expect(attr(root, "output.value")).toBeUndefined();
    const tool = spans.find((s) => s.name === "diligent.tool")!;
    expect(tool.status.message).toBe("[MASKED] failure");
    expect(attr(tool, "diligent.error.code")?.intValue).toBe(-32000);
  } finally {
    await runtime.shutdown();
  }
});

test("turn finalization preserves each authorized side across exceptions and consent changes", async () => {
  const permission = { granted: true, generation: 1, full: true };
  const { runtime, spans } = recorder(permission);
  try {
    await runtime.run(async () => ({ status: "completed" }), {
      sessionId: "output-only",
      readTurnContent: () => ({ output: "final answer" }),
    });
    expect(() =>
      runtime.run(
        () => {
          throw new Error("fail");
        },
        { sessionId: "thrown", readTurnContent: () => ({ input: "my question" }) },
      ),
    ).toThrow("fail");
    await runtime.flush();
    expect(attr(spans[0]!, "input.value")).toBeUndefined();
    expect(attr(spans[0]!, "output.value")?.stringValue).toBe("final answer");
    expect(attr(spans[1]!, "input.value")?.stringValue).toBe("my question");
    await runtime.run(
      async () => {
        permission.generation++;
        permission.granted = false;
      },
      { sessionId: "withdrawn", readTurnContent: () => ({ input: "stale" }) },
    );
    await runtime.flush();
    expect(spans).toHaveLength(2);
    permission.granted = true;
    permission.full = false;
    await runtime.run(async () =>
      runtime.runTool("write", async () => ({ metadata: { error: true, errorReason: "sensitive", phase: "save" } })),
    );
    await runtime.flush();
    const tool = spans.find((s) => s.name === "diligent.tool")!;
    expect(tool.status.code).toBe(2);
    expect(tool.status.message).toBeUndefined();
    expect(attr(tool, "diligent.error.phase")?.stringValue).toBe("save");
    expect(JSON.stringify(tool)).not.toContain("sensitive");
  } finally {
    await runtime.shutdown();
  }
});
