import { describe, expect, test } from "bun:test";
import { NodeTracerProvider, type ReadableSpan } from "@opentelemetry/sdk-trace-node";
import { ConsentSpanProcessor } from "../../src/observability/span-processor";

describe("consent span processor", () => {
  test("exports an isolated metadata-only span after an authorized operation", () => {
    const exported: ReadableSpan[] = [];
    const policy = { granted: true, generation: 1, userId: "user", contentMode: "none" as const };
    const processor = new ConsentSpanProcessor({
      getPolicy: () => policy,
      isAuthorizedContext: () => true,
      onSpan: (span) => exported.push(span),
    });
    const provider = new NodeTracerProvider({ spanProcessors: [processor] });
    const span = provider.getTracer("test").startSpan("secret prompt", {
      attributes: {
        "llm.model_name": "model-1",
        "llm.token_count.total": 12,
        "input.value": "private history",
        "openinference.span.kind": "LLM",
      },
    });
    span.addEvent("private event", { value: "secret" });
    span.setStatus({ code: 2, message: "secret error" });
    span.end();
    expect(exported).toHaveLength(1);
    expect(exported[0]?.attributes).toEqual({
      "llm.model_name": "model-1",
      "llm.token_count.total": 12,
      "openinference.span.kind": "LLM",
    });
    expect(exported[0]?.name).toBe("diligent.llm");
    expect(exported[0]?.events).toEqual([]);
    expect(exported[0]?.status).toEqual({ code: 2 });
  });

  test("discards a span after consent generation changes", () => {
    let generation = 1;
    const exported: ReadableSpan[] = [];
    const processor = new ConsentSpanProcessor({
      getPolicy: () => ({ granted: true, generation, userId: "user", contentMode: "none" }),
      isAuthorizedContext: () => true,
      onSpan: (span) => exported.push(span),
    });
    const provider = new NodeTracerProvider({ spanProcessors: [processor] });
    const span = provider.getTracer("test").startSpan("model");
    generation++;
    span.end();
    expect(exported).toEqual([]);
  });

  test("does not export spans outside an authorized operation", () => {
    const exported: ReadableSpan[] = [];
    const processor = new ConsentSpanProcessor({
      getPolicy: () => ({ granted: true, generation: 1, userId: "user", contentMode: "none" }),
      isAuthorizedContext: () => false,
      onSpan: (span) => exported.push(span),
    });
    const provider = new NodeTracerProvider({ spanProcessors: [processor] });
    provider.getTracer("test").startSpan("background").end();
    expect(exported).toEqual([]);
  });
});

test("only detailed mode exports masked SDK messages and the verified content identity", () => {
  for (const mode of ["none", "current-turn", "full"] as const) {
    const exported: ReadableSpan[] = [];
    const processor = new ConsentSpanProcessor({
      getPolicy: () => ({ granted: true, generation: 1, userId: "user", contentMode: mode }),
      isAuthorizedContext: () => true,
      maskText: (text: string) => text.replaceAll("sensitive-value", "[MASKED]"),
      onSpan: (span) => exported.push(span),
    });
    const provider = new NodeTracerProvider({ spanProcessors: [processor] });
    provider
      .getTracer("test")
      .startSpan("model", {
        attributes: {
          "openinference.span.kind": "LLM",
          "input.value": JSON.stringify({ messages: [{ role: "user", content: "sensitive-value" }] }),
          "output.value": JSON.stringify({ role: "assistant", content: [{ type: "text", text: "answer" }] }),
        },
      })
      .end();
    expect(exported).toHaveLength(1);
    const attrs = exported[0]!.attributes;
    if (mode === "full") {
      expect(String(attrs["gen_ai.input.messages"])).toContain("[MASKED]");
      expect(attrs["diligent.content.user_id"]).toBe("user");
      expect(String(attrs["gen_ai.output.messages"])).toContain("answer");
    } else {
      expect(attrs["gen_ai.input.messages"]).toBeUndefined();
      expect(attrs["diligent.content.user_id"]).toBeUndefined();
    }
    expect(JSON.stringify(attrs)).not.toContain("sensitive-value");
  }
});

test("does not attach detailed messages when content mode is downgraded during a model call", () => {
  let full = true;
  const exported: ReadableSpan[] = [];
  const processor = new ConsentSpanProcessor({
    getPolicy: () => ({ granted: true, generation: 1, userId: "user", contentMode: full ? "full" : "none" }),
    isAuthorizedContext: () => true,
    maskText: (text: string) => text,
    onSpan: (span) => exported.push(span),
  });
  const provider = new NodeTracerProvider({ spanProcessors: [processor] });
  const span = provider
    .getTracer("test")
    .startSpan("model", { attributes: { "openinference.span.kind": "LLM", "input.value": "private input" } });
  full = false;
  span.end();
  expect(JSON.stringify(exported.map((span) => span.attributes))).not.toContain("private input");
});

test("invalid detailed content cannot discard the model metadata span", () => {
  const exported: ReadableSpan[] = [];
  const processor = new ConsentSpanProcessor({
    getPolicy: () => ({ granted: true, generation: 1, userId: "user", contentMode: "full" }),
    isAuthorizedContext: () => true,
    maskText: () => {
      throw new Error("masker unavailable");
    },
    onSpan: (span) => exported.push(span),
  });
  const provider = new NodeTracerProvider({ spanProcessors: [processor] });
  provider
    .getTracer("test")
    .startSpan("model", {
      attributes: { "openinference.span.kind": "LLM", "llm.model_name": "model-1", "input.value": "private text" },
    })
    .end();
  expect(exported).toHaveLength(1);
  expect(exported[0]?.attributes["llm.model_name"]).toBe("model-1");
  expect(JSON.stringify(exported[0]?.attributes)).not.toContain("private text");
});
