// @summary Tests for model-aware thinking effort command options and validation

import { describe, expect, it, mock } from "bun:test";
import { getThinkingEffortOptions, resolveModel } from "@diligent/runtime";
import type { AppConfig } from "../../../../src/config";
import { effortCommand } from "../../../../src/tui/commands/builtin/effort";
import type { CommandContext } from "../../../../src/tui/commands/types";
import type { ListPickerItem } from "../../../../src/tui/components/list-picker";

function makeContext(modelId: string, overrides?: Partial<CommandContext>): CommandContext {
  const ref =
    modelId === "vertex-gemma-4-26b-it"
      ? { provider: "vertex" as const, modelId }
      : { provider: "openai" as const, modelId };
  return {
    app: {
      confirm: async () => true,
      pick: async () => null,
      prompt: async () => null,
      stop: () => {},
      getRpcClient: () => null,
    },
    config: { model: resolveModel(ref) } as AppConfig,
    threadId: "thread-1",
    skills: [],
    registry: {} as CommandContext["registry"],
    requestRender: () => {},
    displayLines: () => {},
    displayError: () => {},
    runAgent: async () => {},
    reload: async () => {},
    currentMode: "default",
    setMode: () => {},
    currentEffort: "medium",
    setEffort: async () => {},
    currentFastMode: false,
    setFastMode: async () => {},
    setModel: async () => {},
    clearChatHistory: () => {},
    clearScreenAndResetRenderer: () => {},
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

describe("effortCommand", () => {
  it.each(
    getThinkingEffortOptions(resolveModel({ provider: "openai", modelId: "gpt-6.1-sol" })),
  )("sets and announces supported effort $value", async ({ value }) => {
    const setEffort = mock(async () => {});
    const onEffortChanged = mock(() => {});
    const displayError = mock(() => {});
    const ctx = makeContext("gpt-6.1-sol", { setEffort, onEffortChanged, displayError });

    await effortCommand.handler(value, ctx);

    expect(setEffort).toHaveBeenCalledWith(value);
    expect(onEffortChanged).toHaveBeenCalledWith(value, value);
    expect(displayError).not.toHaveBeenCalled();
  });

  it("preserves the existing command behavior for non-thinking models", async () => {
    const setEffort = mock(async () => {});
    const displayError = mock(() => {});
    const ctx = makeContext("vertex-gemma-4-26b-it", { setEffort, displayError });

    await effortCommand.handler("high", ctx);

    expect(setEffort).toHaveBeenCalledWith("high");
    expect(displayError).not.toHaveBeenCalled();
  });

  it("rejects removed none and minimal aliases", async () => {
    for (const value of ["none", "minimal"]) {
      const setEffort = mock(async () => {});
      const displayError = mock(() => {});
      const ctx = makeContext("gpt-6.1-sol", { setEffort, displayError });

      await effortCommand.handler(value, ctx);

      expect(setEffort).not.toHaveBeenCalled();
      expect(displayError).toHaveBeenCalledWith(`Unknown effort: ${value}. Usage: /effort <low|medium|high|xhigh|max>`);
    }
  });

  it("shows the configured model effort options in the picker", async () => {
    let items: ListPickerItem[] = [];
    const ctx = makeContext("gpt-6.1-terra", {
      app: {
        confirm: async () => true,
        pick: async (options) => {
          items = options.items;
          return null;
        },
        prompt: async () => null,
        stop: () => {},
        getRpcClient: () => null,
      },
    });

    await effortCommand.handler(undefined, ctx);

    expect(items.map((item) => item.value)).toEqual(
      getThinkingEffortOptions(ctx.config.model).map((option) => option.value),
    );
  });
});
