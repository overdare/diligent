// @summary Tests for buildToolCatalog — builtin toggles, immutable enforcement, state metadata
import { describe, expect, it } from "bun:test";
import { z } from "zod";

import type { Tool } from "../../tool/types";
import { buildToolCatalog } from "../catalog";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockTool(name: string): Tool {
  return {
    name,
    description: `Mock tool: ${name}`,
    parameters: z.object({}),
    execute: async () => ({ output: "ok" }),
  };
}

/** Standard 5-tool set: 2 immutable + 3 regular */
function standardBuiltins(): Tool[] {
  return [mockTool("plan"), mockTool("request_user_input"), mockTool("bash"), mockTool("read"), mockTool("write")];
}

function toolNames(tools: Tool[]): string[] {
  return tools.map((t) => t.name).sort();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildToolCatalog", () => {
  // 1. Default config (undefined) → all builtins enabled, no plugins
  it("returns all builtins when config is undefined", async () => {
    const builtins = standardBuiltins();
    const result = await buildToolCatalog(builtins, undefined, "/tmp");

    expect(toolNames(result.tools)).toEqual(["bash", "plan", "read", "request_user_input", "write"]);
    expect(result.state).toHaveLength(5);
    for (const entry of result.state) {
      expect(entry.enabled).toBe(true);
      expect(entry.source).toBe("builtin");
    }
    expect(result.pluginErrors).toEqual([]);
  });

  // 2. Empty config ({}) → all builtins enabled
  it("returns all builtins when config is empty object", async () => {
    const builtins = standardBuiltins();
    const result = await buildToolCatalog(builtins, {}, "/tmp");

    expect(toolNames(result.tools)).toEqual(["bash", "plan", "read", "request_user_input", "write"]);
    expect(result.state).toHaveLength(5);
    for (const entry of result.state) {
      expect(entry.enabled).toBe(true);
    }
    expect(result.pluginErrors).toEqual([]);
  });

  // 3. Disable a non-immutable builtin
  it("excludes a disabled non-immutable builtin", async () => {
    const builtins = standardBuiltins();
    const result = await buildToolCatalog(builtins, { builtin: { bash: false } }, "/tmp");

    expect(toolNames(result.tools)).toEqual(["plan", "read", "request_user_input", "write"]);
    const bashState = result.state.find((s) => s.name === "bash");
    expect(bashState).toBeDefined();
    expect(bashState!.enabled).toBe(false);
  });

  // 4. Attempt to disable immutable tool 'plan' → still enabled
  it("keeps 'plan' enabled even when config disables it", async () => {
    const builtins = standardBuiltins();
    const result = await buildToolCatalog(builtins, { builtin: { plan: false } }, "/tmp");

    const planTool = result.tools.find((t) => t.name === "plan");
    expect(planTool).toBeDefined();

    const planState = result.state.find((s) => s.name === "plan");
    expect(planState).toBeDefined();
    expect(planState!.enabled).toBe(true);
    expect(planState!.immutable).toBe(true);
  });

  // 5. Attempt to disable 'request_user_input' → still enabled
  it("keeps 'request_user_input' enabled even when config disables it", async () => {
    const builtins = standardBuiltins();
    const result = await buildToolCatalog(builtins, { builtin: { request_user_input: false } }, "/tmp");

    const ruiTool = result.tools.find((t) => t.name === "request_user_input");
    expect(ruiTool).toBeDefined();

    const ruiState = result.state.find((s) => s.name === "request_user_input");
    expect(ruiState).toBeDefined();
    expect(ruiState!.enabled).toBe(true);
    expect(ruiState!.immutable).toBe(true);
  });

  // 6. Multiple builtins disabled
  it("disables multiple non-immutable builtins at once", async () => {
    const builtins = standardBuiltins();
    const result = await buildToolCatalog(builtins, { builtin: { bash: false, write: false } }, "/tmp");

    expect(toolNames(result.tools)).toEqual(["plan", "read", "request_user_input"]);
    expect(result.tools).toHaveLength(3);

    const bashState = result.state.find((s) => s.name === "bash");
    const writeState = result.state.find((s) => s.name === "write");
    expect(bashState!.enabled).toBe(false);
    expect(writeState!.enabled).toBe(false);
  });

  // 7. State entries have correct source and immutable flags
  it("populates state with correct source and immutable flags", async () => {
    const builtins = standardBuiltins();
    const result = await buildToolCatalog(builtins, undefined, "/tmp");

    const stateByName = new Map(result.state.map((s) => [s.name, s]));

    // Immutable tools
    for (const name of ["plan", "request_user_input"]) {
      const entry = stateByName.get(name);
      expect(entry).toBeDefined();
      expect(entry!.source).toBe("builtin");
      expect(entry!.immutable).toBe(true);
      expect(entry!.enabled).toBe(true);
      expect(entry!.pluginPackage).toBeUndefined();
    }

    // Regular tools
    for (const name of ["bash", "read", "write"]) {
      const entry = stateByName.get(name);
      expect(entry).toBeDefined();
      expect(entry!.source).toBe("builtin");
      expect(entry!.immutable).toBe(false);
      expect(entry!.enabled).toBe(true);
      expect(entry!.pluginPackage).toBeUndefined();
    }
  });

  // 8. Plugin loading is not tested here (mocked out)
  // Plugin integration will be tested in integration tests.

  // 9. conflictPolicy with no plugins loaded → no error
  it("accepts conflictPolicy without errors when no plugins are loaded", async () => {
    const builtins = standardBuiltins();

    for (const policy of ["error", "builtin_wins", "plugin_wins"] as const) {
      const result = await buildToolCatalog(builtins, { conflictPolicy: policy }, "/tmp");
      expect(result.tools).toHaveLength(5);
      expect(result.pluginErrors).toEqual([]);
    }
  });

  // Additional edge case: disabling all non-immutable tools
  it("keeps only immutable tools when all non-immutable builtins are disabled", async () => {
    const builtins = standardBuiltins();
    const result = await buildToolCatalog(builtins, { builtin: { bash: false, read: false, write: false } }, "/tmp");

    expect(toolNames(result.tools)).toEqual(["plan", "request_user_input"]);
    expect(result.state.filter((s) => s.enabled)).toHaveLength(2);
    expect(result.state.filter((s) => !s.enabled)).toHaveLength(3);
  });

  // Additional edge case: empty builtins array
  it("handles empty builtins array gracefully", async () => {
    const result = await buildToolCatalog([], undefined, "/tmp");

    expect(result.tools).toEqual([]);
    expect(result.state).toEqual([]);
    expect(result.pluginErrors).toEqual([]);
  });
});
