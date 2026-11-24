// @summary Tests for update_memory tool upsert and delete operations
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@diligent/core/tool-contract";
import { readMemory } from "@diligent/runtime/memory";
import { createUpdateMemoryTool } from "@diligent/runtime/tools";

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    toolCallId: "test-tc-1",
    signal: new AbortController().signal,
    abort: () => {},
    ...overrides,
  };
}

describe("update_memory tool", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates memory entry via upsert", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-"));
    const tool = createUpdateMemoryTool(tmpDir, "session-123");

    const result = await tool.execute(
      { action: "upsert", type: "pattern", content: "Use Bun.spawn for processes" },
      makeCtx(),
    );

    expect(result.output).toContain("Memory saved");
    expect(result.output).toContain("pattern");
    expect(result.render).toBeDefined();
    expect(result.render?.outputSummary).toBe("1 memory entry saved");
    expect(result.render?.blocks[0]).toMatchObject({ type: "key_value" });

    const entries = await readMemory(tmpDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("pattern");
    expect(entries[0].content).toBe("Use Bun.spawn for processes");
    expect(entries[0].confidence).toBe(0.8);
    expect(entries[0].sessionId).toBe("session-123");
  });

  it("creates a new memory entry with a caller-defined stable id", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-"));
    const tool = createUpdateMemoryTool(tmpDir, "session-123");

    const result = await tool.execute(
      {
        action: "upsert",
        id: "sample-host.current_plan",
        type: "backlog",
        content: "[PROJECT_CURRENT_PLAN]\nremaining:\n- Add HP UI",
      },
      makeCtx(),
    );

    expect(result.output).toContain("Memory saved");
    expect(result.metadata).toMatchObject({ memoryId: "sample-host.current_plan", updated: false });

    const entries = await readMemory(tmpDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("sample-host.current_plan");
  });

  it("updates existing entry when id is provided", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-"));
    const tool = createUpdateMemoryTool(tmpDir);

    await tool.execute({ action: "upsert", type: "backlog", content: "Investigate flaky test" }, makeCtx());
    const seededEntries = await readMemory(tmpDir);
    const seededId = seededEntries[0]?.id;
    if (!seededId) throw new Error("Expected seeded memory entry");

    const updateResult = await tool.execute(
      {
        action: "upsert",
        id: seededId,
        type: "backlog",
        content: "Investigate flaky test in CI",
        tags: ["ci"],
      },
      makeCtx(),
    );

    expect(updateResult.output).toContain("Memory updated");
    expect(updateResult.render).toBeDefined();
    expect(updateResult.render?.outputSummary).toBe("1 memory entry updated");

    const entries = await readMemory(tmpDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(seededId);
    expect(entries[0].content).toBe("Investigate flaky test in CI");
    expect(entries[0].confidence).toBe(0.8);
    expect(entries[0].tags).toEqual(["ci"]);
  });

  it("deletes an existing entry", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-"));
    const tool = createUpdateMemoryTool(tmpDir);

    await tool.execute({ action: "upsert", type: "preference", content: "Prefer concise responses" }, makeCtx());
    const entriesBeforeDelete = await readMemory(tmpDir);
    const seededId = entriesBeforeDelete[0]?.id;
    if (!seededId) throw new Error("Expected seeded memory entry");

    const deleteResult = await tool.execute({ action: "delete", id: seededId }, makeCtx());

    expect(deleteResult.output).toContain("Memory deleted");
    expect(deleteResult.render).toBeDefined();
    expect(deleteResult.render?.outputSummary).toBe("1 memory entry deleted");
    const entries = await readMemory(tmpDir);
    expect(entries).toHaveLength(0);
  });

  it("does not request approval", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-"));
    const tool = createUpdateMemoryTool(tmpDir);

    const result = await tool.execute(
      { action: "upsert", type: "pattern", content: "No approval required" },
      makeCtx(),
    );

    expect(result.output).toContain("Memory saved");
    const entries = await readMemory(tmpDir);
    expect(entries).toHaveLength(1);
  });
});
