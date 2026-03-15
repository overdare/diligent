// @summary Tests for SessionTurnRunner staging, commit, and error handling

import { describe, expect, test } from "bun:test";
import { Agent } from "@diligent/core/agent";
import { EventStream } from "@diligent/core/event-stream";
import type { Model, ProviderEvent, ProviderResult, StreamFunction } from "@diligent/core/llm/types";
import type { AssistantMessage, Message } from "@diligent/core/types";
import type { SessionEntry } from "@diligent/runtime/session";
import { SessionStateStore, SessionTurnRunner } from "@diligent/runtime/session";

const TEST_MODEL: Model = {
  id: "test-model",
  provider: "test",
  contextWindow: 100_000,
  maxOutputTokens: 4096,
  supportsThinking: false,
};

function makeAssistant(text: string = "hi"): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    model: TEST_MODEL.id,
    usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
    stopReason: "end_turn",
    timestamp: Date.now(),
  };
}

function createMockStreamFn(responses: AssistantMessage[]): StreamFunction {
  let callIndex = 0;
  return (_model, _context, _options) => {
    const outcome = responses[callIndex++] ?? makeAssistant();
    const stream = new EventStream<ProviderEvent, ProviderResult>(
      (event) => event.type === "done" || event.type === "error",
      (event) => {
        if (event.type === "done") return { message: event.message };
        throw (event as { type: "error"; error: Error }).error;
      },
    );

    queueMicrotask(() => {
      stream.push({ type: "start" });
      const firstText = outcome.content[0];
      if (firstText?.type === "text") {
        stream.push({ type: "text_delta", delta: firstText.text });
      }
      stream.push({ type: "done", stopReason: outcome.stopReason, message: outcome });
    });

    return stream;
  };
}

describe("SessionTurnRunner", () => {
  test("commits staged entries after a successful turn", async () => {
    const state = new SessionStateStore();
    const committed: SessionEntry[][] = [];
    const errors: string[] = [];
    let activeAgent: Agent | null = null;
    let initializedAgent: Agent | null = null;
    const runner = new SessionTurnRunner({
      state,
      resolveAgent: () =>
        new Agent(TEST_MODEL, [{ label: "test", content: "test" }], [], {
          effort: "medium",
          llmMsgStreamFn: createMockStreamFn([makeAssistant("done")]),
        }),
      sessionId: "session-1",
      drainPendingMessages: () => [],
      getInitializedAgent: () => initializedAgent,
      setInitializedAgent: (agent) => {
        initializedAgent = agent;
      },
      setActiveAgent: (agent) => {
        activeAgent = agent;
      },
      emitEvent: () => {},
      handleUsage: () => {},
      commitEntries: (entries) => {
        committed.push(entries);
        state.appendCommitted(entries);
      },
      onFatalError: (error) => {
        errors.push(error.message);
      },
      summarizeLastPersistedMessage: () => "none",
    });

    const userMessage: Message = { role: "user", content: "hello", timestamp: Date.now() };
    await runner.run(userMessage);

    expect(activeAgent).not.toBeNull();
    expect(committed).toHaveLength(1);
    expect(committed[0]).toHaveLength(2);
    expect(state.getCommittedEntries()).toHaveLength(2);
    expect(state.getVisibleState().entries).toHaveLength(2);
    expect(errors).toEqual([]);
  });

  test("does not commit staged entries when the turn fails", async () => {
    const state = new SessionStateStore();
    const committed: SessionEntry[][] = [];
    const errors: string[] = [];
    let initializedAgent: Agent | null = null;
    const runner = new SessionTurnRunner({
      state,
      resolveAgent: () =>
        new Agent(TEST_MODEL, [{ label: "test", content: "test" }], [], {
          effort: "medium",
          llmMsgStreamFn: () => {
            throw new Error("provider failed");
          },
        }),
      sessionId: "session-1",
      drainPendingMessages: () => [],
      getInitializedAgent: () => initializedAgent,
      setInitializedAgent: (agent) => {
        initializedAgent = agent;
      },
      setActiveAgent: () => {},
      emitEvent: () => {},
      handleUsage: () => {},
      commitEntries: (entries) => {
        committed.push(entries);
      },
      onFatalError: (error) => {
        errors.push(error.message);
      },
      summarizeLastPersistedMessage: () => "none",
    });

    await runner.run({ role: "user", content: "hello", timestamp: Date.now() });

    expect(committed).toEqual([]);
    expect(state.getCommittedEntries()).toEqual([]);
    expect(state.getVisibleState().entries).toEqual([]);
    expect(errors).toEqual(["provider failed"]);
  });
});
