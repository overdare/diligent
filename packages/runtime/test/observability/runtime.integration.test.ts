import { expect, test } from "bun:test";
import { createOpenAIStream } from "@diligent/core/providers/openai";
import { createObservationRuntime } from "../../src/observability/runtime";

test("observes an authorized provider call and sends only safe OTLP metadata", async () => {
  let granted = true;
  const bodies: string[] = [];
  const runtime = createObservationRuntime({
    baseUrl: "https://gateway.example",
    batchIntervalMs: 10,
    getPolicy: () => ({ granted, generation: 1, userId: "user-1", contentMode: "none" }),
    resolveToken: async () => "token",
    fetch: async (_url, options) => {
      bodies.push(String(options?.body));
      return Response.json({});
    },
  });
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => Response.json({ error: { message: "secret-error", type: "rate_limit_error" } }, { status: 429 }),
  });
  try {
    const request = async () => {
      const model = {
        provider: "openai",
        modelId: "model-1",
        contextWindow: 4096,
        maxOutputTokens: 64,
        supportsThinking: false,
      };
      const stream = createOpenAIStream("key", `http://127.0.0.1:${server.port}`)(
        model as never,
        {
          systemPrompt: [],
          messages: [{ role: "user", content: [{ type: "text", text: "secret-prompt" }], timestamp: 1 }],
          tools: [],
        },
        { maxTokens: 64 },
      );
      await stream.result().catch(() => undefined);
      await stream.waitForInnerWork();
    };
    await runtime.run(request, { sessionId: "session-123" });
    for (let i = 0; i < 50 && bodies.length < 2; i++) await Bun.sleep(10);
    expect(bodies).toHaveLength(2);
    expect(bodies.join()).not.toContain("secret");
    expect(bodies.join()).toContain("model-1");
    expect(bodies.every((body) => body.includes("session-123"))).toBe(true);
    granted = false;
    await runtime.run(request);
    await runtime.flush();
    expect(bodies).toHaveLength(2);
  } finally {
    await runtime.shutdown();
    server.stop(true);
  }
});

test("an unavailable consent service does not prevent the application from running", async () => {
  const runtime = createObservationRuntime({
    baseUrl: "https://gateway.example",
    getPolicy: () => {
      throw new Error("unavailable");
    },
    resolveToken: async () => undefined,
  });
  try {
    expect(runtime.run(() => "result")).toBe("result");
  } finally {
    await runtime.shutdown();
  }
});

test("records tool outcomes without collecting arguments or output", async () => {
  const bodies: string[] = [];
  const runtime = createObservationRuntime({
    baseUrl: "https://gateway.example",
    getPolicy: () => ({ granted: true, generation: 1, userId: "user-1", contentMode: "none" }),
    resolveToken: async () => "token",
    fetch: async (_url, options) => {
      bodies.push(String(options?.body));
      return Response.json({});
    },
  });
  try {
    const result = await runtime.run(() => runtime.runTool("read", async () => ({ output: "secret-file" })), {
      sessionId: "session-1",
    });
    expect(result.output).toBe("secret-file");
    await runtime.flush();
    expect(bodies).toHaveLength(2);
    expect(bodies.join()).toContain("TOOL");
    expect(bodies.join()).toContain("read");
    expect(bodies.join()).not.toContain("secret-file");
  } finally {
    await runtime.shutdown();
  }
});

test("keeps concurrent session identifiers isolated across tool executions", async () => {
  const bodies: string[] = [];
  const runtime = createObservationRuntime({
    baseUrl: "https://gateway.example",
    getPolicy: () => ({ granted: true, generation: 1, userId: "user-1", contentMode: "none" }),
    resolveToken: async () => "token",
    fetch: async (_url, options) => {
      bodies.push(String(options?.body));
      return Response.json({});
    },
  });
  try {
    const one = runtime.run(
      () =>
        runtime.runTool("first", async () => {
          await Bun.sleep(15);
          return "one";
        }),
      { sessionId: "session-one" },
    );
    const two = runtime.run(
      () =>
        runtime.runTool("second", async () => {
          await Bun.sleep(1);
          return "two";
        }),
      { sessionId: "session-two" },
    );
    expect(await Promise.all([one, two])).toEqual(["one", "two"]);
    await runtime.flush();
    expect(bodies).toHaveLength(4);
    const first = bodies.find((body) => body.includes("first"));
    const second = bodies.find((body) => body.includes("second"));
    expect(first).toContain("session-one");
    expect(first).not.toContain("session-two");
    expect(second).toContain("session-two");
    expect(second).not.toContain("session-one");
  } finally {
    await runtime.shutdown();
  }
});

