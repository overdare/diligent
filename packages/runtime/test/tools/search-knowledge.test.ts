// @summary Tests for search_knowledge tool lookup by id and content
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@diligent/core/tool-contract";
import { writeKnowledge } from "@diligent/runtime/knowledge";
import { createSearchKnowledgeTool, createUpdateKnowledgeTool } from "@diligent/runtime/tools";
import { makeKnowledgeEntry } from "../helpers/knowledge";

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
    expect(result.render).toBeDefined();
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

    const result = await searchTool.execute({ query: "THREAD fork" }, makeCtx());

    expect(result.output).toContain("Implement thread fork feature");
    expect(result.output).toContain("Fork thread view into dedicated panel");
    expect(result.output).not.toContain("Implement skill runtime reload feature");
    expect(result.metadata).toMatchObject({ matchCount: 2 });
  });

  it("filters Korean queries instead of returning unrelated entries", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "knowledge-search-"));
    await writeKnowledge(tmpDir, [
      makeKnowledgeEntry({ id: "language", content: "Prefer \uD55C\uAD6D\uC5B4 responses" }),
      makeKnowledgeEntry({ id: "unrelated", content: "Prefer concise responses" }),
    ]);

    const result = await createSearchKnowledgeTool(tmpDir).execute({ query: "\uD55C\uAD6D\uC5B4" }, makeCtx());

    expect(result.metadata?.ids).toEqual(["language"]);
    expect(result.output).not.toContain("unrelated");
  });

  it("does not treat a query without searchable characters as a wildcard", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "knowledge-search-"));
    await writeKnowledge(tmpDir, [makeKnowledgeEntry({ id: "unrelated" })]);

    const result = await createSearchKnowledgeTool(tmpDir).execute({ query: "!!!" }, makeCtx());

    expect(result.metadata?.ids).toEqual([]);
  });

  it("does not let single-character content tokens match longer queries", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "knowledge-search-"));
    await writeKnowledge(tmpDir, [
      makeKnowledgeEntry({ id: "short-word", content: "Use a cache" }),
      makeKnowledgeEntry({ id: "korean", content: "\uD55C\uAD6D\uC5B4 \uAF2D \uC0AC\uC6A9" }),
    ]);
    const tool = createSearchKnowledgeTool(tmpDir);

    expect((await tool.execute({ query: "package" }, makeCtx())).metadata?.ids).toEqual([]);
    expect((await tool.execute({ query: "\uAF2D\uC740" }, makeCtx())).metadata?.ids).toEqual([]);
    expect((await tool.execute({ query: "\uAF2D" }, makeCtx())).metadata?.ids).toEqual(["korean"]);
    expect((await tool.execute({ query: "\uD55C\uAD6D\uC5B4\uB85C" }, makeCtx())).metadata?.ids).toEqual(["korean"]);
  });

  it("excludes superseded entries from keyword, exact-id, and prefix searches", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "knowledge-search-"));
    await writeKnowledge(tmpDir, [
      makeKnowledgeEntry({ id: "package.old", content: "Use npm" }),
      makeKnowledgeEntry({ id: "package.new", content: "Use Bun", supersedes: "package.old" }),
    ]);
    const tool = createSearchKnowledgeTool(tmpDir);

    expect((await tool.execute({ query: "npm" }, makeCtx())).metadata?.ids).toEqual([]);
    expect((await tool.execute({ id: "package.old" }, makeCtx())).metadata?.ids).toEqual([]);
    expect((await tool.execute({ id_prefix: "package." }, makeCtx())).metadata?.ids).toEqual(["package.new"]);
  });

  it("finds entries by id prefix", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "knowledge-search-"));
    const updateTool = createUpdateKnowledgeTool(tmpDir);
    const searchTool = createSearchKnowledgeTool(tmpDir);

    await updateTool.execute(
      {
        action: "upsert",
        id: "overdare.decision.server_authoritative_combat",
        type: "discovery",
        content: "[OVERDARE_DECISION] Server handles combat damage",
      },
      makeCtx(),
    );
    await updateTool.execute(
      {
        action: "upsert",
        id: "overdare.decision.mobile_first_controls",
        type: "discovery",
        content: "[OVERDARE_DECISION] Controls target mobile first",
      },
      makeCtx(),
    );
    await updateTool.execute(
      {
        action: "upsert",
        id: "overdare.current_plan",
        type: "backlog",
        content: "[OVERDARE_CURRENT_PLAN] Add HP UI",
      },
      makeCtx(),
    );

    const result = await searchTool.execute({ id_prefix: "overdare.decision." }, makeCtx());

    expect(result.output).toContain("overdare.decision.server_authoritative_combat");
    expect(result.output).toContain("overdare.decision.mobile_first_controls");
    expect(result.output).not.toContain("overdare.current_plan");
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

    const result = await searchTool.execute({ query: "thread fork" }, makeCtx());
    const lines = result.output.split("\n");

    expect(lines[0]).toContain("Thread fork feature for web client");
    expect(lines[1]).toContain("Thread feature only");
  });

  it("returns no matches cleanly", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "knowledge-search-"));
    const searchTool = createSearchKnowledgeTool(tmpDir);

    const result = await searchTool.execute({ query: "missing value" }, makeCtx());

    expect(result.output).toBe("No knowledge entries found");
    expect(result.metadata).toMatchObject({ matchCount: 0, ids: [] });
    expect(result.render?.outputSummary).toBe("No knowledge entries found");
  });
});
