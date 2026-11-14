import { describe, expect, test } from "bun:test";
import { sendToGateway } from "../../src/observability/gateway-transport";

describe("gateway telemetry transport", () => {
  test("sends authorized OTLP data using the current user token", async () => {
    const calls: Array<{ url: string; options: RequestInit }> = [];
    const result = await sendToGateway({
      baseUrl: "https://gateway.example",
      payload: '{"resourceSpans":[]}',
      generation: 3,
      userId: "user-1",
      getPolicy: () => ({ granted: true, generation: 3, userId: "user-1", contentMode: "none" }),
      resolveToken: async () => "user-token",
      fetch: async (url, options) => {
        calls.push({ url: String(url), options: options ?? {} });
        return new Response('{"partialSuccess":{}}', { status: 200 });
      },
    });
    expect(result).toEqual({ status: "accepted" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://gateway.example/v1/otel/traces");
    expect(new Headers(calls[0]?.options.headers).get("authorization")).toBe("Bearer user-token");
    expect(calls[0]?.options.body).toBe('{"resourceSpans":[]}');
  });

  test("drops data if consent is withdrawn while fetching a token", async () => {
    let granted = true;
    let sent = false;
    const result = await sendToGateway({
      baseUrl: "https://gateway.example",
      payload: "{}",
      generation: 1,
      userId: "user-1",
      getPolicy: () => ({ granted, generation: 1, userId: "user-1", contentMode: "none" }),
      resolveToken: async () => {
        granted = false;
        return "token";
      },
      fetch: async () => {
        sent = true;
        return new Response();
      },
    });
    expect(result).toEqual({ status: "dropped" });
    expect(sent).toBe(false);
  });

  test("reports partial acceptance instead of counting it as full delivery", async () => {
    const result = await sendToGateway({
      baseUrl: "https://gateway.example",
      payload: "{}",
      generation: 1,
      userId: "user-1",
      getPolicy: () => ({ granted: true, generation: 1, userId: "user-1", contentMode: "none" }),
      resolveToken: async () => "token",
      fetch: async () => new Response('{"partialSuccess":{"rejectedSpans":"2"}}', { status: 200 }),
    });
    expect(result).toEqual({ status: "partial", rejectedSpans: 2 });
  });
});

test("does not hang forever if resolving the user token never completes", async () => {
  let sent = false;
  const result = await sendToGateway({
    baseUrl: "https://gateway.example",
    payload: "{}",
    generation: 1,
    userId: "user-1",
    timeoutMs: 20,
    getPolicy: () => ({ granted: true, generation: 1, userId: "user-1", contentMode: "none" }),
    resolveToken: () => new Promise(() => {}),
    fetch: async () => {
      sent = true;
      return Response.json({});
    },
  });
  expect(result).toEqual({ status: "failed", retryable: true });
  expect(sent).toBe(false);
});
