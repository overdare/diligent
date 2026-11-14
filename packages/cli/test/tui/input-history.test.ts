// @summary Tests for input history persistence and navigation
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InputHistory } from "../../src/tui/input-history";

describe("InputHistory", () => {
  const dirs: string[] = [];

  async function makeTmp(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "diligent-hist-"));
    dirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    for (const d of dirs) {
      await rm(d, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  test("load returns empty when file does not exist", async () => {
    const dir = await makeTmp();
    const h = new InputHistory(join(dir, "no-such-file"));
    await h.load();
    expect(h.getEntries()).toEqual([]);
  });

  test("add and getEntries", async () => {
    const dir = await makeTmp();
    const h = new InputHistory(join(dir, "history"));
    await h.load();
    h.add("first");
    h.add("second");
    expect(h.getEntries()).toEqual(["first", "second"]);
  });

  test("deduplicates consecutive identical entries", async () => {
    const dir = await makeTmp();
    const h = new InputHistory(join(dir, "history"));
    await h.load();
    h.add("same");
    h.add("same");
    h.add("same");
    expect(h.getEntries()).toEqual(["same"]);
  });

  test("non-consecutive duplicates are kept", async () => {
    const dir = await makeTmp();
    const h = new InputHistory(join(dir, "history"));
    await h.load();
    h.add("a");
    h.add("b");
    h.add("a");
    expect(h.getEntries()).toEqual(["a", "b", "a"]);
  });

  test("trims to maxSize", async () => {
    const dir = await makeTmp();
    const h = new InputHistory(join(dir, "history"), 3);
    await h.load();
    h.add("1");
    h.add("2");
    h.add("3");
    h.add("4");
    expect(h.getEntries()).toEqual(["2", "3", "4"]);
  });

  test("persists and reloads from disk", async () => {
    const dir = await makeTmp();
    const filePath = join(dir, "history");

    const h1 = new InputHistory(filePath);
    await h1.load();
    h1.add("alpha");
    h1.add("beta");

    // Wait for fire-and-forget save to complete
    await Bun.sleep(50);

    const h2 = new InputHistory(filePath);
    await h2.load();
    expect(h2.getEntries()).toEqual(["alpha", "beta"]);
  });

  test("load respects maxSize from file", async () => {
    const dir = await makeTmp();
    const filePath = join(dir, "history");

    // Write a file with more entries than maxSize
    await Bun.write(filePath, "a\nb\nc\nd\ne\n");

    const h = new InputHistory(filePath, 3);
    await h.load();
    expect(h.getEntries()).toEqual(["c", "d", "e"]);
  });

  test("creates parent directories on save", async () => {
    const dir = await makeTmp();
    const filePath = join(dir, "nested", "deep", "history");
    const h = new InputHistory(filePath);
    await h.load();
    h.add("test");

    await Bun.sleep(50);

    const content = await Bun.file(filePath).text();
    expect(content).toBe("test\n");
  });

  test("getEntries returns a copy", async () => {
    const dir = await makeTmp();
    const h = new InputHistory(join(dir, "history"));
    await h.load();
    h.add("item");
    const entries = h.getEntries();
    entries.push("mutated");
    expect(h.getEntries()).toEqual(["item"]);
  });
});
