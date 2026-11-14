import { expect, test } from "bun:test";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { SpanDelivery } from "../../src/observability/span-delivery";
import { ConsentSpanProcessor } from "../../src/observability/span-processor";

test("exports sanitized spans to the gateway as standard OTLP JSON", async () => {
  const policy = { granted: true, generation: 1, userId: "user-1", contentMode: "none" as const };
  const bodies: string[] = [];
  const delivery = new SpanDelivery({
    baseUrl: "https://gateway.example",
    getPolicy: () => policy,
    resolveToken: async () => "token",
    fetch: async (_url, options) => {
      bodies.push(String(options?.body));
      return Response.json({});
    },
  });
  const processor = new ConsentSpanProcessor({
    getPolicy: () => policy,
    isAuthorizedContext: () => true,
    onSpan: (span, snapshot) => delivery.enqueue(span, snapshot),
  });
  const provider = new NodeTracerProvider({ spanProcessors: [processor] });
  const span = provider.getTracer("test").startSpan("private prompt", {
    attributes: { "input.value": "secret text", "llm.model_name": "sample", "openinference.span.kind": "LLM" },
  });
  const traceId = span.spanContext().traceId;
  span.end();
  await delivery.flush();
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).not.toContain("secret text");
  expect(bodies[0]).not.toContain("private prompt");
  const payload = JSON.parse(bodies[0]!);
  expect(payload.resourceSpans[0].scopeSpans[0].spans[0].traceId).toBe(traceId);
  await provider.shutdown();
});

test("discards queued data after consent changes", async () => {
  let generation = 1;
  let sends = 0;
  const getPolicy = () => ({ granted: true, generation, userId: "user-1", contentMode: "none" as const });
  const delivery = new SpanDelivery({
    baseUrl: "https://gateway.example",
    getPolicy,
    resolveToken: async () => "token",
    fetch: async () => {
      sends++;
      return Response.json({});
    },
  });
  const processor = new ConsentSpanProcessor({
    getPolicy,
    isAuthorizedContext: () => true,
    onSpan: (span, policy) => delivery.enqueue(span, policy),
  });
  const provider = new NodeTracerProvider({ spanProcessors: [processor] });
  provider.getTracer("test").startSpan("test").end();
  generation++;
  await delivery.flush();
  expect(sends).toBe(0);
  expect(delivery.pendingCount).toBe(0);
  await provider.shutdown();
});

test("retries transient errors without retrying successful payloads", async () => {
  let calls = 0;
  const policy = { granted: true, generation: 1, userId: "user-1", contentMode: "none" as const };
  const delivery = new SpanDelivery({
    baseUrl: "https://gateway.example",
    getPolicy: () => policy,
    resolveToken: async () => "token",
    wait: async () => {},
    fetch: async () => {
      calls++;
      return calls === 1 ? new Response("", { status: 503 }) : Response.json({});
    },
  });
  const processor = new ConsentSpanProcessor({
    getPolicy: () => policy,
    isAuthorizedContext: () => true,
    onSpan: (span, snapshot) => delivery.enqueue(span, snapshot),
  });
  const provider = new NodeTracerProvider({ spanProcessors: [processor] });
  provider.getTracer("test").startSpan("test").end();
  await delivery.flush();
  expect(calls).toBe(2);
  expect(delivery.droppedCount).toBe(0);
  await provider.shutdown();
});

test("honors retry-after when the gateway asks the client to slow down", async () => {
  let calls = 0;
  const delays: number[] = [];
  const policy = { granted: true, generation: 1, userId: "user-1", contentMode: "none" as const };
  const delivery = new SpanDelivery({
    baseUrl: "https://gateway.example",
    getPolicy: () => policy,
    resolveToken: async () => "token",
    wait: async (ms) => {
      delays.push(ms);
    },
    fetch: async () => {
      calls++;
      return calls === 1 ? new Response("", { status: 429, headers: { "Retry-After": "2" } }) : Response.json({});
    },
  });
  const processor = new ConsentSpanProcessor({
    getPolicy: () => policy,
    isAuthorizedContext: () => true,
    onSpan: (span, snapshot) => delivery.enqueue(span, snapshot),
  });
  const provider = new NodeTracerProvider({ spanProcessors: [processor] });
  provider.getTracer("test").startSpan("test").end();
  await delivery.flush();
  expect(calls).toBe(2);
  expect(delays[0]).toBeGreaterThanOrEqual(2000);
  await provider.shutdown();
});
