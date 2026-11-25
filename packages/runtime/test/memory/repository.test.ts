// @summary Tests for shared memory mutations used by agent tools and client RPC
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@diligent/core/tool-contract";
import { deleteMemory, readMemory, upsertMemory } from "@diligent/runtime/memory";
import { createUpdateMemoryTool } from "@diligent/runtime/tools";

const ctx: ToolContext = { toolCallId: "repo-test", signal: new AbortController().signal, abort: () => {} };

function indexLines(index: string): string[] {
  return index.split("\n").filter((line) => line.startsWith("- ["));
}

describe("memory repository", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("persists every save when the agent writes several memories at once", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-repo-"));
    const tool = createUpdateMemoryTool(tmpDir, "session-1");

    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        tool.execute({ action: "upsert", type: "project", content: `Remaining work ${i}` }, ctx),
      ),
    );

    expect(await readMemory(tmpDir)).toHaveLength(10);
    expect(indexLines(await readFile(join(tmpDir, "MEMORY.md"), "utf8"))).toHaveLength(10);
  });

  it("creates a memory file and an index line from the name and description", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-repo-"));

    const { entry, status } = await upsertMemory(tmpDir, {
      type: "reference",
      name: "Combat design doc",
      description: "Full combat design lives in docs/design/combat.md",
      content: "See docs/design/combat.md for the combat design.",
      sessionId: "session-1",
    });

    expect(status).toBe("created");
    expect(entry).toMatchObject({ id: "combat-design-doc", name: "Combat design doc", sessionId: "session-1" });
    expect(await readFile(join(tmpDir, "MEMORY.md"), "utf8")).toBe(
      "# Memory Index\n\n- [Combat design doc](combat-design-doc.md) — Full combat design lives in docs/design/combat.md\n",
    );
  });

  it("gives memories with the same title distinct files", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-repo-"));

    const first = await upsertMemory(tmpDir, { type: "project", name: "Plan", content: "First plan" });
    const second = await upsertMemory(tmpDir, { type: "project", name: "plan", content: "Second plan" });

    expect([first.entry.id, second.entry.id]).toEqual(["plan", "plan-2"]);
    expect((await readdir(tmpDir)).sort()).toEqual(["MEMORY.md", "plan-2.md", "plan.md"]);
  });

  it("derives the description from content when none is given", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-repo-"));

    const { entry } = await upsertMemory(tmpDir, {
      type: "project",
      content: "## Remaining work\n- connect the HP bar to the damage event",
    });

    expect(entry.description).toBe("Remaining work");
  });

  it("revises a memory by id in place instead of adding another index line", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-repo-"));
    const { entry } = await upsertMemory(tmpDir, {
      id: "combat",
      type: "project",
      description: "Remaining: HP bar",
      content: "Remaining: HP bar",
    });
    await upsertMemory(tmpDir, { id: "other", type: "project", content: "Other memory" });

    const revised = await upsertMemory(tmpDir, {
      id: entry.id,
      type: "project",
      content: "Remaining: floating damage numbers",
    });

    expect(revised.status).toBe("updated");
    expect(revised.entry.description).toBe("Remaining: floating damage numbers");
    expect(indexLines(await readFile(join(tmpDir, "MEMORY.md"), "utf8"))).toEqual([
      "- [combat](combat.md) — Remaining: floating damage numbers",
      "- [other](other.md) — Other memory",
    ]);
  });

  it("refreshes an existing memory instead of saving the same content twice", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-repo-"));
    const first = await upsertMemory(tmpDir, { type: "feedback", content: "Prefer  Korean responses" });

    const again = await upsertMemory(tmpDir, { type: "feedback", content: "prefer korean responses " });

    expect(again.status).toBe("duplicate");
    expect(again.entry.id).toBe(first.entry.id);
    expect(await readMemory(tmpDir)).toHaveLength(1);
  });

  it("reports duplicates through the agent tool", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-repo-"));
    const tool = createUpdateMemoryTool(tmpDir);
    await tool.execute({ action: "upsert", type: "feedback", content: "Use Bun" }, ctx);

    const result = await tool.execute({ action: "upsert", type: "feedback", content: "Use Bun" }, ctx);

    expect(result.output).toContain("Memory already saved");
    expect(result.metadata).toMatchObject({ status: "duplicate", updated: true });
  });

  it("rejects ids that are not plain file names", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-repo-"));

    for (const id of ["../escape", "nested/file", "MEMORY", ".hidden"]) {
      await expect(upsertMemory(tmpDir, { id, type: "project", content: "x" })).rejects.toThrow("Invalid memory id");
    }
    expect(await readdir(tmpDir)).toEqual([]);
  });

  it("deletes the memory file and its index line", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-repo-"));
    const { entry } = await upsertMemory(tmpDir, { type: "feedback", content: "Use Bun" });
    await upsertMemory(tmpDir, { id: "kept", type: "project", content: "Kept" });

    expect(await deleteMemory(tmpDir, "missing")).toBe(false);
    expect(await deleteMemory(tmpDir, entry.id)).toBe(true);
    expect((await readMemory(tmpDir)).map((memory) => memory.id)).toEqual(["kept"]);
    expect(indexLines(await readFile(join(tmpDir, "MEMORY.md"), "utf8"))).toEqual(["- [kept](kept.md) — Kept"]);
  });

  it("removes a dangling index line even when its file is already gone", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-repo-"));
    await writeFile(join(tmpDir, "MEMORY.md"), "# Memory Index\n\n- [Gone](gone.md) — removed by hand\n");

    expect(await deleteMemory(tmpDir, "gone")).toBe(true);
    expect(await readFile(join(tmpDir, "MEMORY.md"), "utf8")).toBe("# Memory Index\n\n");
  });
});
