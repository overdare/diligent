// @summary Tests for search_memory tool lookup by id and content
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@diligent/core/tool-contract";
import { writeMemory } from "@diligent/runtime/memory";
import { createSearchMemoryTool, createUpdateMemoryTool } from "@diligent/runtime/tools";
import { makeMemoryEntry } from "../helpers/memory";

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    toolCallId: "test-tc-search-1",
    signal: new AbortController().signal,
    abort: () => {},
    ...overrides,
  };
}

describe("search_memory tool", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("finds an entry by exact id", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-search-"));
    const updateTool = createUpdateMemoryTool(tmpDir);
    const searchTool = createSearchMemoryTool(tmpDir);

    const saveResult = await updateTool.execute(
      { action: "upsert", type: "preference", content: "Prefer concise responses" },
      makeCtx(),
    );
    const memoryId = saveResult.metadata?.memoryId;
    if (typeof memoryId !== "string") throw new Error("Expected memory id in metadata");

    const result = await searchTool.execute({ id: memoryId }, makeCtx());

    expect(result.output).toContain(memoryId);
    expect(result.output).toContain("Prefer concise responses");
    expect(result.render).toBeDefined();
    expect(result.render?.inputSummary).toContain(memoryId);
  });

  it("finds entries by keyword tokens case-insensitively", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-search-"));
    const updateTool = createUpdateMemoryTool(tmpDir);
    const searchTool = createSearchMemoryTool(tmpDir);

    await updateTool.execute(
      { action: "upsert", type: "backlog", content: "Implement thread fork feature" },
      makeCtx(),
    );
    await updateTool.execute(
      { action: "upsert", type: "backlog", content: "Implement skill runtime reload feature" },
      makeCtx(),
    );
    await updateTool.execute(
      { action: "upsert", type: "backlog", content: "Fork thread view into dedicated panel" },
      makeCtx(),
    );

    const result = await searchTool.execute({ query: "THREAD fork" }, makeCtx());

    expect(result.output).toContain("Implement thread fork feature");
    expect(result.output).toContain("Fork thread view into dedicated panel");
    expect(result.output).not.toContain("Implement skill runtime reload feature");
    expect(result.metadata).toMatchObject({ matchCount: 2 });
  });

  it("filters Korean queries instead of returning unrelated entries", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-search-"));
    await writeMemory(tmpDir, [
      makeMemoryEntry({ id: "language", content: "Prefer \uD55C\uAD6D\uC5B4 responses" }),
      makeMemoryEntry({ id: "unrelated", content: "Prefer concise responses" }),
    ]);

    const result = await createSearchMemoryTool(tmpDir).execute({ query: "\uD55C\uAD6D\uC5B4" }, makeCtx());

    expect(result.metadata?.ids).toEqual(["language"]);
    expect(result.output).not.toContain("unrelated");
  });

  it("does not treat a query without searchable characters as a wildcard", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-search-"));
    await writeMemory(tmpDir, [makeMemoryEntry({ id: "unrelated" })]);

    const result = await createSearchMemoryTool(tmpDir).execute({ query: "!!!" }, makeCtx());

    expect(result.metadata?.ids).toEqual([]);
  });

  it("does not let single-character content tokens match longer queries", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-search-"));
    await writeMemory(tmpDir, [
      makeMemoryEntry({ id: "short-word", content: "Use a cache" }),
      makeMemoryEntry({ id: "korean", content: "\uD55C\uAD6D\uC5B4 \uAF2D \uC0AC\uC6A9" }),
    ]);
    const tool = createSearchMemoryTool(tmpDir);

    expect((await tool.execute({ query: "package" }, makeCtx())).metadata?.ids).toEqual([]);
    expect((await tool.execute({ query: "\uAF2D\uC740" }, makeCtx())).metadata?.ids).toEqual([]);
    expect((await tool.execute({ query: "\uAF2D" }, makeCtx())).metadata?.ids).toEqual(["korean"]);
    expect((await tool.execute({ query: "\uD55C\uAD6D\uC5B4\uB85C" }, makeCtx())).metadata?.ids).toEqual(["korean"]);
  });

  it("excludes superseded entries from keyword, exact-id, and prefix searches", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-search-"));
    await writeMemory(tmpDir, [
      makeMemoryEntry({ id: "package.old", content: "Use npm" }),
      makeMemoryEntry({ id: "package.new", content: "Use Bun", supersedes: "package.old" }),
    ]);
    const tool = createSearchMemoryTool(tmpDir);

    expect((await tool.execute({ query: "npm" }, makeCtx())).metadata?.ids).toEqual([]);
    expect((await tool.execute({ id: "package.old" }, makeCtx())).metadata?.ids).toEqual([]);
    expect((await tool.execute({ id_prefix: "package." }, makeCtx())).metadata?.ids).toEqual(["package.new"]);
  });

  it("finds entries by id prefix", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-search-"));
    const updateTool = createUpdateMemoryTool(tmpDir);
    const searchTool = createSearchMemoryTool(tmpDir);

    await updateTool.execute(
      {
        action: "upsert",
        id: "sample-host.decision.server_authoritative_combat",
        type: "discovery",
        content: "[PROJECT_DECISION] Server handles combat damage",
      },
      makeCtx(),
    );
    await updateTool.execute(
      {
        action: "upsert",
        id: "sample-host.decision.mobile_first_controls",
        type: "discovery",
        content: "[PROJECT_DECISION] Controls target mobile first",
      },
      makeCtx(),
    );
    await updateTool.execute(
      {
        action: "upsert",
        id: "sample-host.current_plan",
        type: "backlog",
        content: "[PROJECT_CURRENT_PLAN] Add HP UI",
      },
      makeCtx(),
    );

    const result = await searchTool.execute({ id_prefix: "sample-host.decision." }, makeCtx());

    expect(result.output).toContain("sample-host.decision.server_authoritative_combat");
    expect(result.output).toContain("sample-host.decision.mobile_first_controls");
    expect(result.output).not.toContain("sample-host.current_plan");
    expect(result.metadata).toMatchObject({ matchCount: 2 });
  });

  it("ranks entries with more keyword matches first", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-search-"));
    const updateTool = createUpdateMemoryTool(tmpDir);
    const searchTool = createSearchMemoryTool(tmpDir);

    await updateTool.execute(
      { action: "upsert", type: "backlog", content: "Thread fork feature for web client" },
      makeCtx(),
    );
    await updateTool.execute({ action: "upsert", type: "backlog", content: "Thread feature only" }, makeCtx());

    const result = await searchTool.execute({ query: "thread fork" }, makeCtx());
    const lines = result.output.split("\n");

    expect(lines[0]).toContain("Thread fork feature for web client");
    expect(lines[1]).toContain("Thread feature only");
  });

  it("returns no matches cleanly", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-search-"));
    const searchTool = createSearchMemoryTool(tmpDir);

    const result = await searchTool.execute({ query: "missing value" }, makeCtx());

    expect(result.output).toBe("No memory entries found");
    expect(result.metadata).toMatchObject({ matchCount: 0, ids: [] });
    expect(result.render?.outputSummary).toBe("No memory entries found");
  });
});
