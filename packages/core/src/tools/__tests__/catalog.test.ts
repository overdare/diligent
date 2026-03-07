// @summary Tests for buildToolCatalog — builtin toggles, immutable enforcement, state metadata
import { describe, expect, it, mock } from "bun:test";
import { z } from "zod";

import type { Tool } from "../../tool/types";
import { buildToolCatalog } from "../catalog";

function mockTool(name: string): Tool {
  return {
    name,
    description: `Mock tool: ${name}`,
    parameters: z.object({}),
    execute: async () => ({ output: "ok" }),
  };
}

function standardBuiltins(): Tool[] {
  return [mockTool("plan"), mockTool("request_user_input"), mockTool("bash"), mockTool("read"), mockTool("write")];
}

function toolNames(tools: Tool[]): string[] {
  return tools.map((t) => t.name);
}

mock.module("@test/catalog-plugin", () => ({
  manifest: { name: "@test/catalog-plugin", apiVersion: "1.0", version: "0.1.0" },
  createTools: () => [
    {
      name: "plugin_tool",
      description: "Plugin tool",
      parameters: z.object({}),
      execute: async () => ({ output: "ok" }),
    },
  ],
}));

mock.module("@test/plugin-conflict-plan", () => ({
  manifest: { name: "@test/plugin-conflict-plan", apiVersion: "1.0", version: "0.1.0" },
  createTools: () => [
    {
      name: "plan",
      description: "Attempt override immutable tool",
      parameters: z.object({}),
      execute: async () => ({ output: "nope" }),
    },
  ],
}));

mock.module("@test/plugin-conflict-bash", () => ({
  manifest: { name: "@test/plugin-conflict-bash", apiVersion: "1.0", version: "0.1.0" },
  createTools: () => [
    {
      name: "bash",
      description: "Attempt override builtin tool",
      parameters: z.object({}),
      execute: async () => ({ output: "plugin bash" }),
    },
  ],
}));

mock.module("@test/invalid-tool-plugin", () => ({
  manifest: { name: "@test/invalid-tool-plugin", apiVersion: "1.0", version: "0.1.0" },
  createTools: () => [
    {
      name: "good_plugin_tool",
      description: "valid",
      parameters: z.object({}),
      execute: async () => ({ output: "ok" }),
    },
    {
      name: "bad_plugin_tool",
      parameters: z.object({}),
    },
  ],
}));

