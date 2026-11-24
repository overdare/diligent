// @summary Tests for update_memory tool upsert and delete operations
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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

  it("creates a memory file with its session and an index line", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-"));
    const tool = createUpdateMemoryTool(tmpDir, "session-123");

    const result = await tool.execute(
      {
        action: "upsert",
        type: "project",
        name: "Combat damage",
        description: "Damage is server-authoritative",
        content: "Decision: hitscan on the server.\nWhy: client hits allowed speed hacks.",
      },
      makeCtx(),
    );

    expect(result.output).toBe("Memory saved: combat-damage [project] Damage is server-authoritative");
    expect(result.render?.outputSummary).toBe("1 memory entry saved");
    expect(result.metadata).toMatchObject({ memoryId: "combat-damage", updated: false });
    expect(await readMemory(tmpDir)).toMatchObject([
      {
        id: "combat-damage",
        type: "project",
        content: "Decision: hitscan on the server.\nWhy: client hits allowed speed hacks.",
        sessionId: "session-123",
      },
    ]);
    expect(await readFile(join(tmpDir, "MEMORY.md"), "utf8")).toContain(
      "- [Combat damage](combat-damage.md) — Damage is server-authoritative",
    );
  });

  it("updates an existing memory when its id is provided", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-"));
    const tool = createUpdateMemoryTool(tmpDir);
    await tool.execute({ action: "upsert", id: "current-plan", type: "project", content: "Add HP UI" }, makeCtx());

    const updateResult = await tool.execute(
      { action: "upsert", id: "current-plan", type: "project", content: "Add floating damage numbers" },
      makeCtx(),
    );

    expect(updateResult.output).toContain("Memory updated");
    expect(updateResult.render?.outputSummary).toBe("1 memory entry updated");
    expect(await readMemory(tmpDir)).toMatchObject([{ id: "current-plan", content: "Add floating damage numbers" }]);
  });

  it("deletes an existing memory", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-"));
    const tool = createUpdateMemoryTool(tmpDir);
    await tool.execute({ action: "upsert", id: "concise", type: "feedback", content: "Prefer concise" }, makeCtx());

    const deleteResult = await tool.execute({ action: "delete", id: "concise" }, makeCtx());
    const missingResult = await tool.execute({ action: "delete", id: "concise" }, makeCtx());

    expect(deleteResult.output).toBe("Memory deleted: concise");
    expect(deleteResult.render?.outputSummary).toBe("1 memory entry deleted");
    expect(missingResult.output).toBe("Memory not found: concise");
    expect(await readMemory(tmpDir)).toEqual([]);
  });
});
