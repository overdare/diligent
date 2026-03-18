// @summary Tests resume history hydration behavior in AppSessionLifecycle

import { describe, expect, mock, test } from "bun:test";
import { AppSessionLifecycle } from "../../src/tui/app-session-lifecycle";

function createLifecycleWithThreadRead(threadRead: unknown) {
  const addUserMessage = mock(() => {});
  const addAssistantMessage = mock(() => {});
  const addThinkingMessage = mock(() => {});
  const addToolResultMessage = mock(() => {});
  const addLines = mock(() => {});
  const handleEvent = mock(() => {});

  const lifecycle = new AppSessionLifecycle({
    config: {
      model: { id: "test-model", contextWindow: 200000 },
      diligent: {},
      providerManager: { hasKeyFor: () => true },
    } as never,
    runtime: { currentMode: "default", currentEffort: "medium" } as never,
    terminal: { columns: 100 } as never,
    renderer: { setFocus: () => {}, start: () => {}, requestRender: () => {} } as never,
    inputHistory: { load: async () => {} } as never,
    inputEditor: { reloadHistory: () => {} } as never,
    statusBar: { update: () => {} } as never,
    chatView: {
      addUserMessage,
      addAssistantMessage,
      addThinkingMessage,
      addToolResultMessage,
      addLines,
      handleEvent,
    } as never,
    setupWizard: { runSetupWizard: async () => {} } as never,
    threadManager: {
      readThread: async () => threadRead,
    } as never,
    pathsAvailable: true,
    getRpcClient: () => ({}) as never,
    restartRpcClient: async () => {},
    pkgVersion: "0.0.0-test",
  });

  return {
    lifecycle,
    addUserMessage,
    addAssistantMessage,
    addThinkingMessage,
    addToolResultMessage,
    addLines,
    handleEvent,
  };
}

describe("AppSessionLifecycle", () => {
  test("hydrateThreadHistory restores user and assistant messages from snapshot items", async () => {
    const { lifecycle, addUserMessage, addAssistantMessage, addLines, handleEvent } = createLifecycleWithThreadRead({
      items: [
        {
          type: "userMessage",
          itemId: "u1",
          message: { role: "user", content: "hello", timestamp: 1 },
          timestamp: 1,
        },
        {
          type: "agentMessage",
          itemId: "a1",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "hi there" }],
            model: "test-model",
            usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
            stopReason: "end_turn",
            timestamp: 2,
          },
          usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
          cost: 0.01,
          timestamp: 2,
        },
      ],
    });

    await (lifecycle as never).hydrateThreadHistory();

    expect(addLines).toHaveBeenCalled();
    expect(addUserMessage).toHaveBeenCalledWith("hello");
    expect(addAssistantMessage).toHaveBeenCalledWith("hi there");
    expect(handleEvent).toHaveBeenCalledWith({
      type: "usage",
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      cost: 0.01,
    });
  });
});
