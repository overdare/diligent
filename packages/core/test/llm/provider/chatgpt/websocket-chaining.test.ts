// @summary Tests for ChatGPT WebSocket previous_response_id chaining across turns in one conversation
import { afterEach, describe, expect, test } from "bun:test";
import { resolveModel } from "../../../../src/llm/models";
import { createChatGPTStream } from "../../../../src/llm/provider/chatgpt";
import {
  createStreamSessionScope,
  createStreamTurnScope,
  type StreamSessionScope,
} from "../../../../src/llm/turn-scope";
import type { ProviderEvent, StreamContext } from "../../../../src/llm/types";
import type { AssistantMessage } from "../../../../src/types";
import {
  collectEvents,
  createWebSocketHarness,
  type FakeChatGPTWebSocket,
  restoreChatGPTStreamTestState,
  TEST_CONTEXT,
  testTokens,
} from "../../../helpers/chatgpt-stream";

afterEach(restoreChatGPTStreamTestState);

const MODEL = resolveModel({ provider: "chatgpt", modelId: "gpt-6-luna" });

function completeWithId(socket: FakeChatGPTWebSocket, responseId: string, extra: Record<string, unknown>[] = []): void {
  queueMicrotask(() => {
    socket.emit({ type: "response.created", response: { id: responseId, status: "in_progress" } });
    for (const payload of extra) socket.emit(payload);
    socket.emit({ type: "response.output_text.delta", delta: `answer ${responseId}` });
    socket.emit({
      type: "response.completed",
      response: { id: responseId, status: "completed", usage: { input_tokens: 1, output_tokens: 1 } },
    });
  });
}

function doneMessage(events: ProviderEvent[]): AssistantMessage {
  const done = events.find((event): event is Extract<ProviderEvent, { type: "done" }> => event.type === "done");
  if (!done) throw new Error("expected a done event");
  return done.message;
}

function nextTurnContext(previous: StreamContext, assistant: AssistantMessage, text: string): StreamContext {
  return {
    ...previous,
    messages: [
      ...previous.messages,
      assistant,
      { role: "user", content: text, timestamp: previous.messages.length + 2 },
    ],
  };
}

async function runTurn(
  stream: ReturnType<typeof createChatGPTStream>,
  session: StreamSessionScope,
  context: StreamContext,
): Promise<ProviderEvent[]> {
  const turnScope = createStreamTurnScope({ session });
  try {
    return await collectEvents(
      stream(MODEL, context, {
        effort: "medium",
        sessionId: "session-1",
        turnScope,
        turnStateRef: turnScope.turnStateRef,
      }),
    );
  } finally {
    await turnScope.dispose();
  }
}

