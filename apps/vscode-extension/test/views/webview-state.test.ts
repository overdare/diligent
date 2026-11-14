import { describe, expect, test } from "bun:test";
import type { AgentEvent } from "@diligent/protocol";
import { applyAgentEvent, applyPanelMeta, applyThreadRead, initialConversationViewState } from "../../src/views/webview/state";

describe("webview shared-protocol state reducer", () => {
  test("applies thin panel meta without inventing transcript state", () => {
    const state = applyPanelMeta(initialConversationViewState, {
      connection: "ready",
      threadId: "thread-1",
      threadTitle: "Thread 1",
      threadStatus: "idle",
      lastError: null,
    });

    expect(state.connection).toBe("ready");
    expect(state.threadId).toBe("thread-1");
    expect(state.threadTitle).toBe("Thread 1");
    expect(state.items).toEqual([]);
  });

  test("meta can arrive before hydration without forcing transcript state", () => {
    const state = applyPanelMeta(initialConversationViewState, {
      connection: "ready",
      threadId: "thread-1",
      threadTitle: "Thread 1",
      threadStatus: null,
      lastError: null,
    });

    expect(state.threadStatus).toBeNull();
    expect(state.items).toEqual([]);
  });

  test("hydrates committed transcript from ThreadReadResponse", () => {
    const state = applyThreadRead(initialConversationViewState, {
      cwd: "/tmp",
      items: [
        {
          type: "userMessage",
          message: {
            role: "user",
            content: "hello",
            timestamp: Date.now(),
          },
        },
      ],
      hasFollowUp: false,
      entryCount: 1,
      isRunning: false,
      currentEffort: "medium",
    });

    expect(state.items).toHaveLength(1);
    expect(state.threadStatus).toBe("idle");
    expect(state.liveText).toBe("");
  });

  test("streams live output from a shared AgentEvent", () => {
    const startEvent: AgentEvent = {
      type: "message_start",
      itemId: "item-1",
      message: {
        role: "assistant",
        content: [],
        model: "gpt-test",
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        stopReason: "end_turn",
        timestamp: Date.now(),
      },
    };
    const deltaEvent: AgentEvent = {
      type: "message_delta",
      itemId: "item-1",
      message: startEvent.message,
      delta: { type: "text_delta", delta: "Hello" },
    };

    const afterStart = applyAgentEvent(initialConversationViewState, startEvent);
    const afterDelta = applyAgentEvent(afterStart, deltaEvent);

    expect(afterDelta.overlayStatus).toBeNull();
    expect(afterDelta.liveText).toBe("Hello");
  });
});
