// @summary Tests for shared memory mutations used by agent tools and client RPC
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@diligent/core/tool-contract";
import { deleteMemory, readMemory, upsertMemory } from "@diligent/runtime/memory";
import { createUpdateMemoryTool } from "@diligent/runtime/tools";

const ctx: ToolContext = { toolCallId: "repo-test", signal: new AbortController().signal, abort: () => {} };

describe("memory repository", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("persists every save when the agent writes several preferences at once", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-repo-"));
    const tool = createUpdateMemoryTool(tmpDir, "session-1");

    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        tool.execute({ action: "upsert", type: "preference", content: `Preference ${i}` }, ctx),
      ),
    );

    expect(await readMemory(tmpDir)).toHaveLength(10);
  });

  it("refreshes an existing entry instead of saving the same preference twice", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-repo-"));
    const first = await upsertMemory(tmpDir, { type: "preference", content: "Prefer  Korean responses" });

    const again = await upsertMemory(tmpDir, {
      type: "preference",
      content: "prefer korean responses ",
      tags: ["lang"],
    });

    expect(again.status).toBe("duplicate");
    expect(again.entry.id).toBe(first.entry.id);
    expect(again.entry.tags).toEqual(["lang"]);
    expect(await readMemory(tmpDir)).toHaveLength(1);
  });

  it("reports duplicates through the agent tool", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-repo-"));
    const tool = createUpdateMemoryTool(tmpDir);
    await tool.execute({ action: "upsert", type: "preference", content: "Use Bun" }, ctx);

    const result = await tool.execute({ action: "upsert", type: "preference", content: "Use Bun" }, ctx);

    expect(result.output).toContain("Memory already saved");
    expect(result.metadata).toMatchObject({ status: "duplicate", updated: true });
  });

  it("keeps a new entry separate when the caller gives a stable id", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-repo-"));
    await upsertMemory(tmpDir, { type: "preference", content: "Use Bun" });

    const keyed = await upsertMemory(tmpDir, { id: "project.runtime", type: "preference", content: "Use Bun" });

    expect(keyed).toMatchObject({ status: "created", entry: { id: "project.runtime" } });
    expect(await readMemory(tmpDir)).toHaveLength(2);
  });

  it("does not treat a superseded entry as a duplicate", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-repo-"));
    const old = await upsertMemory(tmpDir, { type: "preference", content: "Use npm" });
    await upsertMemory(tmpDir, { id: "replacement", type: "preference", content: "Use Bun" });
    const entries = await readMemory(tmpDir);
    const { writeMemory } = await import("@diligent/runtime/memory");
    await writeMemory(
      tmpDir,
      entries.map((entry) => (entry.id === "replacement" ? { ...entry, supersedes: old.entry.id } : entry)),
    );

    const restated = await upsertMemory(tmpDir, { type: "preference", content: "Use npm" });

    expect(restated.status).toBe("created");
    expect(restated.entry.id).not.toBe(old.entry.id);
  });

  it("returns whether delete removed an entry", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-repo-"));
    const { entry } = await upsertMemory(tmpDir, { type: "preference", content: "Use Bun" });

    expect(await deleteMemory(tmpDir, "missing")).toBe(false);
    expect(await deleteMemory(tmpDir, entry.id)).toBe(true);
    expect(await readMemory(tmpDir)).toEqual([]);
  });
});
