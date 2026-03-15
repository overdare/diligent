// @summary Tests for update_knowledge tool upsert and delete operations
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@diligent/core/tool/types";
import { readKnowledge } from "@diligent/runtime/knowledge";
import { createUpdateKnowledgeTool } from "@diligent/runtime/tools";

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    toolCallId: "test-tc-1",
    signal: new AbortController().signal,
    abort: () => {},
    ...overrides,
  };
}

describe("update_knowledge tool", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates knowledge entry via upsert", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "knowledge-"));
    const tool = createUpdateKnowledgeTool(tmpDir, "session-123");

    const result = await tool.execute(
      { action: "upsert", type: "pattern", content: "Use Bun.spawn for processes", confidence: 0.9 },
      makeCtx(),
    );

    expect(result.output).toContain("Knowledge saved");
    expect(result.output).toContain("pattern");

    const entries = await readKnowledge(tmpDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("pattern");
    expect(entries[0].content).toBe("Use Bun.spawn for processes");
    expect(entries[0].confidence).toBe(0.9);
    expect(entries[0].sessionId).toBe("session-123");
  });

  it("updates existing entry when id is provided", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "knowledge-"));
    const tool = createUpdateKnowledgeTool(tmpDir);

    await tool.execute({ action: "upsert", id: "k-1", type: "backlog", content: "Investigate flaky test", confidence: 0.7 }, makeCtx());
    const updateResult = await tool.execute(
      { action: "upsert", id: "k-1", type: "backlog", content: "Investigate flaky test in CI", confidence: 0.95, tags: ["ci"] },
      makeCtx(),
    );

    expect(updateResult.output).toContain("Knowledge updated");

    const entries = await readKnowledge(tmpDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("k-1");
    expect(entries[0].content).toBe("Investigate flaky test in CI");
    expect(entries[0].confidence).toBe(0.95);
    expect(entries[0].tags).toEqual(["ci"]);
  });

  it("deletes an existing entry", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "knowledge-"));
    const tool = createUpdateKnowledgeTool(tmpDir);

    await tool.execute({ action: "upsert", id: "k-2", type: "preference", content: "Prefer concise responses" }, makeCtx());
    const deleteResult = await tool.execute({ action: "delete", id: "k-2" }, makeCtx());

    expect(deleteResult.output).toContain("Knowledge deleted");
    const entries = await readKnowledge(tmpDir);
    expect(entries).toHaveLength(0);
  });

  it("does not request approval", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "knowledge-"));
    const tool = createUpdateKnowledgeTool(tmpDir);

    const result = await tool.execute({ action: "upsert", type: "pattern", content: "No approval required", confidence: 0.9 }, makeCtx());

    expect(result.output).toContain("Knowledge saved");
    const entries = await readKnowledge(tmpDir);
    expect(entries).toHaveLength(1);
  });
});
