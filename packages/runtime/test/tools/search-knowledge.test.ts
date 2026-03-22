// @summary Tests for search_knowledge tool lookup by id and content
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@diligent/core/tool/types";
import { createSearchKnowledgeTool, createUpdateKnowledgeTool } from "@diligent/runtime/tools";

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    toolCallId: "test-tc-search-1",
    signal: new AbortController().signal,
    abort: () => {},
    ...overrides,
  };
}

describe("search_knowledge tool", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("finds an entry by exact id", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "knowledge-search-"));
    const updateTool = createUpdateKnowledgeTool(tmpDir);
    const searchTool = createSearchKnowledgeTool(tmpDir);

    const saveResult = await updateTool.execute(
      { action: "upsert", type: "preference", content: "Prefer concise responses" },
      makeCtx(),
    );
    const knowledgeId = saveResult.metadata?.knowledgeId;
    if (typeof knowledgeId !== "string") throw new Error("Expected knowledge id in metadata");

    const result = await searchTool.execute({ id: knowledgeId }, makeCtx());

    expect(result.output).toContain(knowledgeId);
    expect(result.output).toContain("Prefer concise responses");
    expect(result.render?.version).toBe(2);
    expect(result.render?.inputSummary).toContain(knowledgeId);
  });

  it("finds entries by keyword tokens case-insensitively", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "knowledge-search-"));
    const updateTool = createUpdateKnowledgeTool(tmpDir);
    const searchTool = createSearchKnowledgeTool(tmpDir);

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

    const result = await searchTool.execute({ content: "THREAD fork" }, makeCtx());

    expect(result.output).toContain("Implement thread fork feature");
    expect(result.output).toContain("Fork thread view into dedicated panel");
    expect(result.output).not.toContain("Implement skill runtime reload feature");
    expect(result.metadata).toMatchObject({ matchCount: 2 });
  });

  it("ranks entries with more keyword matches first", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "knowledge-search-"));
    const updateTool = createUpdateKnowledgeTool(tmpDir);
    const searchTool = createSearchKnowledgeTool(tmpDir);

    await updateTool.execute(
      { action: "upsert", type: "backlog", content: "Thread fork feature for web client" },
      makeCtx(),
    );
    await updateTool.execute({ action: "upsert", type: "backlog", content: "Thread feature only" }, makeCtx());

    const result = await searchTool.execute({ content: "thread fork" }, makeCtx());
    const lines = result.output.split("\n");

    expect(lines[0]).toContain("Thread fork feature for web client");
    expect(lines[1]).toContain("Thread feature only");
  });

  it("returns no matches cleanly", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "knowledge-search-"));
    const searchTool = createSearchKnowledgeTool(tmpDir);

    const result = await searchTool.execute({ content: "missing value" }, makeCtx());

    expect(result.output).toBe("No knowledge entries found");
    expect(result.metadata).toMatchObject({ matchCount: 0, ids: [] });
    expect(result.render?.outputSummary).toBe("No knowledge entries found");
  });
});
