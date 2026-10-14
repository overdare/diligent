// @summary ChatGPT Fast mode controls the wire tier across HTTP and WebSocket transports
import { afterEach, expect, test } from "bun:test";
import { resolveModel } from "../../../../src/llm/models";
import { createChatGPTStream } from "../../../../src/llm/provider/chatgpt";
import {
  chatGPTSuccessResponse,
  collectEvents,
  completeWebSocketResponse,
  createWebSocketHarness,
  restoreChatGPTStreamTestState,
  TEST_CONTEXT,
  testTokens,
} from "../../../helpers/chatgpt-stream";

afterEach(restoreChatGPTStreamTestState);

for (const transport of ["http", "websocket"] as const) {
  test(`ChatGPT ${transport} preserves model and effort while toggling Fast mode`, async () => {
    const bodies: Record<string, unknown>[] = [];
    globalThis.fetch = (async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return chatGPTSuccessResponse();
    }) as typeof fetch;
    const harness = createWebSocketHarness((body, socket) => {
      bodies.push(body);
      completeWebSocketResponse(socket);
    });
    const stream = createChatGPTStream(() => testTokens(), {
      useWebSocketForGpt56: transport === "websocket",
      webSocketFactory: harness.factory,
    });
    const model = resolveModel({ provider: "chatgpt", modelId: "gpt-6.1-sol" });
    for (const fastMode of [true, false]) {
      const events = await collectEvents(stream(model, TEST_CONTEXT, { fastMode, effort: "high" }));
      expect(events.at(-1)?.type).toBe("done");
    }
    expect(bodies.map((body) => ({ model: body.model, tier: body.service_tier, reasoning: body.reasoning }))).toEqual([
      { model: model.modelId, tier: "priority", reasoning: { effort: "high", summary: "auto", context: "all_turns" } },
      { model: model.modelId, tier: "default", reasoning: { effort: "high", summary: "auto", context: "all_turns" } },
    ]);
  });
}

test("Fast mode does not add a service tier to unsupported models", async () => {
  let body: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return chatGPTSuccessResponse();
  }) as typeof fetch;
  const stream = createChatGPTStream(() => testTokens());
  const model = { ...resolveModel({ provider: "chatgpt", modelId: "gpt-6.1-sol" }), supportsFastMode: false };
  await collectEvents(stream(model, TEST_CONTEXT, { fastMode: true }));
  expect(body?.model).toBe(model.modelId);
  expect(body).not.toHaveProperty("service_tier");
});