test("groups a model call and tool under one execution trace", async () => {
  const bodies: string[] = [];
  const runtime = createObservationRuntime({
    baseUrl: "https://gateway.example",
    getPolicy: () => ({ granted: true, generation: 1, userId: "user-1", contentMode: "none" }),
    resolveToken: async () => "token",
    fetch: async (_url, options) => {
      bodies.push(String(options?.body));
      return Response.json({});
    },
  });
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => Response.json({ error: { type: "rate_limit_error", message: "secret" } }, { status: 429 }),
  });
  try {
    await runtime.run(
      async () => {
        const model = {
          provider: "openai",
          modelId: "model-1",
          contextWindow: 4096,
          maxOutputTokens: 64,
          supportsThinking: false,
        };
        const stream = createOpenAIStream("key", `http://127.0.0.1:${server.port}`)(
          model as never,
          { systemPrompt: [], messages: [{ role: "user", content: "secret prompt", timestamp: 1 }], tools: [] },
          { maxTokens: 64 },
        );
        await stream.result().catch(() => undefined);
        await stream.waitForInnerWork();
        await runtime.runTool("read", async () => ({ output: "secret output" }));
      },
      { sessionId: "session-1" },
    );
    await runtime.flush();
    type WireSpan = {
      traceId: string;
      spanId: string;
      parentSpanId?: string;
      attributes: Array<{ key: string; value: { stringValue?: string } }>;
    };
    type WirePayload = { resourceSpans: Array<{ scopeSpans: Array<{ spans: WireSpan[] }> }> };
    const spans = bodies.flatMap((body) =>
      (JSON.parse(body) as WirePayload).resourceSpans.flatMap((resource) =>
        resource.scopeSpans.flatMap((scope) => scope.spans),
      ),
    );
    const find = (kind: string) =>
      spans.find((span) =>
        span.attributes.some(
          (attribute) => attribute.key === "openinference.span.kind" && attribute.value.stringValue === kind,
        ),
      );
    const root = find("CHAIN");
    const llm = find("LLM");
    const tool = find("TOOL");
    expect(root).toBeDefined();
    expect(llm).toBeDefined();
    expect(tool).toBeDefined();
    expect(llm?.traceId).toBe(root?.traceId);
    expect(tool?.traceId).toBe(root?.traceId);
    expect(llm?.parentSpanId).toBe(root?.spanId);
    expect(tool?.parentSpanId).toBe(root?.spanId);
  } finally {
    await runtime.shutdown();
    server.stop(true);
  }
});

test("marks the root span failed when the session returns a failure outcome", async () => {
  const bodies: string[] = [];
  const runtime = createObservationRuntime({
    baseUrl: "https://gateway.example",
    getPolicy: () => ({ granted: true, generation: 1, userId: "user-1", contentMode: "none" }),
    resolveToken: async () => "token",
    fetch: async (_url, options) => {
      bodies.push(String(options?.body));
      return Response.json({});
    },
  });
  try {
    const outcome = { status: "failed", error: "private error" };
    expect(await runtime.run(async () => outcome, { sessionId: "session-1" })).toBe(outcome);
    await runtime.flush();
    const span = JSON.parse(bodies[0]!).resourceSpans[0].scopeSpans[0].spans[0];
    expect(span.status.code).toBe(2);
    expect(bodies[0]).not.toContain("private error");
  } finally {
    await runtime.shutdown();
  }
});

test("links a child execution to its spawn tool while keeping separate traces", async () => {
  const bodies: string[] = [];
  const runtime = createObservationRuntime({
    baseUrl: "https://gateway.example",
    getPolicy: () => ({ granted: true, generation: 1, userId: "user-1", contentMode: "none" }),
    resolveToken: async () => "token",
    fetch: async (_url, options) => {
      bodies.push(String(options?.body));
      return Response.json({});
    },
  });
  try {
    await runtime.run(
      () =>
        runtime.runTool("spawn_agent", () =>
          runtime.run(async () => "child", { sessionId: "child", rootSessionId: "parent" }),
        ),
      { sessionId: "parent" },
    );
    await runtime.flush();
    type Span = {
      traceId: string;
      spanId: string;
      links?: Array<{ traceId: string; spanId: string }>;
      attributes: Array<{ key: string; value: { stringValue?: string } }>;
    };
    const spans = bodies.flatMap((body) =>
      (JSON.parse(body) as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Span[] }> }> }).resourceSpans.flatMap(
        (resource) => resource.scopeSpans.flatMap((scope) => scope.spans),
      ),
    );
    const attr = (span: Span, key: string) => span.attributes.find((value) => value.key === key)?.value.stringValue;
    const child = spans.find((span) => span.links?.length);
    const spawn = spans.find((span) => attr(span, "tool.name") === "spawn_agent");
    expect(child).toBeDefined();
    expect(child && attr(child, "gen_ai.conversation.id")).toBe("parent");
    expect(spawn).toBeDefined();
    expect(child?.traceId).not.toBe(spawn?.traceId);
    expect(child?.links?.some((link) => link.traceId === spawn?.traceId && link.spanId === spawn?.spanId)).toBe(true);
  } finally {
    await runtime.shutdown();
  }
});

