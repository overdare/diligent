// @summary Tests for the direct collaboration-mode commands (/default, /plan, /exec)

import { describe, expect, it, mock } from "bun:test";
import { MODE_COMMAND_NAMES, type Mode, ModeSchema } from "@diligent/protocol";
import type { AppConfig } from "../../../../src/config";
import { modeCommands } from "../../../../src/tui/commands/builtin/mode";
import type { CommandContext } from "../../../../src/tui/commands/types";

function makeContext(overrides?: Partial<CommandContext>): CommandContext {
  return {
    app: {
      confirm: async () => true,
      pick: async () => null,
      prompt: async () => null,
      stop: () => {},
      getRpcClient: () => null,
    },
    config: {} as AppConfig,
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

function commandFor(mode: Mode) {
  return modeCommands.find((command) => command.name === MODE_COMMAND_NAMES[mode]);
}

describe("mode commands", () => {
  it("registers one argument-free command per supported mode", () => {
    expect(modeCommands.map((command) => command.name)).toEqual(
      ModeSchema.options.map((mode) => MODE_COMMAND_NAMES[mode]),
    );
    for (const command of modeCommands) {
      expect(command.supportsArgs).toBeUndefined();
    }
  });

  it("switches straight to its own mode", async () => {
    for (const mode of ModeSchema.options) {
      const setMode = mock(() => {});
      await commandFor(mode)?.handler(undefined, makeContext({ setMode }));
      expect(setMode).toHaveBeenCalledWith(mode);
    }
  });

  // Guards against reintroducing a toggle: these commands never switch away.
  it("stays put when its mode is already active", async () => {
    for (const mode of ModeSchema.options) {
      const setMode = mock(() => {});
      await commandFor(mode)?.handler(undefined, makeContext({ currentMode: mode, setMode }));
      expect(setMode).toHaveBeenCalledWith(mode);
    }
  });
});
