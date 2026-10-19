// @summary Tests for the in-process grep/glob fallback used when ripgrep is unavailable
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compileSearchRegex,
  globFilesFallback,
  grepFallback,
  SEARCH_FALLBACK_LIMITS,
} from "../../src/util/search-fallback";

describe("search fallback", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "search-fallback-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("grep applies nested, negated and directory-only gitignore rules inside a git work tree", async () => {
    await mkdir(join(tmpDir, ".git"));
    await mkdir(join(tmpDir, "pkg", "build"), { recursive: true });
    await mkdir(join(tmpDir, "logs"));
    await writeFile(join(tmpDir, ".gitignore"), "*.gen.ts\n!keep.gen.ts\nlogs/\n");
    await writeFile(join(tmpDir, "pkg", ".gitignore"), "/build\n");
    await writeFile(join(tmpDir, "a.gen.ts"), "token\n");
    await writeFile(join(tmpDir, "keep.gen.ts"), "token\n");
    await writeFile(join(tmpDir, "logs", "x.ts"), "token\n");
    await writeFile(join(tmpDir, "pkg", "build", "out.ts"), "token\n");
    await writeFile(join(tmpDir, "pkg", "src.ts"), "token\n");
    // A file named like the dir-only rule is not ignored.
    await writeFile(join(tmpDir, "pkg", "logs"), "token\n");

    const result = await grepFallback(tmpDir, "token");

    expect(result.truncated).toBe(false);
    expect(result.stdout.split("\n").sort()).toEqual(
      ["keep.gen.ts", "pkg/logs", "pkg/src.ts"].map((p) => `${tmpDir}/${p}:1:token`),
    );
  });

  test("grep applies .gitignore from the repository root when searching a subdirectory", async () => {
    await mkdir(join(tmpDir, ".git"));
    await mkdir(join(tmpDir, "sub", "generated"), { recursive: true });
    await writeFile(join(tmpDir, ".gitignore"), "generated/\n");
    await writeFile(join(tmpDir, "sub", "generated", "g.ts"), "token\n");
    await writeFile(join(tmpDir, "sub", "real.ts"), "token\n");

    const result = await grepFallback(join(tmpDir, "sub"), "token");

    expect(result.stdout).toBe(`${tmpDir}/sub/real.ts:1:token`);
  });

  test("grep ignores .gitignore outside a git work tree, like ripgrep", async () => {
    await writeFile(join(tmpDir, ".gitignore"), "*.ts\n");
    await writeFile(join(tmpDir, "a.ts"), "token\n");

    const result = await grepFallback(tmpDir, "token");

    expect(result.stdout).toBe(`${tmpDir}/a.ts:1:token`);
  });

  test("grep stops at the output line bound and marks the result truncated", async () => {
    const total = SEARCH_FALLBACK_LIMITS.maxOutputLines + 50;
    await writeFile(join(tmpDir, "big.txt"), `${Array.from({ length: total }, () => "x").join("\n")}\n`);
    await writeFile(join(tmpDir, "later.txt"), "x\n");

    const result = await grepFallback(tmpDir, "x");

    expect(result.truncated).toBe(true);
    expect(result.stdout.split("\n")).toHaveLength(SEARCH_FALLBACK_LIMITS.maxOutputLines);
    expect(result.stdout).not.toContain("later.txt");
  });

  test("grep strips CRLF line endings and excluded include globs prune directories", async () => {
    await mkdir(join(tmpDir, "vendor"));
    await writeFile(join(tmpDir, "win.txt"), "first\r\nline token\r\n");
    await writeFile(join(tmpDir, "vendor", "v.txt"), "token\n");

    const result = await grepFallback(tmpDir, "token$", { include: "!vendor" });

    expect(result.stdout).toBe(`${tmpDir}/win.txt:2:line token`);
  });

  test("glob does not follow symlinked directories", async () => {
    await mkdir(join(tmpDir, "real"));
    await writeFile(join(tmpDir, "real", "a.ts"), "");
    await symlink(join(tmpDir, "real"), join(tmpDir, "link"));

    const result = await globFilesFallback(tmpDir, "**/*.ts");

    expect(result.stdout).toBe(`${tmpDir}/real/a.ts`);
  });

  test("compileSearchRegex translates leading Rust inline flags", () => {
    expect(compileSearchRegex("(?i)hello", false).test("HELLO")).toBe(true);
    expect(compileSearchRegex("hello", false).test("HELLO")).toBe(false);
    expect(compileSearchRegex("hello", true).test("HELLO")).toBe(true);
    expect(() => compileSearchRegex("(unclosed", false)).toThrow();
  });
});