describe("ChatGPT WebSocket chaining", () => {
  test("keeps the socket across turns and sends only new input with previous_response_id", async () => {
    const sent: Record<string, unknown>[] = [];
    const harness = createWebSocketHarness((body, socket) => {
      sent.push(body);
      completeWithId(socket, `resp_${sent.length}`);
    });
    const stream = createChatGPTStream(() => testTokens(), { webSocketFactory: harness.factory });
    const session = createStreamSessionScope();

    const first = await runTurn(stream, session, TEST_CONTEXT);
    const secondContext = nextTurnContext(TEST_CONTEXT, doneMessage(first), "second question");
    const second = await runTurn(stream, session, secondContext);

    expect(second.some((event) => event.type === "done")).toBe(true);
    expect(harness.requests).toHaveLength(1);
    expect(harness.requests[0]?.socket.closed).toBe(false);
    expect(sent[0]?.previous_response_id).toBeUndefined();
    expect(sent[1]?.previous_response_id).toBe("resp_1");
    expect(sent[1]?.input).toEqual([
      { type: "message", role: "user", content: [{ type: "input_text", text: "second question" }] },
    ]);

    await session.dispose();
    expect(harness.requests[0]?.socket.closed).toBe(true);
  });

  test("replays the full input in the same call when the server rejects the previous response id", async () => {
    const sent: Record<string, unknown>[] = [];
    const harness = createWebSocketHarness((body, socket) => {
      sent.push(body);
      if (body.previous_response_id) {
        queueMicrotask(() =>
          socket.emit({
            type: "error",
            status: 400,
            error: { type: "invalid_request_error", message: "Invalid `previous_response_id`." },
          }),
        );
        return;
      }
      completeWithId(socket, `resp_${sent.length}`);
    });
    const stream = createChatGPTStream(() => testTokens(), { webSocketFactory: harness.factory });
    const session = createStreamSessionScope();

    const first = await runTurn(stream, session, TEST_CONTEXT);
    const secondContext = nextTurnContext(TEST_CONTEXT, doneMessage(first), "second question");
    const second = await runTurn(stream, session, secondContext);

    expect(second.some((event) => event.type === "error")).toBe(false);
    expect(second.filter((event) => event.type === "start")).toHaveLength(1);
    expect(sent).toHaveLength(3);
    expect(sent[2]?.previous_response_id).toBeUndefined();
    expect((sent[2]?.input as unknown[]).length).toBeGreaterThan((sent[1]?.input as unknown[]).length);
    await session.dispose();
  });

  test("replays the full input on a fresh socket when a reused socket stays silent", async () => {
    const sent: Record<string, unknown>[] = [];
    const harness = createWebSocketHarness((body, socket) => {
      sent.push(body);
      if (body.previous_response_id) return;
      completeWithId(socket, `resp_${sent.length}`);
    });
    const stream = createChatGPTStream(() => testTokens(), {
      webSocketFactory: harness.factory,
      webSocketChainedFirstEventTimeoutMs: 5,
    });
    const session = createStreamSessionScope();

    const first = await runTurn(stream, session, TEST_CONTEXT);
    const second = await runTurn(stream, session, nextTurnContext(TEST_CONTEXT, doneMessage(first), "again"));

    expect(second.some((event) => event.type === "done")).toBe(true);
    expect(harness.requests).toHaveLength(2);
    expect(harness.requests[0]?.socket.terminated).toBe(true);
    expect(sent[2]?.previous_response_id).toBeUndefined();
    await session.dispose();
  });

  test("sends the full input after the socket holding the chain closed", async () => {
    const sent: Record<string, unknown>[] = [];
    const harness = createWebSocketHarness((body, socket) => {
      sent.push(body);
      completeWithId(socket, `resp_${sent.length}`);
    });
    const stream = createChatGPTStream(() => testTokens(), { webSocketFactory: harness.factory });
    const session = createStreamSessionScope();

    const first = await runTurn(stream, session, TEST_CONTEXT);
    harness.requests[0]?.socket.emitClose(1000, "connection limit");
    const second = await runTurn(stream, session, nextTurnContext(TEST_CONTEXT, doneMessage(first), "again"));

    expect(second.some((event) => event.type === "done")).toBe(true);
    expect(harness.requests).toHaveLength(2);
    expect(sent[1]?.previous_response_id).toBeUndefined();
    await session.dispose();
  });

  test("replays the turn token per request within a turn but never into the next turn", async () => {
    const sent: Record<string, unknown>[] = [];
    const harness = createWebSocketHarness((body, socket) => {
      sent.push(body);
      completeWithId(socket, `resp_${sent.length}`, [
        { type: "codex.response.metadata", headers: { "x-codex-turn-state": `turn-token-${sent.length}` } },
      ]);
    });
    const stream = createChatGPTStream(() => testTokens(), { webSocketFactory: harness.factory });
    const session = createStreamSessionScope();
    const turnScope = createStreamTurnScope({ session });
    const options = {
      effort: "medium" as const,
      sessionId: "session-1",
      turnScope,
      turnStateRef: turnScope.turnStateRef,
    };

    const first = await collectEvents(stream(MODEL, TEST_CONTEXT, options));
    const followUp = nextTurnContext(TEST_CONTEXT, doneMessage(first), "tool follow-up");
    await collectEvents(stream(MODEL, followUp, options));
    await turnScope.dispose();
    const second = await runTurn(stream, session, TEST_CONTEXT);

    expect(second.some((event) => event.type === "done")).toBe(true);
    expect(harness.requests[0]?.headers["x-codex-turn-state"]).toBeUndefined();
    expect(sent[0]?.client_metadata).toBeUndefined();
    expect(sent[1]?.client_metadata).toEqual({ "x-codex-turn-state": "turn-token-1" });
    expect(sent[2]?.client_metadata).toBeUndefined();
    await session.dispose();
  });
});