describe("buildToolCatalog", () => {
  it("returns all builtins when config is undefined", async () => {
    const builtins = standardBuiltins();
    const result = await buildToolCatalog(builtins, undefined, "/tmp");

    expect(toolNames(result.tools)).toEqual(["plan", "request_user_input", "bash", "read", "write"]);
    expect(result.state).toHaveLength(5);
    expect(result.plugins).toEqual([]);
    for (const entry of result.state) {
      expect(entry.enabled).toBe(true);
      expect(entry.source).toBe("builtin");
      expect(entry.available).toBe(true);
      expect(entry.configurable).toBe(!entry.immutable);
      expect(entry.reason).toBe("enabled");
    }
    expect(result.pluginErrors).toEqual([]);
  });

  it("returns all builtins when config is empty object", async () => {
    const builtins = standardBuiltins();
    const result = await buildToolCatalog(builtins, {}, "/tmp");

    expect(toolNames(result.tools)).toEqual(["plan", "request_user_input", "bash", "read", "write"]);
    expect(result.state).toHaveLength(5);
    expect(result.plugins).toEqual([]);
    expect(result.pluginErrors).toEqual([]);
  });

  it("excludes a disabled non-immutable builtin", async () => {
    const builtins = standardBuiltins();
    const result = await buildToolCatalog(builtins, { builtin: { bash: false } }, "/tmp");

    expect(toolNames(result.tools)).toEqual(["plan", "request_user_input", "read", "write"]);
    const bashState = result.state.find((s) => s.name === "bash");
    expect(bashState).toBeDefined();
    expect(bashState!.enabled).toBe(false);
    expect(bashState!.reason).toBe("disabled_by_user");
    expect(bashState!.configurable).toBe(true);
  });

  it("keeps 'plan' enabled even when config disables it", async () => {
    const builtins = standardBuiltins();
    const result = await buildToolCatalog(builtins, { builtin: { plan: false } }, "/tmp");

    const planState = result.state.find((s) => s.name === "plan" && s.source === "builtin");
    expect(planState).toBeDefined();
    expect(planState!.enabled).toBe(true);
    expect(planState!.immutable).toBe(true);
    expect(planState!.configurable).toBe(false);
    expect(planState!.reason).toBe("immutable_forced_on");
  });

  it("keeps 'request_user_input' enabled even when config disables it", async () => {
    const builtins = standardBuiltins();
    const result = await buildToolCatalog(builtins, { builtin: { request_user_input: false } }, "/tmp");

    const ruiState = result.state.find((s) => s.name === "request_user_input" && s.source === "builtin");
    expect(ruiState).toBeDefined();
    expect(ruiState!.enabled).toBe(true);
    expect(ruiState!.immutable).toBe(true);
    expect(ruiState!.reason).toBe("immutable_forced_on");
  });

  it("disables multiple non-immutable builtins at once", async () => {
    const builtins = standardBuiltins();
    const result = await buildToolCatalog(builtins, { builtin: { bash: false, write: false } }, "/tmp");

    expect(toolNames(result.tools)).toEqual(["plan", "request_user_input", "read"]);
    const bashState = result.state.find((s) => s.name === "bash");
    const writeState = result.state.find((s) => s.name === "write");
    expect(bashState!.enabled).toBe(false);
    expect(writeState!.enabled).toBe(false);
  });

  it("populates state with correct source and immutable flags", async () => {
    const builtins = standardBuiltins();
    const result = await buildToolCatalog(builtins, undefined, "/tmp");

    const stateByName = new Map(result.state.map((s) => [s.name, s]));

    for (const name of ["plan", "request_user_input"]) {
      const entry = stateByName.get(name);
      expect(entry).toBeDefined();
      expect(entry!.source).toBe("builtin");
      expect(entry!.immutable).toBe(true);
      expect(entry!.enabled).toBe(true);
      expect(entry!.pluginPackage).toBeUndefined();
    }

    for (const name of ["bash", "read", "write"]) {
      const entry = stateByName.get(name);
      expect(entry).toBeDefined();
      expect(entry!.source).toBe("builtin");
      expect(entry!.immutable).toBe(false);
      expect(entry!.enabled).toBe(true);
      expect(entry!.pluginPackage).toBeUndefined();
    }
  });

  it("accepts conflictPolicy without errors when no plugins are loaded", async () => {
    const builtins = standardBuiltins();

    for (const policy of ["error", "builtin_wins", "plugin_wins"] as const) {
      const result = await buildToolCatalog(builtins, { conflictPolicy: policy }, "/tmp");
      expect(result.tools).toHaveLength(5);
      expect(result.pluginErrors).toEqual([]);
    }
  });

  it("keeps only immutable tools when all non-immutable builtins are disabled", async () => {
    const builtins = standardBuiltins();
    const result = await buildToolCatalog(builtins, { builtin: { bash: false, read: false, write: false } }, "/tmp");

    expect(toolNames(result.tools)).toEqual(["plan", "request_user_input"]);
    expect(result.state.filter((s) => s.enabled)).toHaveLength(2);
    expect(result.state.filter((s) => !s.enabled)).toHaveLength(3);
  });

  it("handles empty builtins array gracefully", async () => {
    const result = await buildToolCatalog([], undefined, "/tmp");

    expect(result.tools).toEqual([]);
    expect(result.state).toEqual([]);
    expect(result.plugins).toEqual([]);
    expect(result.pluginErrors).toEqual([]);
  });

  it("loads plugin tools and exposes separate plugin state metadata", async () => {
    const result = await buildToolCatalog(
      standardBuiltins(),
      {
        plugins: [{ package: "@test/catalog-plugin", enabled: true }],
      },
      "/tmp",
    );

    expect(toolNames(result.tools)).toEqual(["plan", "request_user_input", "bash", "read", "write", "plugin_tool"]);
    expect(result.plugins).toEqual([
      {
        package: "@test/catalog-plugin",
        configured: true,
        enabled: true,
        loaded: true,
        toolCount: 1,
        warnings: [],
      },
    ]);
    const pluginToolState = result.state.find((s) => s.name === "plugin_tool");
    expect(pluginToolState).toMatchObject({
      source: "plugin",
      pluginPackage: "@test/catalog-plugin",
      enabled: true,
      available: true,
      reason: "enabled",
    });
  });

  it("supports plugin-level tool disable state", async () => {
    const result = await buildToolCatalog(
      standardBuiltins(),
      {
        plugins: [{ package: "@test/catalog-plugin", enabled: true, tools: { plugin_tool: false } }],
      },
      "/tmp",
    );

    expect(toolNames(result.tools)).not.toContain("plugin_tool");
    const pluginToolState = result.state.find((s) => s.name === "plugin_tool" && s.source === "plugin");
    expect(pluginToolState).toMatchObject({
      enabled: false,
      available: true,
      reason: "disabled_by_user",
    });
  });

  it("records disabled plugin packages separately from tool-level state", async () => {
    const result = await buildToolCatalog(
      standardBuiltins(),
      {
        plugins: [{ package: "@test/catalog-plugin", enabled: false, tools: { plugin_tool: false } }],
      },
      "/tmp",
    );

    expect(toolNames(result.tools)).toEqual(["plan", "request_user_input", "bash", "read", "write"]);
    expect(result.plugins).toEqual([
      {
        package: "@test/catalog-plugin",
        configured: true,
        enabled: false,
        loaded: false,
        toolCount: 0,
        warnings: [],
      },
    ]);
    const pluginToolState = result.state.find(
      (s) => s.name === "plugin_tool" && s.pluginPackage === "@test/catalog-plugin",
    );
    expect(pluginToolState).toMatchObject({
      enabled: false,
      available: false,
      reason: "plugin_disabled",
    });
  });

  it("rejects overriding immutable built-ins even under plugin_wins", async () => {
    const result = await buildToolCatalog(
      standardBuiltins(),
      {
        conflictPolicy: "plugin_wins",
        plugins: [{ package: "@test/plugin-conflict-plan", enabled: true }],
      },
      "/tmp",
    );

    const enabledNames = toolNames(result.tools);
    expect(enabledNames.filter((name) => name === "plan")).toHaveLength(1);
    const builtinPlan = result.state.find((s) => s.name === "plan" && s.source === "builtin");
    const droppedPluginPlan = result.state.find((s) => s.name === "plan" && s.source === "plugin");
    expect(builtinPlan).toMatchObject({ enabled: true, immutable: true, reason: "enabled" });
    expect(droppedPluginPlan).toMatchObject({
      enabled: false,
      available: false,
      reason: "conflict_dropped",
    });
    expect(droppedPluginPlan!.error).toContain("cannot override immutable built-in");
  });

  it("drops conflicting plugin tools under conflictPolicy error", async () => {
    const result = await buildToolCatalog(
      standardBuiltins(),
      {
        conflictPolicy: "error",
        plugins: [{ package: "@test/plugin-conflict-bash", enabled: true }],
      },
      "/tmp",
    );

    const builtinBash = result.state.find((s) => s.name === "bash" && s.source === "builtin");
    const droppedPluginBash = result.state.find((s) => s.name === "bash" && s.source === "plugin");
    expect(builtinBash).toMatchObject({ enabled: true, source: "builtin" });
    expect(droppedPluginBash).toMatchObject({
      enabled: false,
      available: false,
      reason: "conflict_dropped",
    });
    expect(result.pluginErrors.some((error) => error.error.includes("conflicts with built-in tool"))).toBe(true);
  });

  it("allows plugins to override non-immutable built-ins under plugin_wins", async () => {
    const result = await buildToolCatalog(
      standardBuiltins(),
      {
        conflictPolicy: "plugin_wins",
        plugins: [{ package: "@test/plugin-conflict-bash", enabled: true }],
      },
      "/tmp",
    );

    const bashEntries = result.state.filter((s) => s.name === "bash");
    expect(bashEntries).toHaveLength(1);
    expect(bashEntries[0]).toMatchObject({
      source: "plugin",
      pluginPackage: "@test/plugin-conflict-bash",
      enabled: true,
      available: true,
    });
    expect(toolNames(result.tools)).toContain("bash");
  });

  it("surfaces invalid plugin tools without failing the whole package", async () => {
    const result = await buildToolCatalog(
      standardBuiltins(),
      {
        plugins: [{ package: "@test/invalid-tool-plugin", enabled: true }],
      },
      "/tmp",
    );

    expect(toolNames(result.tools)).toContain("good_plugin_tool");
    expect(toolNames(result.tools)).not.toContain("bad_plugin_tool");
    expect(result.plugins).toEqual([
      {
        package: "@test/invalid-tool-plugin",
        configured: true,
        enabled: true,
        loaded: true,
        toolCount: 1,
        warnings: ["Tool 'bad_plugin_tool' from '@test/invalid-tool-plugin' has invalid shape."],
      },
    ]);
    const invalidState = result.state.find((s) => s.name === "bad_plugin_tool" && s.source === "plugin");
    expect(invalidState).toMatchObject({
      enabled: false,
      available: false,
      reason: "invalid_plugin_tool",
    });
  });

  it("keeps state ordering deterministic: builtins first, then plugins in config order", async () => {
    const result = await buildToolCatalog(
      standardBuiltins(),
      {
        plugins: [
          { package: "@test/catalog-plugin", enabled: true },
          { package: "@test/invalid-tool-plugin", enabled: true },
        ],
      },
      "/tmp",
    );

    expect(toolNames(result.tools)).toEqual([
      "plan",
      "request_user_input",
      "bash",
      "read",
      "write",
      "plugin_tool",
      "good_plugin_tool",
    ]);
  });
});
