// @summary Tests for command registry and command execution
import { describe, expect, it, mock } from "bun:test";
import type { ThinkingEffort } from "@diligent/protocol";
import type { AppConfig } from "../../../config";
import { createCommandHandler, type CommandHandlerDeps } from "../../command-handler";
import type { ConfigManager } from "../../config-manager";
import type { OverlayHandle } from "../../framework/types";
import type { ThreadManager } from "../../thread-manager";
import { CommandRegistry } from "../registry";
import type { Command, CommandContext } from "../types";

function makeCommand(overrides: Partial<Command> & { name: string }): Command {
  return {
    description: `Test command: ${overrides.name}`,
    handler: async (_args: string | undefined, _ctx: CommandContext) => {},
    ...overrides,
  };
}

function makeHandlerDeps(overrides: Partial<CommandHandlerDeps> = {}): CommandHandlerDeps {
  const threadManager: ThreadManager = {
    startNewThread: async () => "thread-1",
    resumeThread: async () => null,
    listThreads: async () => [],
    readThread: async () => null,
    deleteThread: async () => false,
  };

  const configManager: ConfigManager = {
    setMode: () => {},
    setEffort: async () => {},
    reloadConfig: async () => {},
  };

  return {
    getRpcClient: () => null,
    getCurrentThreadId: () => "thread-1",
    getConfig: () => ({ diligent: { effort: "medium" }, model: { id: "test-model" } } as AppConfig),
    getCommandRegistry: () => new CommandRegistry(),
    getSkills: () => [],
    getCurrentMode: () => "default",
    getCurrentEffort: () => "medium",
    getIsProcessing: () => false,
    setIsProcessing: () => {},
    setPendingTurn: () => {},
    addUserMessage: () => {},
    addLines: () => {},
    clearActive: () => {},
    clearChatHistory: () => {},
    handleAgentStartEvent: () => {},
    handleTurnError: () => {},
    updateStatusBar: () => {},
    requestRender: () => {},
    showOverlay: () => ({ hide: () => {} }) as OverlayHandle,
    confirm: async () => true,
    shutdown: () => {},
    onModelChanged: () => {},
    onEffortChanged: () => {},
    waitForOAuthComplete: async () => ({ success: true, error: null }),
    syncActiveThreadState: async () => {},
    threadManager,
    configManager,
    ...overrides,
  };
}

describe("CommandRegistry", () => {
  it("registers and retrieves a command by name", () => {
    const registry = new CommandRegistry();
    const cmd = makeCommand({ name: "help" });
    registry.register(cmd);

    expect(registry.get("help")).toBe(cmd);
  });

  it("retrieves a command by alias", () => {
    const registry = new CommandRegistry();
    const cmd = makeCommand({ name: "exit", aliases: ["q", "quit"] });
    registry.register(cmd);

    expect(registry.get("q")).toBe(cmd);
    expect(registry.get("quit")).toBe(cmd);
  });

  it("throws on duplicate registration", () => {
    const registry = new CommandRegistry();
    registry.register(makeCommand({ name: "help" }));

    expect(() => {
      registry.register(makeCommand({ name: "help" }));
    }).toThrow("Duplicate command: /help");
  });

  it("lists all registered commands", () => {
    const registry = new CommandRegistry();
    const help = makeCommand({ name: "help" });
    const model = makeCommand({ name: "model" });
    registry.register(help).register(model);

    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list).toContain(help);
    expect(list).toContain(model);
  });

  it("completes partial command names", () => {
    const registry = new CommandRegistry();
    registry.register(makeCommand({ name: "help" }));
    registry.register(makeCommand({ name: "history" }));
    registry.register(makeCommand({ name: "model" }));

    expect(registry.complete("h")).toEqual(["help", "history"]);
  });

  it("returns sorted completion results", () => {
    const registry = new CommandRegistry();
    registry.register(makeCommand({ name: "status" }));
    registry.register(makeCommand({ name: "skills" }));
    registry.register(makeCommand({ name: "stop" }));

    expect(registry.complete("s")).toEqual(["skills", "status", "stop"]);
  });

  it("includes aliases in completion", () => {
    const registry = new CommandRegistry();
    registry.register(makeCommand({ name: "exit", aliases: ["quit"] }));

    expect(registry.complete("q")).toEqual(["quit"]);
  });

  it("returns undefined for unknown command", () => {
    const registry = new CommandRegistry();
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("returns empty array for no completion matches", () => {
    const registry = new CommandRegistry();
    registry.register(makeCommand({ name: "help" }));

    expect(registry.complete("z")).toEqual([]);
  });

  describe("completeDetailed", () => {
    it("returns items with name and description", () => {
      const registry = new CommandRegistry();
      registry.register(makeCommand({ name: "help", description: "Show help" }));
      registry.register(makeCommand({ name: "model", description: "Change model" }));

      const items = registry.completeDetailed("h");
      expect(items).toEqual([{ name: "help", description: "Show help" }]);
    });

    it("excludes aliases (only primary names)", () => {
      const registry = new CommandRegistry();
      registry.register(makeCommand({ name: "exit", aliases: ["quit"], description: "Exit app" }));

      expect(registry.completeDetailed("q")).toEqual([]);
      expect(registry.completeDetailed("e")).toEqual([{ name: "exit", description: "Exit app" }]);
    });

    it("returns all commands for empty partial", () => {
      const registry = new CommandRegistry();
      registry.register(makeCommand({ name: "help" }));
      registry.register(makeCommand({ name: "model" }));

      const items = registry.completeDetailed("");
      expect(items).toHaveLength(2);
      expect(items[0].name).toBe("help");
      expect(items[1].name).toBe("model");
    });

    it("returns empty array for no matches", () => {
      const registry = new CommandRegistry();
      registry.register(makeCommand({ name: "help" }));

      expect(registry.completeDetailed("z")).toEqual([]);
    });
  });
});

describe("createCommandHandler", () => {
  it("builds command context with the live current effort", () => {
    let currentEffort: ThinkingEffort = "medium";
    const handler = createCommandHandler(
      makeHandlerDeps({
        getCurrentEffort: () => currentEffort,
        getConfig: () => ({ diligent: { effort: "medium" }, model: { id: "test-model" } } as AppConfig),
      }),
    );

    currentEffort = "max";

    expect(handler.buildCommandContext().currentEffort).toBe("max");
  });

  it("syncs active thread state after starting a new thread from command context", async () => {
    const startNewThread = mock(async () => "thread-2");
    const syncActiveThreadState = mock(async () => {});
    const handler = createCommandHandler(
      makeHandlerDeps({
        threadManager: {
          startNewThread,
          resumeThread: async () => null,
          listThreads: async () => [],
          readThread: async () => null,
          deleteThread: async () => false,
        },
        syncActiveThreadState,
      }),
    );

    const threadId = await handler.buildCommandContext().startNewThread();

    expect(threadId).toBe("thread-2");
    expect(startNewThread).toHaveBeenCalledTimes(1);
    expect(syncActiveThreadState).toHaveBeenCalledTimes(1);
  });
});
