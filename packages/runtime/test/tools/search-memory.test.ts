// @summary Tests for search_memory tool lookup by id and content
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@diligent/core/tool-contract";
import { upsertMemory } from "@diligent/runtime/memory";
import { createSearchMemoryTool, createUpdateMemoryTool } from "@diligent/runtime/tools";

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    toolCallId: "test-tc-search-1",
    signal: new AbortController().signal,
    abort: () => {},
    ...overrides,
  };
}

async function seed(dir: string, memories: Array<{ id: string; content: string; description?: string }>) {
  for (const memory of memories) await upsertMemory(dir, { type: "project", ...memory });
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
      { action: "upsert", type: "feedback", content: "Prefer concise responses" },
      makeCtx(),
    );
    const memoryId = saveResult.metadata?.memoryId;
    if (typeof memoryId !== "string") throw new Error("Expected memory id in metadata");

    const result = await searchTool.execute({ id: memoryId }, makeCtx());

    expect(result.output).toContain(memoryId);
    expect(result.output).toContain("Prefer concise responses");
    expect(result.render?.inputSummary).toContain(memoryId);
  });

  it("finds entries by keyword tokens case-insensitively", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-search-"));
    await seed(tmpDir, [
      { id: "fork", content: "Implement thread fork feature" },
      { id: "reload", content: "Implement skill runtime reload feature" },
      { id: "panel", content: "Fork thread view into dedicated panel" },
    ]);

    const result = await createSearchMemoryTool(tmpDir).execute({ query: "THREAD fork" }, makeCtx());

    expect(result.output).toContain("Implement thread fork feature");
    expect(result.output).toContain("Fork thread view into dedicated panel");
    expect(result.output).not.toContain("Implement skill runtime reload feature");
    expect(result.metadata).toMatchObject({ matchCount: 2 });
  });

  it("matches the description as well as the content", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-search-"));
    await seed(tmpDir, [
      { id: "publish", description: "Last world publish state", content: "Version 12 went live." },
      { id: "combat", content: "Server-authoritative hitscan." },
    ]);

    const result = await createSearchMemoryTool(tmpDir).execute({ query: "publish" }, makeCtx());

    expect(result.metadata?.ids).toEqual(["publish"]);
  });

  it("filters Korean queries instead of returning unrelated entries", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-search-"));
    await seed(tmpDir, [
      { id: "language", content: "Prefer \uD55C\uAD6D\uC5B4 responses" },
      { id: "unrelated", content: "Prefer concise responses" },
    ]);

    const result = await createSearchMemoryTool(tmpDir).execute({ query: "\uD55C\uAD6D\uC5B4" }, makeCtx());

    expect(result.metadata?.ids).toEqual(["language"]);
    expect(result.output).not.toContain("unrelated");
  });

  it("does not treat a query without searchable characters as a wildcard", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-search-"));
    await seed(tmpDir, [{ id: "unrelated", content: "Test memory" }]);

    const result = await createSearchMemoryTool(tmpDir).execute({ query: "!!!" }, makeCtx());

    expect(result.metadata?.ids).toEqual([]);
  });

  it("does not let single-character content tokens match longer queries", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-search-"));
    await seed(tmpDir, [
      { id: "short-word", description: "cache", content: "Use a cache" },
      { id: "korean", description: "\uD55C\uAD6D\uC5B4", content: "\uD55C\uAD6D\uC5B4 \uAF2D \uC0AC\uC6A9" },
    ]);
    const tool = createSearchMemoryTool(tmpDir);

    expect((await tool.execute({ query: "package" }, makeCtx())).metadata?.ids).toEqual([]);
    expect((await tool.execute({ query: "\uAF2D\uC740" }, makeCtx())).metadata?.ids).toEqual([]);
    expect((await tool.execute({ query: "\uAF2D" }, makeCtx())).metadata?.ids).toEqual(["korean"]);
    expect((await tool.execute({ query: "\uD55C\uAD6D\uC5B4\uB85C" }, makeCtx())).metadata?.ids).toEqual(["korean"]);
  });

  it("finds entries by id prefix", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-search-"));
    await seed(tmpDir, [
      { id: "decision.server-combat", content: "Server handles combat damage" },
      { id: "decision.mobile-controls", content: "Controls target mobile first" },
      { id: "current-plan", content: "Add HP UI" },
    ]);

    const result = await createSearchMemoryTool(tmpDir).execute({ id_prefix: "decision." }, makeCtx());

    expect(new Set(result.metadata?.ids as string[])).toEqual(
      new Set(["decision.mobile-controls", "decision.server-combat"]),
    );
    expect(result.output).not.toContain("current-plan");
  });

  it("ranks entries with more keyword matches first", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-search-"));
    await seed(tmpDir, [
      { id: "both", content: "Thread fork feature for web client" },
      { id: "one", content: "Thread feature only" },
    ]);

    const result = await createSearchMemoryTool(tmpDir).execute({ query: "thread fork" }, makeCtx());

    expect(result.metadata?.ids).toEqual(["both", "one"]);
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
