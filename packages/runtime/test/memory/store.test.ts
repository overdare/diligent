// @summary Tests for persistent memory storage
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendMemory, readMemory, readMemoryFile, writeMemory } from "@diligent/runtime/memory";
import { makeMemoryEntry } from "../helpers/memory";

describe("Memory Store", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("append and read roundtrip", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-"));
    const entry = makeMemoryEntry({ content: "Use Bun.spawn" });

    await appendMemory(tmpDir, entry);
    const entries = await readMemory(tmpDir);

    expect(entries).toHaveLength(1);
    expect(entries[0].content).toBe("Use Bun.spawn");
    expect(entries[0].id).toBe(entry.id);
  });

  it("reads from empty store", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-"));
    const entries = await readMemory(tmpDir);
    expect(entries).toEqual([]);
  });

  it("appends multiple entries", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-"));
    await appendMemory(tmpDir, makeMemoryEntry({ content: "first" }));
    await appendMemory(tmpDir, makeMemoryEntry({ content: "second" }));
    await appendMemory(tmpDir, makeMemoryEntry({ content: "third" }));

    const entries = await readMemory(tmpDir);
    expect(entries).toHaveLength(3);
    expect(entries[0].content).toBe("first");
    expect(entries[2].content).toBe("third");
  });

  it("reads valid entries around unreadable lines and keeps those lines on rewrite", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-"));
    const valid = makeMemoryEntry({ id: "valid", content: "Use Bun" });
    await writeFile(
      join(tmpDir, "memory.jsonl"),
      `${JSON.stringify(valid)}\n{"id":"truncated\n{"id":"missing-fields"}\n`,
    );

    const file = await readMemoryFile(tmpDir);
    expect(file.entries.map((entry) => entry.id)).toEqual(["valid"]);
    expect(file.invalidLines).toEqual(['{"id":"truncated', '{"id":"missing-fields"}']);

    await appendMemory(tmpDir, makeMemoryEntry({ id: "added" }));
    const text = await readFile(join(tmpDir, "memory.jsonl"), "utf8");
    expect(text).toContain('{"id":"truncated');
    expect(text).toContain('{"id":"missing-fields"}');
    expect((await readMemory(tmpDir)).map((entry) => entry.id)).toEqual(["valid", "added"]);
  });

  it("keeps fields it does not know about when rewriting", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-"));
    const future = { ...makeMemoryEntry({ id: "future" }), reviewedAt: "2026-10-26T00:00:00Z" };
    await writeFile(join(tmpDir, "memory.jsonl"), `${JSON.stringify(future)}\n`);

    await appendMemory(tmpDir, makeMemoryEntry({ id: "added" }));

    const [first] = await readMemory(tmpDir);
    expect(first).toMatchObject({ id: "future", reviewedAt: "2026-10-26T00:00:00Z" });
  });

  it("does not lose concurrent appends", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-"));

    await Promise.all(Array.from({ length: 20 }, (_, i) => appendMemory(tmpDir, makeMemoryEntry({ id: `c-${i}` }))));

    const ids = (await readMemory(tmpDir)).map((entry) => entry.id).sort();
    expect(ids).toHaveLength(20);
    expect(await readdir(tmpDir)).toEqual(["memory.jsonl"]);
  });

  it("continues processing writes after a failed mutation", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memory-"));
    const { mutateMemory } = await import("@diligent/runtime/memory");

    const failed = mutateMemory(tmpDir, () => {
      throw new Error("boom");
    });
    const written = writeMemory(tmpDir, [makeMemoryEntry({ id: "after-failure" })]);

    await expect(failed).rejects.toThrow("boom");
    await written;
    expect((await readMemory(tmpDir)).map((entry) => entry.id)).toEqual(["after-failure"]);
  });
});