test("exports attempt correlation and first text timing without content", async () => {
  const bodies: string[] = [];
  const runtime = createObservationRuntime({
    baseUrl: "https://gateway.example",
    getPolicy: () => ({ granted: true, generation: 1, userId: "user-1", contentMode: "none" }),
    resolveToken: async () => "token",
    fetch: async (_url, options) => {
      bodies.push(String(options?.body));
      return Response.json({});
    },
  });
  try {
    await runtime.run(
      async () => {
        const attempt = runtime.observeModelAttempt(2, "call-1")!;
        await attempt.run(async () => {
          attempt.firstResponse();
        });
        attempt.end(true);
      },
      { sessionId: "session" },
    );
    await runtime.flush();
    const spans = bodies.flatMap((body) =>
      JSON.parse(body).resourceSpans[0].scopeSpans.flatMap(
        (scope: {
          spans: Array<{
            parentSpanId?: string;
            spanId: string;
            attributes: Array<{ key: string; value: { intValue?: number; doubleValue?: number } }>;
          }>;
        }) => scope.spans,
      ),
    );
    const attempt = spans.find((span: { attributes: Array<{ key: string }> }) =>
      span.attributes.some((attr) => attr.key === "diligent.retry.attempt"),
    );
    expect(attempt).toBeDefined();
    expect(attempt.attributes).toContainEqual({ key: "diligent.retry.attempt", value: { intValue: 2 } });
    const timing = attempt.attributes.find((attr: { key: string }) => attr.key === "diligent.first_text_ms");
    expect(timing.value.doubleValue ?? timing.value.intValue).toBeGreaterThanOrEqual(0);
    expect(attempt.status.code).toBe(2);
    expect(attempt.parentSpanId).toBe(spans.find((span: { spanId: string }) => span.spanId !== attempt.spanId).spanId);
  } finally {
    await runtime.shutdown();
  }
});

test("correlates actual Agent retry attempts with instrumented SDK failures", async () => {
  const { Agent } = await import("@diligent/core/agent");
  const bodies: string[] = [];
  let requests = 0;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => {
      requests++;
      return Response.json(
        { error: { message: "private error", type: "rate_limit_error", code: "rate_limit_exceeded" } },
        { status: 429 },
      );
    },
  });
  const runtime = createObservationRuntime({
    baseUrl: "https://gateway.example",
    getPolicy: () => ({ granted: true, generation: 1, userId: "user-1", contentMode: "none" }),
    resolveToken: async () => "token",
    fetch: async (_url, options) => {
      bodies.push(String(options?.body));
      return Response.json({});
    },
  });
  try {
    const agent = new Agent(
      { provider: "openai", modelId: "test-model", contextWindow: 4096, maxOutputTokens: 64, supportsThinking: false },
      [],
      [],
      {
        llmMsgStreamFn: createOpenAIStream("test-key", `http://127.0.0.1:${server.port}`),
        retry: { maxRetries: 1, baseDelayMs: 0, maxDelayMs: 0 },
        observeModelAttempt: runtime.observeModelAttempt,
      },
    );
    await runtime
      .run(() => agent.prompt({ role: "user", content: "private prompt", timestamp: 1 }), { sessionId: "session" })
      .catch(() => {});
    await runtime.flush();
    type Span = {
      spanId: string;
      parentSpanId?: string;
      status: { code: number };
      attributes: Array<{ key: string; value: { stringValue?: string; intValue?: number } }>;
    };
    type Payload = { resourceSpans: Array<{ scopeSpans: Array<{ spans: Span[] }> }> };
    const spans = bodies.flatMap((body) =>
      (JSON.parse(body) as Payload).resourceSpans.flatMap((r) => r.scopeSpans.flatMap((s) => s.spans)),
    );
    const attr = (span: Span, key: string) => span.attributes.find((a) => a.key === key)?.value;
    const attempts = spans.filter((s) => attr(s, "diligent.retry.attempt"));
    const models = spans.filter((s) => attr(s, "openinference.span.kind")?.stringValue === "LLM");
    expect(requests).toBe(2);
    expect(attempts.map((s) => attr(s, "diligent.retry.attempt")?.intValue)).toEqual([1, 2]);
    expect(models).toHaveLength(2);
    expect(models.map((s) => s.parentSpanId)).toEqual(attempts.map((s) => s.spanId));
    expect(attr(attempts[0]!, "diligent.model_call.id")).toEqual(attr(attempts[1]!, "diligent.model_call.id"));
    expect(attempts.every((s) => s.status.code === 2)).toBe(true);
    expect(attempts.every((s) => attr(s, "error.type")?.stringValue === "rate_limit")).toBe(true);
    expect(bodies.join("")).not.toContain("private");
  } finally {
    await runtime.shutdown();
    server.stop(true);
  }
});

