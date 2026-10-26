// @summary Tests for persistent knowledge storage
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendKnowledge, readKnowledge, readKnowledgeFile, writeKnowledge } from "@diligent/runtime/knowledge";
import { makeKnowledgeEntry } from "../helpers/knowledge";

describe("Knowledge Store", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("append and read roundtrip", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "knowledge-"));
    const entry = makeKnowledgeEntry({ content: "Use Bun.spawn" });

    await appendKnowledge(tmpDir, entry);
    const entries = await readKnowledge(tmpDir);

    expect(entries).toHaveLength(1);
    expect(entries[0].content).toBe("Use Bun.spawn");
    expect(entries[0].id).toBe(entry.id);
  });

  it("reads from empty store", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "knowledge-"));
    const entries = await readKnowledge(tmpDir);
    expect(entries).toEqual([]);
  });

  it("appends multiple entries", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "knowledge-"));
    await appendKnowledge(tmpDir, makeKnowledgeEntry({ content: "first" }));
    await appendKnowledge(tmpDir, makeKnowledgeEntry({ content: "second" }));
    await appendKnowledge(tmpDir, makeKnowledgeEntry({ content: "third" }));

    const entries = await readKnowledge(tmpDir);
    expect(entries).toHaveLength(3);
    expect(entries[0].content).toBe("first");
    expect(entries[2].content).toBe("third");
  });

  it("reads valid entries around unreadable lines and keeps those lines on rewrite", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "knowledge-"));
    const valid = makeKnowledgeEntry({ id: "valid", content: "Use Bun" });
    await writeFile(
      join(tmpDir, "knowledge.jsonl"),
      `${JSON.stringify(valid)}\n{"id":"truncated\n{"id":"missing-fields"}\n`,
    );

    const file = await readKnowledgeFile(tmpDir);
    expect(file.entries.map((entry) => entry.id)).toEqual(["valid"]);
    expect(file.invalidLines).toEqual(['{"id":"truncated', '{"id":"missing-fields"}']);

    await appendKnowledge(tmpDir, makeKnowledgeEntry({ id: "added" }));
    const text = await readFile(join(tmpDir, "knowledge.jsonl"), "utf8");
    expect(text).toContain('{"id":"truncated');
    expect(text).toContain('{"id":"missing-fields"}');
    expect((await readKnowledge(tmpDir)).map((entry) => entry.id)).toEqual(["valid", "added"]);
  });

  it("keeps fields it does not know about when rewriting", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "knowledge-"));
    const future = { ...makeKnowledgeEntry({ id: "future" }), reviewedAt: "2026-10-26T00:00:00Z" };
    await writeFile(join(tmpDir, "knowledge.jsonl"), `${JSON.stringify(future)}\n`);

    await appendKnowledge(tmpDir, makeKnowledgeEntry({ id: "added" }));

    const [first] = await readKnowledge(tmpDir);
    expect(first).toMatchObject({ id: "future", reviewedAt: "2026-10-26T00:00:00Z" });
  });

  it("does not lose concurrent appends", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "knowledge-"));

    await Promise.all(
      Array.from({ length: 20 }, (_, i) => appendKnowledge(tmpDir, makeKnowledgeEntry({ id: `c-${i}` }))),
    );

    const ids = (await readKnowledge(tmpDir)).map((entry) => entry.id).sort();
    expect(ids).toHaveLength(20);
    expect(await readdir(tmpDir)).toEqual(["knowledge.jsonl"]);
  });

  it("continues processing writes after a failed mutation", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "knowledge-"));
    const { mutateKnowledge } = await import("@diligent/runtime/knowledge");

    const failed = mutateKnowledge(tmpDir, () => {
      throw new Error("boom");
    });
    const written = writeKnowledge(tmpDir, [makeKnowledgeEntry({ id: "after-failure" })]);

    await expect(failed).rejects.toThrow("boom");
    await written;
    expect((await readKnowledge(tmpDir)).map((entry) => entry.id)).toEqual(["after-failure"]);
  });
});
