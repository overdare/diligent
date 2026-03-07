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

mock.module("@test/name-mismatch", () => ({
  manifest: { name: "@test/different-name", apiVersion: "1.0", version: "1.0.0" },
  createTools: () => [],
}));

mock.module("@test/api-v2", () => ({
  manifest: { name: "@test/api-v2", apiVersion: "2.0", version: "1.0.0" },
  createTools: () => [],
}));

mock.module("@test/api-nan", () => ({
  manifest: { name: "@test/api-nan", apiVersion: "abc.def", version: "1.0.0" },
  createTools: () => [],
}));

mock.module("@test/no-create-tools", () => ({
  manifest: { name: "@test/no-create-tools", apiVersion: "1.0", version: "1.0.0" },
  // no createTools export
}));

mock.module("@test/create-tools-throws", () => ({
  manifest: { name: "@test/create-tools-throws", apiVersion: "1.0", version: "1.0.0" },
  createTools: () => {
    throw new Error("plugin init failed");
  },
}));

mock.module("@test/create-tools-non-array", () => ({
  manifest: { name: "@test/create-tools-non-array", apiVersion: "1.0", version: "1.0.0" },
  createTools: () => ({ not: "an array" }),
}));

mock.module("@test/valid-plugin", () => ({
  manifest: { name: "@test/valid-plugin", apiVersion: "1.0", version: "0.1.0" },
  createTools: () => [
    {
      name: "my_tool",
      description: "A test tool",
      parameters: z.object({ input: z.string() }),
      execute: async () => ({ output: "ok" }),
    },
  ],
}));

mock.module("@test/async-plugin", () => ({
  manifest: { name: "@test/async-plugin", apiVersion: "1.0", version: "0.1.0" },
  createTools: async () => [
    {
      name: "async_tool",
      description: "An async test tool",
      parameters: z.object({}),
      execute: async () => ({ output: "ok" }),
    },
  ],
}));

mock.module("@test/mixed-tools", () => ({
  manifest: { name: "@test/mixed-tools", apiVersion: "1.2", version: "0.2.0" },
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
      // invalid shape
      name: "bad_tool_2",
    },
    null,
    "not-a-tool",
  ],
}));

mock.module("@test/duplicate-tool-names", () => ({
  manifest: { name: "@test/duplicate-tool-names", apiVersion: "1.0", version: "0.1.0" },
  createTools: () => [
    {
      name: "dup_tool",
      description: "first",
      parameters: z.object({}),
      execute: async () => ({ output: "first" }),
    },
    {
      name: "dup_tool",
      description: "second",
      parameters: z.object({}),
      execute: async () => ({ output: "second" }),
    },
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

  it("returns error when manifest.name does not match configured package", async () => {
    const result = await loadPlugin("@test/name-mismatch", CWD);
    expect(result.tools).toEqual([]);
    expect(result.error).toContain("does not match the configured package name");
    expect(result.error).toContain("@test/different-name");
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

  it("returns error when createTools does not return an array", async () => {
    const result = await loadPlugin("@test/create-tools-non-array", CWD);
    expect(result.tools).toEqual([]);
    expect(result.error).toContain("must return an array of tools");
  });

  it("returns valid tools from well-formed plugin", async () => {
    const result = await loadPlugin("@test/valid-plugin", CWD);
    expect(result.error).toBeUndefined();
    expect(result.manifest).toEqual({
      name: "@test/valid-plugin",
      apiVersion: "1.0",
      version: "0.1.0",
    });
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe("my_tool");
    expect(result.tools[0].description).toBe("A test tool");
    expect(typeof result.tools[0].execute).toBe("function");
    expect(result.warnings).toEqual([]);
    expect(result.invalidTools).toEqual([]);
  });

  it("supports async createTools", async () => {
    const result = await loadPlugin("@test/async-plugin", CWD);
    expect(result.error).toBeUndefined();
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe("async_tool");
  });

  it("filters out tools with invalid shape and returns warnings", async () => {
    const result = await loadPlugin("@test/mixed-tools", CWD);
    expect(result.error).toBeUndefined();
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe("good_tool");
    expect(result.manifest).toEqual({
      name: "@test/mixed-tools",
      apiVersion: "1.2",
      version: "0.2.0",
    });
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.join(" ")).toContain("bad_tool_1");
    expect(result.warnings!.join(" ")).toContain("bad_tool_2");
    expect(result.warnings!.join(" ")).toContain("invalid shape");
    expect(result.invalidTools).toHaveLength(4);
  });

  it("rejects duplicate tool names inside one plugin package", async () => {
    const result = await loadPlugin("@test/duplicate-tool-names", CWD);
    expect(result.error).toBeUndefined();
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe("dup_tool");
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.join(" ")).toContain("duplicate tool name 'dup_tool'");
    expect(result.invalidTools).toEqual([
      {
        name: "dup_tool",
        error:
          "Plugin '@test/duplicate-tool-names' exports duplicate tool name 'dup_tool'. Later duplicates are ignored.",
      },
    ]);
  });
});
