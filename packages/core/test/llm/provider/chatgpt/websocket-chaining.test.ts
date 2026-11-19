// @summary Tests for ChatGPT WebSocket previous_response_id chaining across turns in one conversation
import { afterEach, describe, expect, test } from "bun:test";
import { resolveModel } from "../../../../src/llm/models";
import { createChatGPTStream } from "../../../../src/llm/provider/chatgpt";
import {
  createStreamSessionScope,
  createStreamTurnScope,
  type StreamSessionScope,
} from "../../../../src/llm/turn-scope";
import type { ProviderEvent, StreamContext, StreamOptions } from "../../../../src/llm/types";
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

function completeWithId(socket: FakeChatGPTWebSocket, responseId: string): void {
  queueMicrotask(() => {
    socket.emit({ type: "response.created", response: { id: responseId, status: "in_progress" } });
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
  observeExchange?: StreamOptions["observeExchange"],
): Promise<ProviderEvent[]> {
  const turnScope = createStreamTurnScope({ session });
  try {
    return await collectEvents(
      stream(MODEL, context, {
        observeExchange,
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
  test("ignores a non-string event type while observing a WebSocket exchange", async () => {
    const harness = createWebSocketHarness((_body, socket) => {
      socket.emit({ type: { toString: 0, valueOf: 0 } });
      completeWithId(socket, "normal_response");
    });
    const stream = createChatGPTStream(() => testTokens(), { webSocketFactory: harness.factory });
    const session = createStreamSessionScope();
    try {
      const events = await runTurn(stream, session, TEST_CONTEXT, () => ({
        firstText() {},
        usage() {},
        end() {},
      }));
      expect(doneMessage(events).stopReason).toBe("end_turn");
      expect(events.some((event) => event.type === "error")).toBe(false);
    } finally {
      await session.dispose();
    }
  });

  test("starts observing a WebSocket request after the socket opens", async () => {
    const steps: string[] = [];
    const harness = createWebSocketHarness((_body, socket) => {
      steps.push("send");
      completeWithId(socket, "response");
    });
    const stream = createChatGPTStream(() => testTokens(), {
      webSocketFactory(url, headers) {
        steps.push("connect");
        return harness.factory(url, headers);
      },
    });
    const session = createStreamSessionScope();
    try {
      await runTurn(stream, session, TEST_CONTEXT, () => {
        steps.push("observe");
        return undefined;
      });
      expect(steps).toEqual(["connect", "observe", "send"]);
    } finally {
      await session.dispose();
    }
  });

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

  const rejectionShapes: Array<{ name: string; frames: Record<string, unknown>[] }> = [
    {
      name: "an immediate error frame",
      frames: [
        {
          type: "error",
          status: 400,
          error: { type: "invalid_request_error", message: "Invalid `previous_response_id`." },
        },
      ],
    },
    {
      name: "an error frame after response.created",
      frames: [
        { type: "response.created", response: { id: "resp_rejected", status: "in_progress" } },
        { type: "error", status: 400, error: { type: "invalid_request_error", code: "previous_response_not_found" } },
      ],
    },
    {
      name: "a response.failed frame",
      frames: [
        {
          type: "response.failed",
          response: {
            id: "resp_rejected",
            status: "failed",
            error: { code: "previous_response_not_found", message: "Previous response not found." },
          },
        },
      ],
    },
  ];

  for (const shape of rejectionShapes) {
    test(`replays the full input in the same call when the server rejects the chain with ${shape.name}`, async () => {
      const sent: Record<string, unknown>[] = [];
      const harness = createWebSocketHarness((body, socket) => {
        sent.push(body);
        if (body.previous_response_id) {
          queueMicrotask(() => {
            for (const frame of shape.frames) socket.emit(frame);
          });
          return;
        }
        completeWithId(socket, `resp_${sent.length}`);
      });
      const stream = createChatGPTStream(() => testTokens(), { webSocketFactory: harness.factory });
      const session = createStreamSessionScope();

      const exchanges: Array<{ input: unknown; billed?: number; endings: string[] }> = [];
      const observe: NonNullable<StreamOptions["observeExchange"]> = (_model, request) => {
        const entry: (typeof exchanges)[number] = { input: request.input, endings: [] };
        exchanges.push(entry);
        return {
          firstText() {},
          usage(counts) {
            entry.billed = counts.prompt;
          },
          end(_message, failure) {
            entry.endings.push(failure ? "failed" : "ok");
          },
        };
      };
      const first = await runTurn(stream, session, TEST_CONTEXT, observe);
      const secondContext = nextTurnContext(TEST_CONTEXT, doneMessage(first), "second question");
      const second = await runTurn(stream, session, secondContext, observe);
      expect(exchanges.map((exchange) => exchange.input)).toEqual(sent.map((request) => request.input));
      expect(exchanges.map((exchange) => exchange.endings)).toEqual([["ok"], ["failed"], ["ok"]]);
      expect(exchanges.map((exchange) => exchange.billed)).toEqual([1, undefined, 1]);
      expect(second.some((event) => event.type === "error")).toBe(false);
      expect(second.filter((event) => event.type === "start")).toHaveLength(1);
      expect(sent).toHaveLength(3);
      expect(sent[1]?.previous_response_id).toBe("resp_1");
      expect(sent[2]?.previous_response_id).toBeUndefined();
      expect(sent[2]?.input).toEqual(
        sent[0] && [
          ...(sent[0].input as unknown[]),
          { role: "assistant", content: "answer resp_1" },
          { type: "message", role: "user", content: [{ type: "input_text", text: "second question" }] },
        ],
      );
      await session.dispose();
    });
  }

  test("surfaces a chain rejection without replaying once output reached the consumer", async () => {
    const sent: Record<string, unknown>[] = [];
    const harness = createWebSocketHarness((body, socket) => {
      sent.push(body);
      if (body.previous_response_id) {
        queueMicrotask(() => {
          socket.emit({ type: "response.output_text.delta", delta: "partial" });
          socket.emit({ type: "error", status: 400, error: { code: "previous_response_not_found" } });
        });
        return;
      }
      completeWithId(socket, `resp_${sent.length}`);
    });
    const stream = createChatGPTStream(() => testTokens(), { webSocketFactory: harness.factory });
    const session = createStreamSessionScope();

    const first = await runTurn(stream, session, TEST_CONTEXT);
    const second = await runTurn(stream, session, nextTurnContext(TEST_CONTEXT, doneMessage(first), "again"));

    expect(second.some((event) => event.type === "error")).toBe(true);
    expect(sent).toHaveLength(2);
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
});