test("a stale parent cannot authorize a new child scope after consent is withdrawn and granted again", async () => {
  let generation = 1;
  const bodies: string[] = [];
  const runtime = createObservationRuntime({
    baseUrl: "https://gateway.example",
    getPolicy: () => ({ granted: true, generation, userId: "user", contentMode: "none" }),
    resolveToken: async () => "token",
    fetch: async (_url, options) => {
      bodies.push(String(options?.body));
      return Response.json({});
    },
  });
  try {
    await runtime.run(
      async () => {
        generation = 3;
        runtime.invalidatePolicy();
        await runtime.run(() => runtime.runTool("read", async () => "old work"), { sessionId: "child" });
      },
      { sessionId: "parent" },
    );
    await runtime.flush();
    expect(bodies).toHaveLength(0);
    await runtime.run(async () => "new work", { sessionId: "new" });
    await runtime.flush();
    expect(bodies).toHaveLength(1);
  } finally {
    await runtime.shutdown();
  }
});

test("detailed tools export masked arguments and results without original images", async () => {
  const bodies: string[] = [];
  const runtime = createObservationRuntime({
    baseUrl: "https://gateway.example",
    getPolicy: () => ({ granted: true, generation: 1, userId: "user", contentMode: "full" }),
    resolveToken: async () => "token",
    maskText: (text) => text.replaceAll("sensitive-value", "[MASKED]"),
    fetch: async (_url, options) => {
      bodies.push(String(options?.body));
      return Response.json({});
    },
  });
  try {
    const args = { prompt: "sensitive-value" };
    const result = {
      output: "generated image",
      metadata: { path: "/tmp/output.png" },
      outputImages: [{ type: "image", data: "ORIGINAL_IMAGE", mediaType: "image/png" }],
    };
    const actual = await runtime.run(() => runtime.runTool("generate_image", async () => result, args), {
      sessionId: "session",
    });
    expect(actual).toBe(result);
    expect(args.prompt).toBe("sensitive-value");
    await runtime.flush();
    type Attribute = { key: string; value: { stringValue?: string; boolValue?: boolean } };
    type ToolSpan = { attributes: Attribute[] };
    type Payload = { resourceSpans: Array<{ scopeSpans: Array<{ spans: ToolSpan[] }> }> };
    const spans = bodies.flatMap((body) =>
      (JSON.parse(body) as Payload).resourceSpans.flatMap((group) => group.scopeSpans.flatMap((scope) => scope.spans)),
    );
    const tool = spans.find((span) => span.attributes.some((attr) => attr.key === "tool.name"))!;
    const attrs = Object.fromEntries(
      tool.attributes.map((attr) => [attr.key, attr.value.stringValue ?? attr.value.boolValue]),
    );
    expect(attrs["input.value"]).toContain("[MASKED]");
    expect(attrs["output.value"]).toContain("/tmp/output.png");
    expect(attrs["diligent.content.user_id"]).toBe("user");
    expect(bodies.join("")).not.toContain("ORIGINAL_IMAGE");
    expect(bodies.join("")).not.toContain("sensitive-value");
  } finally {
    await runtime.shutdown();
  }
});

test("escaped detailed tool fields cannot make the complete metadata span exceed the OTLP limit", async () => {
  const bodies: string[] = [];
  const runtime = createObservationRuntime({
    baseUrl: "https://gateway.example",
    getPolicy: () => ({ granted: true, generation: 1, userId: "user", contentMode: "full" }),
    resolveToken: async () => "token",
    maskText: (text) => text,
    fetch: async (_url, options) => {
      bodies.push(String(options?.body));
      return Response.json({});
    },
  });
  try {
    await runtime.run(() => runtime.runTool("large", async () => "\n".repeat(262144), "\n".repeat(262144)), {
      sessionId: "session",
    });
    await runtime.flush();
    expect(bodies).toHaveLength(2);
    expect(bodies.every((body) => Buffer.byteLength(body) <= 1048576)).toBe(true);
    expect(bodies.join("")).toContain("diligent.content.truncated");
    expect(bodies.join("")).toContain("tool.name");
  } finally {
    await runtime.shutdown();
  }
});
