// @summary Tests for shared knowledge mutations used by agent tools and client RPC
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@diligent/core/tool-contract";
import { deleteKnowledge, readKnowledge, upsertKnowledge } from "@diligent/runtime/knowledge";
import { createUpdateKnowledgeTool } from "@diligent/runtime/tools";

const ctx: ToolContext = { toolCallId: "repo-test", signal: new AbortController().signal, abort: () => {} };

describe("knowledge repository", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("persists every save when the agent writes several preferences at once", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "knowledge-repo-"));
    const tool = createUpdateKnowledgeTool(tmpDir, "session-1");

    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        tool.execute({ action: "upsert", type: "preference", content: `Preference ${i}` }, ctx),
      ),
    );

    expect(await readKnowledge(tmpDir)).toHaveLength(10);
  });

  it("refreshes an existing entry instead of saving the same preference twice", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "knowledge-repo-"));
    const first = await upsertKnowledge(tmpDir, { type: "preference", content: "Prefer  Korean responses" });

    const again = await upsertKnowledge(tmpDir, {
      type: "preference",
      content: "prefer korean responses ",
      tags: ["lang"],
    });

    expect(again.status).toBe("duplicate");
    expect(again.entry.id).toBe(first.entry.id);
    expect(again.entry.tags).toEqual(["lang"]);
    expect(await readKnowledge(tmpDir)).toHaveLength(1);
  });

  it("reports duplicates through the agent tool", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "knowledge-repo-"));
    const tool = createUpdateKnowledgeTool(tmpDir);
    await tool.execute({ action: "upsert", type: "preference", content: "Use Bun" }, ctx);

    const result = await tool.execute({ action: "upsert", type: "preference", content: "Use Bun" }, ctx);

    expect(result.output).toContain("Knowledge already saved");
    expect(result.metadata).toMatchObject({ status: "duplicate", updated: true });
  });

  it("keeps a new entry separate when the caller gives a stable id", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "knowledge-repo-"));
    await upsertKnowledge(tmpDir, { type: "preference", content: "Use Bun" });

    const keyed = await upsertKnowledge(tmpDir, { id: "project.runtime", type: "preference", content: "Use Bun" });

    expect(keyed).toMatchObject({ status: "created", entry: { id: "project.runtime" } });
    expect(await readKnowledge(tmpDir)).toHaveLength(2);
  });

  it("does not treat a superseded entry as a duplicate", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "knowledge-repo-"));
    const old = await upsertKnowledge(tmpDir, { type: "preference", content: "Use npm" });
    await upsertKnowledge(tmpDir, { id: "replacement", type: "preference", content: "Use Bun" });
    const entries = await readKnowledge(tmpDir);
    const { writeKnowledge } = await import("@diligent/runtime/knowledge");
    await writeKnowledge(
      tmpDir,
      entries.map((entry) => (entry.id === "replacement" ? { ...entry, supersedes: old.entry.id } : entry)),
    );

    const restated = await upsertKnowledge(tmpDir, { type: "preference", content: "Use npm" });

    expect(restated.status).toBe("created");
    expect(restated.entry.id).not.toBe(old.entry.id);
  });

  it("returns whether delete removed an entry", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "knowledge-repo-"));
    const { entry } = await upsertKnowledge(tmpDir, { type: "preference", content: "Use Bun" });

    expect(await deleteKnowledge(tmpDir, "missing")).toBe(false);
    expect(await deleteKnowledge(tmpDir, entry.id)).toBe(true);
    expect(await readKnowledge(tmpDir)).toEqual([]);
  });
});
