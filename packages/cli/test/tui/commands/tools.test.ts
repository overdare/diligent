// @summary Tests for /tools command draft helpers and built-in registration
import { describe, expect, it } from "bun:test";
import type { ToolDescriptor, ToolStateReason, ToolsListResponse } from "@diligent/protocol";
import { registerBuiltinCommands } from "../../../src/tui/commands/builtin";
import { buildSetParams, createDraft, toolsCommand } from "../../../src/tui/commands/builtin/tools";
import { CommandRegistry } from "../../../src/tui/commands/registry";
import type { Command, CommandContext } from "../../../src/tui/commands/types";
import type { ListPickerItem } from "../../../src/tui/components/list-picker";

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

describe("/tools picker rendering", () => {
  const PKG = "@acme/diligent-tools";

  function tool(
    name: string,
    fields: Partial<ToolDescriptor> & Pick<ToolDescriptor, "enabled" | "reason">,
  ): ToolDescriptor {
    return { name, source: "builtin", immutable: false, configurable: true, available: true, ...fields };
  }

  function pluginTool(name: string, reason: ToolStateReason): ToolDescriptor {
    return tool(name, { source: "plugin", pluginPackage: PKG, enabled: false, reason });
  }

  const STATE: ToolsListResponse = {
    configPath: "/repo/.diligent/config.jsonc",
    appliesOnNextTurn: true,
    trustMode: "full_trust",
    conflictPolicy: "error",
    tools: [
      tool("bash", { enabled: false, reason: "disabled_by_user" }),
      tool("read", { enabled: true, reason: "enabled" }),
      tool("plan", { enabled: false, immutable: true, configurable: false, reason: "immutable_forced_on" }),
      tool("glob", { enabled: true, configurable: false, reason: "enabled" }),
      pluginTool("p_disabled", "plugin_disabled"),
      pluginTool("p_failed", "plugin_load_failed"),
      pluginTool("p_conflict", "conflict_dropped"),
      pluginTool("p_invalid", "invalid_plugin_tool"),
      pluginTool("p_superseded", "superseded_by_bundled"),
    ],
    plugins: [{ package: PKG, configured: true, enabled: true, loaded: true, toolCount: 5, warnings: [] }],
  };

  async function runScript(script: string[]): Promise<{
    pickers: Array<{ title: string; items: ListPickerItem[]; filterable?: boolean }>;
    lines: string[];
  }> {
    const pickers: Array<{ title: string; items: ListPickerItem[]; filterable?: boolean }> = [];
    const lines: string[] = [];
    const queue = [...script];
    const ctx = {
      threadId: null,
      app: {
        getRpcClient: () => ({ request: async () => structuredClone(STATE) }),
        pick: async (options: { title: string; items: ListPickerItem[]; filterable?: boolean }) => {
          pickers.push({ title: options.title, items: options.items, filterable: options.filterable });
          return queue.shift() ?? null;
        },
      },
      displayLines: (l: string[]) => lines.push(...l),
      displayError: () => {},
    } as unknown as CommandContext;
    await toolsCommand.handler(undefined, ctx);
    return { pickers, lines };
  }

  function rows(items: ListPickerItem[]): Array<[string, string | undefined]> {
    return items.map((item) => [item.label, item.description]);
  }

  it("renders built-in status icons and reasons, reflecting draft toggles over tool state", async () => {
    const { pickers } = await runScript(["__builtins", "bash", "read", "__back", "__close"]);

    expect(pickers.map((p) => [p.title, p.filterable])).toEqual([
      ["Tool settings", true],
      ["Built-in tools", true],
      ["Built-in tools", true],
      ["Built-in tools", true],
      ["Tool settings", true],
    ]);
    expect(rows(pickers[1].items)).toEqual([
      ["✗ bash", "off · disabled in settings"],
      ["✓ read", "on"],
      ["🔒 plan", "off · locked"],
      ["✓ glob", "on"],
      ["Back", "Return to tool settings"],
    ]);
    expect(pickers[2].items[0].label).toBe("✓ bash");
    expect(pickers[3].items.slice(0, 2).map((item) => item.label)).toEqual(["✓ bash", "✗ read"]);
  });

  it("describes plugin tool reasons in the package picker", async () => {
    const { pickers } = await runScript(["__plugins", PKG, "__back", "__back", "__close"]);

    expect(pickers.map((p) => [p.title, p.filterable])).toEqual([
      ["Tool settings", true],
      ["Plugin packages", true],
      [PKG, true],
      ["Plugin packages", true],
      ["Tool settings", true],
    ]);
    expect(rows(pickers[2].items)).toEqual([
      ["✓ Package enabled", "on · 5 tools"],
      ["✗ p_disabled", "off · package disabled"],
      ["✗ p_failed", "off · load failed"],
      ["✗ p_conflict", "off · conflict"],
      ["✗ p_invalid", "off · invalid"],
      ["✗ p_superseded", "off"],
      ["Remove package", "Delete this package from config"],
      ["Back", "Return to tool settings"],
    ]);
  });
});
