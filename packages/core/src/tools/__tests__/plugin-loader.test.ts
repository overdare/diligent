// @summary Unit tests for loadPlugin — dynamic import, manifest validation, tool shape checks
import { describe, expect, it, mock } from "bun:test";
import { z } from "zod";
import { loadPlugin } from "../plugin-loader";

const CWD = "/tmp/test-cwd";

// ── Mock modules ──────────────────────────────────────────────────────────────

mock.module("@test/no-manifest", () => ({
  // exports nothing useful
  someOther: true,
}));

mock.module("@test/bad-manifest-fields", () => ({
  manifest: { name: 123, apiVersion: null, version: undefined },
}));

mock.module("@test/api-v2", () => ({
  manifest: { name: "api-v2", apiVersion: "2.0", version: "1.0.0" },
  createTools: () => [],
}));

mock.module("@test/api-nan", () => ({
  manifest: { name: "api-nan", apiVersion: "abc.def", version: "1.0.0" },
  createTools: () => [],
}));

mock.module("@test/no-create-tools", () => ({
  manifest: { name: "no-ct", apiVersion: "1.0", version: "1.0.0" },
  // no createTools export
}));

mock.module("@test/create-tools-throws", () => ({
  manifest: { name: "throws", apiVersion: "1.0", version: "1.0.0" },
  createTools: () => {
    throw new Error("plugin init failed");
  },
}));

mock.module("@test/valid-plugin", () => ({
  manifest: { name: "valid", apiVersion: "1.0", version: "0.1.0" },
  createTools: () => [
    {
      name: "my_tool",
      description: "A test tool",
      parameters: z.object({ input: z.string() }),
      execute: async () => ({ output: "ok" }),
    },
  ],
}));

mock.module("@test/mixed-tools", () => ({
  manifest: { name: "mixed", apiVersion: "1.2", version: "0.2.0" },
  createTools: () => [
    {
      name: "good_tool",
      description: "Valid tool",
      parameters: z.object({}),
      execute: async () => ({ output: "ok" }),
    },
    {
      // missing description and execute
      name: "bad_tool_1",
      parameters: z.object({}),
    },
    {
      // null — completely wrong shape
      name: "bad_tool_2",
    },
    null,
    "not-a-tool",
  ],
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("loadPlugin", () => {
  it("returns error when package import fails", async () => {
    const result = await loadPlugin("@nonexistent/package-xyz-999", CWD);
    expect(result.tools).toEqual([]);
    expect(result.error).toContain("Could not load plugin package");
    expect(result.error).toContain("@nonexistent/package-xyz-999");
    expect(result.package).toBe("@nonexistent/package-xyz-999");
  });

  it("returns error when manifest is missing", async () => {
    const result = await loadPlugin("@test/no-manifest", CWD);
    expect(result.tools).toEqual([]);
    expect(result.error).toContain("does not export a 'manifest' object");
  });

  it("returns error when manifest has wrong fields", async () => {
    const result = await loadPlugin("@test/bad-manifest-fields", CWD);
    expect(result.tools).toEqual([]);
    expect(result.error).toContain("missing required fields");
    expect(result.error).toContain("name, apiVersion, version");
  });

  it("returns error when apiVersion is not 1.x", async () => {
    const result = await loadPlugin("@test/api-v2", CWD);
    expect(result.tools).toEqual([]);
    expect(result.error).toContain("API version '2.0'");
    expect(result.error).toContain("only version 1.x is supported");
  });

  it("returns error when apiVersion is not a number", async () => {
    const result = await loadPlugin("@test/api-nan", CWD);
    expect(result.tools).toEqual([]);
    expect(result.error).toContain("API version 'abc.def'");
    expect(result.error).toContain("only version 1.x is supported");
  });

  it("returns error when createTools is not a function", async () => {
    const result = await loadPlugin("@test/no-create-tools", CWD);
    expect(result.tools).toEqual([]);
    expect(result.error).toContain("does not export a 'createTools' function");
  });

  it("returns error when createTools throws", async () => {
    const result = await loadPlugin("@test/create-tools-throws", CWD);
    expect(result.tools).toEqual([]);
    expect(result.error).toContain("createTools() threw");
    expect(result.error).toContain("plugin init failed");
  });

  it("returns valid tools from well-formed plugin", async () => {
    const result = await loadPlugin("@test/valid-plugin", CWD);
    expect(result.error).toBeUndefined();
    expect(result.manifest).toEqual({
      name: "valid",
      apiVersion: "1.0",
      version: "0.1.0",
    });
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe("my_tool");
    expect(result.tools[0].description).toBe("A test tool");
    expect(typeof result.tools[0].execute).toBe("function");
  });

  it("filters out tools with invalid shape and returns partial error", async () => {
    const result = await loadPlugin("@test/mixed-tools", CWD);
    // Should keep only the valid tool
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe("good_tool");
    // Manifest is still present
    expect(result.manifest).toEqual({
      name: "mixed",
      apiVersion: "1.2",
      version: "0.2.0",
    });
    // Should report errors for invalid tools
    expect(result.error).toBeDefined();
    expect(result.error).toContain("bad_tool_1");
    expect(result.error).toContain("bad_tool_2");
    expect(result.error).toContain("invalid shape");
  });
});
