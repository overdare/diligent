// @summary Tests for provider command auth synchronization behavior
import { describe, expect, it, mock } from "bun:test";
import { DILIGENT_CLIENT_REQUEST_METHODS } from "@diligent/protocol";
import type { OverlayHandle } from "../../../framework/types";
import type { AppServerRpcClient } from "../../../rpc-client";
import type { CommandContext } from "../../types";
import { promptSaveKey } from "../provider";

function makeContext(overrides?: Partial<CommandContext>): CommandContext {
  return {
    app: {
      confirm: async () => true,
      stop: () => {},
      getRpcClient: () => null,
    },
    config: {} as CommandContext["config"],
    threadId: null,
    skills: [],
    registry: {} as CommandContext["registry"],
    requestRender: () => {},
    displayLines: () => {},
    displayError: () => {},
    showOverlay: () => ({ hide: () => {}, isHidden: () => false, setHidden: () => {} }) as OverlayHandle,
    runAgent: async () => {},
    reload: async () => {},
    currentMode: "default",
    setMode: () => {},
    currentEffort: "medium",
    setEffort: async () => {},
    clearChatHistory: () => {},
    startNewThread: async () => "thread-1",
    resumeThread: async () => "thread-1",
    deleteThread: async () => true,
    listThreads: async () => [],
    readThread: async () => null,
    onModelChanged: () => {},
    onEffortChanged: () => {},
    ...overrides,
  } as CommandContext;
}

describe("promptSaveKey", () => {
  it("syncs API key to app-server via AUTH_SET when available", async () => {
    const request = mock(async () => ({ ok: true }));
    let confirmYes: (() => void) | null = null;

    const displayLines = mock((_lines: string[]) => {});
    const ctx = makeContext({
      app: {
        confirm: async () => true,
        stop: () => {},
        getRpcClient: () => ({ request }) as unknown as AppServerRpcClient,
      },
      showOverlay: (component) => {
        confirmYes = () => {
          (component as { handleInput?: (data: string) => void }).handleInput?.("y");
        };
        return {
          hide: () => {},
          isHidden: () => false,
          setHidden: () => {},
        } as OverlayHandle;
      },
      displayLines,
    });

    const pending = promptSaveKey("openai", "sk-test-123", ctx);
    if (!confirmYes) {
      throw new Error("Expected confirm dialog overlay");
    }
    const triggerConfirm = confirmYes as () => void;
    triggerConfirm();
    await pending;

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(DILIGENT_CLIENT_REQUEST_METHODS.AUTH_SET, {
      provider: "openai",
      apiKey: "sk-test-123",
    });
    expect(displayLines).toHaveBeenCalled();
  });
});
