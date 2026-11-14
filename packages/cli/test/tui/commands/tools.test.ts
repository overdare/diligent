// @summary Tests for /tools command draft helpers and built-in registration
import { describe, expect, it } from "bun:test";
import { registerBuiltinCommands } from "../../../src/tui/commands/builtin";
import { buildSetParams, createDraft } from "../../../src/tui/commands/builtin/tools";
import { CommandRegistry } from "../../../src/tui/commands/registry";
import type { Command } from "../../../src/tui/commands/types";

describe("tools command", () => {
  it("creates draft state from tool and plugin descriptors", () => {
    const draft = createDraft({
      configPath: "/repo/.diligent/config.jsonc",
      appliesOnNextTurn: true,
      trustMode: "full_trust",
      conflictPolicy: "error",
      tools: [
        {
          name: "bash",
          source: "builtin",
          enabled: false,
          immutable: false,
          configurable: true,
          available: true,
          reason: "disabled_by_user",
        },
        {
          name: "plan",
          source: "builtin",
          enabled: true,
          immutable: true,
          configurable: false,
          available: true,
          reason: "immutable_forced_on",
        },
        {
          name: "jira_comment",
          source: "plugin",
          pluginPackage: "@acme/diligent-tools",
          enabled: false,
          immutable: false,
          configurable: true,
          available: true,
          reason: "disabled_by_user",
        },
      ],
      plugins: [
        {
          package: "@acme/diligent-tools",
          configured: true,
          enabled: true,
          loaded: true,
          toolCount: 1,
          warnings: [],
        },
      ],
    });

    expect(draft.builtin).toEqual({ bash: false });
    expect(draft.plugins).toEqual([
      {
        package: "@acme/diligent-tools",
        enabled: true,
        tools: { jira_comment: false },
      },
    ]);
  });

  it("builds tools/set params including removals", () => {
    const params = buildSetParams("thread-1", {
      builtin: { bash: false },
      plugins: [{ package: "@acme/diligent-tools", enabled: true, tools: { jira_comment: false } }],
      removedPackages: ["@acme/old-tools"],
    });

    expect(params).toEqual({
      threadId: "thread-1",
      builtin: { bash: false },
      plugins: [
        { package: "@acme/diligent-tools", enabled: true, tools: { jira_comment: false } },
        { package: "@acme/old-tools", remove: true },
      ],
    });
  });

  it("registers /tools as a built-in command", () => {
    const registry = new CommandRegistry();
    registerBuiltinCommands(registry, []);

    const command = registry.get("tools") as Command | undefined;
    expect(command?.name).toBe("tools");
    expect(command?.description).toContain("built-in tools");
  });
});
