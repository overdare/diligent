// @summary Tests startup metadata synchronization and bounded history presentation

import { describe, expect, mock, test } from "bun:test";
import type { ThreadItem } from "@diligent/protocol";
import { resolveModel } from "@diligent/runtime";
import { AppRuntimeState } from "../../src/tui/app-runtime-state";
import { AppSessionLifecycle } from "../../src/tui/app-session-lifecycle";
import { appendHistoryItems } from "../../src/tui/components/history-items";
import type { ThreadStore } from "../../src/tui/components/thread-store";

const TEST_ANTHROPIC_MODEL_ID = "claude-sonnet-5";

function createLifecycleWithThreadRead(threadRead: unknown, runtime = new AppRuntimeState("default", "medium")) {
  const addUserMessage = mock(() => {});
  const addAssistantMessage = mock(() => {});
  const addThinkingMessage = mock(() => {});
  const addToolResultMessage = mock(() => {});
  const addStructuredItem = mock(() => {});
  const addLines = mock(() => {});
  const handleEvent = mock(() => {});

  const lifecycle = new AppSessionLifecycle({
    config: {
      model: { id: "test-model", contextWindow: 200000 },
      diligent: {},
      providerManager: { hasKeyFor: () => true },
    } as never,
    runtime,
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
      addStructuredItem,
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
    renderHistory: () => {
      // Rendering fixtures supply items; metadata-only fixtures never call this helper.
      const history = threadRead as { items: ThreadItem[] };
      appendHistoryItems(
        {
          addUserMessage,
          addAssistantMessage,
          addThinkingMessage,
          addToolResultMessage,
          addStructuredItem,
          addLines,
          handleEvent,
        } as unknown as ThreadStore,
        history.items,
      );
    },
    lifecycle,
    addUserMessage,
    addAssistantMessage,
    addThinkingMessage,
    addToolResultMessage,
    addStructuredItem,
    addLines,
    handleEvent,
  };
}

describe("AppSessionLifecycle", () => {
  test("opening a stopped thread shows its reason and resume command without waiting for a new event", async () => {
    const runtime = new AppRuntimeState("default", "medium");
    runtime.currentThreadId = "thread";
    const { lifecycle, addLines } = createLifecycleWithThreadRead(
      {
        currentEffort: "medium",
        currentMode: "default",
        goalSequence: 2,
        goal: {
          id: "goal",
          threadId: "thread",
          revision: 2,
          objective: "Finish",
          status: "paused",
          reason: "persistence_error",
          turnsUsed: 1,
          tokensUsed: 0,
          cacheReadTokens: 0,
          activeTimeMs: 0,
          accountingScope: "reported_agent_tokens",
          createdAt: 1,
          updatedAt: 1,
        },
      },
      runtime,
    );
    await lifecycle.syncActiveThreadState();
    expect(addLines.mock.calls.flat(2).join(" ")).toContain("Goal state could not be saved");
    expect(addLines.mock.calls.flat(2).join(" ")).toContain("/goal resume");
    const count = addLines.mock.calls.length;
    await lifecycle.syncActiveThreadState();
    expect(addLines.mock.calls).toHaveLength(count);
  });
  test("stale hydration cannot roll back a goal notification or cross a thread switch", async () => {
    const runtime = new AppRuntimeState("default", "medium");
    runtime.currentThreadId = "thread";
    runtime.goalSnapshot = { goal: null, sequence: 9 };
    const history = {
      currentEffort: "medium",
      currentMode: "default",
      currentModel: resolveModel({ provider: "anthropic", modelId: TEST_ANTHROPIC_MODEL_ID }),
      goal: null,
      goalSequence: 2,
    };
    const { lifecycle } = createLifecycleWithThreadRead(history, runtime);
    await lifecycle.syncActiveThreadState();
    expect(runtime.goalSnapshot.sequence).toBe(9);
    let resolveRead!: (value: unknown) => void;
    const pendingRead = new Promise((resolve) => {
      resolveRead = resolve;
    });
    const delayed = createLifecycleWithThreadRead(pendingRead, runtime).lifecycle;
    const sync = delayed.syncActiveThreadState();
    runtime.currentThreadId = "another";
    runtime.goalSnapshot = { goal: null, sequence: 1 };
    resolveRead(history);
    await sync;
    expect(runtime.goalSnapshot.sequence).toBe(1);
  });
  test("start falls back to a connected provider model when configured provider is missing", async () => {
    const setupWizardRun = mock(async () => {});
    const statusBarUpdate = mock(() => {});

    const lifecycle = new AppSessionLifecycle({
      config: {
        model: resolveModel({ provider: "anthropic", modelId: TEST_ANTHROPIC_MODEL_ID }),
        diligent: {},
        providerManager: {
          hasKeyFor: (provider: string) => provider === "openai",
          getConfiguredProviders: () => ["openai"],
        },
      } as never,
      runtime: { currentMode: "default", currentEffort: "medium" } as never,
      terminal: { columns: 100 } as never,
      renderer: { setFocus: () => {}, start: () => {}, requestRender: () => {} } as never,
      inputHistory: { load: async () => {} } as never,
      inputEditor: { reloadHistory: () => {} } as never,
      statusBar: { update: statusBarUpdate } as never,
      chatView: { addLines: () => {} } as never,
      setupWizard: { runSetupWizard: setupWizardRun } as never,
      threadManager: {
        startNewThread: async () => {},
        readThread: async () => null,
      } as never,
      pathsAvailable: true,
      getRpcClient: () =>
        ({
          request: async () => ({}),
          notify: async () => {},
        }) as never,
      restartRpcClient: async () => {},
      pkgVersion: "0.0.0-test",
    });

    await lifecycle.start();

    expect(setupWizardRun).not.toHaveBeenCalled();
    expect((lifecycle as never).deps.config.model.provider).toBe("openai");
    expect((lifecycle as never).deps.config.model.modelId).toBe("gpt-6.1-sol");
    expect(statusBarUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai/gpt-6.1-sol",
      }),
    );
  });

  test("start runs setup wizard when no provider is connected", async () => {
    const setupWizardRun = mock(async () => {});

    const lifecycle = new AppSessionLifecycle({
      config: {
        model: resolveModel({ provider: "anthropic", modelId: TEST_ANTHROPIC_MODEL_ID }),
        diligent: {},
        providerManager: {
          hasKeyFor: () => false,
          getConfiguredProviders: () => [],
        },
      } as never,
      runtime: { currentMode: "default", currentEffort: "medium" } as never,
      terminal: { columns: 100 } as never,
      renderer: { setFocus: () => {}, start: () => {}, requestRender: () => {} } as never,
      inputHistory: { load: async () => {} } as never,
      inputEditor: { reloadHistory: () => {} } as never,
      statusBar: { update: () => {} } as never,
      chatView: { addLines: () => {} } as never,
      setupWizard: { runSetupWizard: setupWizardRun } as never,
      threadManager: {
        startNewThread: async () => {},
        readThread: async () => null,
      } as never,
      pathsAvailable: true,
      getRpcClient: () =>
        ({
          request: async () => ({}),
          notify: async () => {},
        }) as never,
      restartRpcClient: async () => {},
      pkgVersion: "0.0.0-test",
    });

    await lifecycle.start();

    expect(setupWizardRun).toHaveBeenCalledTimes(1);
  });

  test("bounded history restores user and assistant messages", async () => {
    const { renderHistory, addUserMessage, addAssistantMessage, handleEvent } = createLifecycleWithThreadRead({
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

    renderHistory();
    expect(addUserMessage).toHaveBeenCalledWith("hello");
    expect(addAssistantMessage).toHaveBeenCalledWith("hi there");
    expect(handleEvent).toHaveBeenCalledWith({
      type: "usage",
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      cost: 0.01,
    });
  });

  test("bounded history restores structured context notices", async () => {
    const { renderHistory, addLines } = createLifecycleWithThreadRead({
      items: [
        {
          type: "contextMessage",
          itemId: "ctx-1",
          source: "studiorpc-studio-changes",
          presentation: {
            kind: "studio-changes",
            title: "Studio changes detected",
            content: "Added: Ramp",
          },
          timestamp: 1,
        },
      ],
    });

    renderHistory();

    expect(addLines.mock.calls.flat(2).join("\n")).toContain("Studio changes detected");
    expect(addLines.mock.calls.flat(2).join("\n")).toContain("Added: Ramp");
  });

  test("bounded history restores persisted errors and hints recovery only for the latest failure", async () => {
    const failure = (itemId: string) => ({
      type: "error",
      itemId,
      timestamp: new Date(2026, 9, 1, 21, 39).getTime(),
      error: {
        name: "ProviderError",
        message: `raw ${itemId}`,
        presentation: { message: `Network failed ${itemId}`, recovery: { kind: "retry" } },
      },
    });
    const { renderHistory, addLines } = createLifecycleWithThreadRead({
      items: [
        failure("e1"),
        { type: "userMessage", itemId: "u2", message: { role: "user", content: "again", timestamp: 3 }, timestamp: 3 },
        failure("e2"),
      ],
    });

    renderHistory();

    const rendered = addLines.mock.calls.flat(2).join("\n");
    expect(rendered).toContain("Network failed e1");
    expect(rendered).toContain("2026-10-01 21:39");
    expect(rendered).not.toContain("raw e1");
    expect(rendered.match(/Submit the last prompt again to retry\./g)).toHaveLength(1);
    expect(rendered.indexOf("Submit the last prompt again")).toBeGreaterThan(rendered.indexOf("Network failed e2"));
  });

  test("bounded history restores provider-native web blocks as structured transcript items", async () => {
    const { renderHistory, addAssistantMessage, addStructuredItem } = createLifecycleWithThreadRead({
      items: [
        {
          type: "agentMessage",
          itemId: "a1",
          message: {
            role: "assistant",
            content: [
              {
                type: "provider_tool_use",
                id: "ws_1",
                provider: "openai",
                name: "web_search",
                input: { type: "search", query: "bun release" },
              },
              {
                type: "web_search_result",
                toolUseId: "ws_1",
                provider: "openai",
                results: [{ url: "https://example.com", title: "Example" }],
              },
              {
                type: "text",
                text: "Here you go.",
                citations: [{ type: "web_search_result_location", url: "https://example.com", title: "Example" }],
              },
            ],
            model: "test-model",
            usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
            stopReason: "end_turn",
            timestamp: 2,
          },
          usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
          cost: 0,
          timestamp: 2,
        },
      ],
    });

    renderHistory();

    expect(addAssistantMessage).toHaveBeenCalledWith("Here you go.");
    expect(addStructuredItem).toHaveBeenCalled();
  });
});
