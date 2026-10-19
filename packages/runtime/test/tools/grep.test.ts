// @summary Tests for grep/ripgrep tool with pattern matching and filtering
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ToolContext } from "@diligent/core/tool-contract";
import { createGrepTool } from "@diligent/runtime/tools";

function makeCtx(): ToolContext {
  return {
    toolCallId: "tc_test",
    signal: new AbortController().signal,
    abort: () => {},
  };
}

async function hasRipgrep(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["rg", "--version"], { stdout: "pipe", stderr: "pipe" });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

describe("grep tool", () => {
  let tmpDir: string;
  let rgAvailable: boolean;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "grep-test-"));
    rgAvailable = await hasRipgrep();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("finds regex matches with line numbers", async () => {
    if (!rgAvailable) return;

    await writeFile(join(tmpDir, "test.ts"), "const foo = 1;\nconst bar = 2;\nconst fooBar = 3;\n");

    const tool = createGrepTool(tmpDir);
    const result = await tool.execute({ pattern: "foo" }, makeCtx());
    expect(result.render).toBeDefined();
    expect(result.render?.blocks[0]).toMatchObject({ type: "summary" });
    expect(result.output).toContain("foo");
    expect(result.output).toContain(":1:");
    expect(result.output).toContain(":3:");
    expect(result.truncateDirection).toBe("head");
  });

  test("supports case-insensitive search", async () => {
    if (!rgAvailable) return;

    await writeFile(join(tmpDir, "test.ts"), "Hello\nhello\nHELLO\n");

    const tool = createGrepTool(tmpDir);
    const result = await tool.execute({ pattern: "hello", ignore_case: true }, makeCtx());
    expect(result.output).toContain("Hello");
    expect(result.output).toContain("hello");
    expect(result.output).toContain("HELLO");
  });

  test("filters by include pattern", async () => {
    if (!rgAvailable) return;

    await writeFile(join(tmpDir, "app.ts"), "TODO: fix this\n");
    await writeFile(join(tmpDir, "app.js"), "TODO: fix that\n");

    const tool = createGrepTool(tmpDir);
    const result = await tool.execute({ pattern: "TODO", include: "*.ts" }, makeCtx());
    expect(result.output).toContain("app.ts");
    expect(result.output).not.toContain("app.js");
  });

  test("shows context lines", async () => {
    if (!rgAvailable) return;

    await writeFile(join(tmpDir, "test.ts"), "line1\nline2\nMATCH\nline4\nline5\n");

    const tool = createGrepTool(tmpDir);
    const result = await tool.execute({ pattern: "MATCH", context: 1 }, makeCtx());
    expect(result.output).toContain("line2");
    expect(result.output).toContain("MATCH");
    expect(result.output).toContain("line4");
  });

  test("returns no matches message for empty results", async () => {
    if (!rgAvailable) return;

    await writeFile(join(tmpDir, "test.ts"), "nothing here\n");

    const tool = createGrepTool(tmpDir);
    const result = await tool.execute({ pattern: "nonexistent" }, makeCtx());
    expect(result.render).toBeDefined();
    expect(result.output).toContain("No matches found");
    expect(result.render?.outputSummary).toBe("0 matches found");
    const listBlock = result.render?.blocks.find((block) => block.type === "list");
    expect(listBlock).toMatchObject({ type: "list", title: "└ Found 0 matches", items: [] });
  });

  test("resolves relative path against cwd", async () => {
    if (!rgAvailable) return;

    await writeFile(join(tmpDir, "relative.ts"), "const marker = 1;\n");
    const tool = createGrepTool(tmpDir);
    const result = await tool.execute({ pattern: "marker", path: "." }, makeCtx());
    expect(result.output).toContain("relative.ts");
  });

  test("returns error for filesystem root path", async () => {
    const tool = createGrepTool(tmpDir);
    const result = await tool.execute({ pattern: "marker", path: "/" }, makeCtx());
    expect(result.render?.blocks[0]).toMatchObject({ type: "text", title: "Output" });
    expect(result.output).toContain("refusing to grep the filesystem root");
    expect(result.metadata).toMatchObject({
      error: true,
      status: {
        kind: "invalid_scope",
        code: "filesystem_root",
        path: "/",
        retryable: false,
        actionable: true,
      },
    });
  });
});

describe("grep tool without ripgrep (in-process fallback)", () => {
  const noRg = { resolveRgBinary: () => null };
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "grep-fallback-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  async function writeFixture(): Promise<void> {
    await mkdir(join(tmpDir, ".git"));
    await mkdir(join(tmpDir, "src", "nested"), { recursive: true });
    await mkdir(join(tmpDir, "node_modules", "pkg"), { recursive: true });
    await mkdir(join(tmpDir, ".cache"));
    await mkdir(join(tmpDir, "dist"));
    await writeFile(join(tmpDir, ".gitignore"), "dist/\n*.log\n");
    await writeFile(join(tmpDir, "src", "app.ts"), "const needle = 1;\nconst other = 2;\n");
    await writeFile(join(tmpDir, "src", "nested", "deep.js"), "// Needle in js\n");
    await writeFile(join(tmpDir, ".git", "config"), "needle\n");
    await writeFile(join(tmpDir, "node_modules", "pkg", "index.js"), "needle\n");
    await writeFile(join(tmpDir, ".cache", "hidden.ts"), "needle\n");
    await writeFile(join(tmpDir, "dist", "bundle.js"), "needle\n");
    await writeFile(join(tmpDir, "debug.log"), "needle\n");
    await writeFile(join(tmpDir, "binary.bin"), Buffer.from([0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65, 0x00, 0x01]));
  }

  test("returns ripgrep-shaped matches and skips .git, node_modules, hidden, gitignored and binary files", async () => {
    await writeFixture();
    const tool = createGrepTool(tmpDir, noRg);

    const result = await tool.execute({ pattern: "needle" }, makeCtx());

    expect(result.output).toBe(`${tmpDir}/src/app.ts:1:const needle = 1;`);
    expect(result.metadata?.error).toBeUndefined();
    expect(result.render?.outputSummary).toBe("1 match found");
  });

  test("honors ignore_case and include", async () => {
    await writeFixture();
    const tool = createGrepTool(tmpDir, noRg);

    const insensitive = await tool.execute({ pattern: "needle", ignore_case: true }, makeCtx());
    expect(insensitive.output.split("\n").sort()).toEqual([
      `${tmpDir}/src/app.ts:1:const needle = 1;`,
      `${tmpDir}/src/nested/deep.js:1:// Needle in js`,
    ]);

    const jsOnly = await tool.execute({ pattern: "needle", ignore_case: true, include: "*.js" }, makeCtx());
    expect(jsOnly.output).toBe(`${tmpDir}/src/nested/deep.js:1:// Needle in js`);
  });

  test("emits context lines and group separators like rg -C", async () => {
    await writeFile(join(tmpDir, "ctx.txt"), "a\nb MATCH\nc\nd\ne\nf\nMATCH g\nh\n");
    const tool = createGrepTool(tmpDir, noRg);

    const result = await tool.execute({ pattern: "MATCH", context: 1 }, makeCtx());

    const file = `${tmpDir}/ctx.txt`;
    expect(result.output).toBe(
      [`${file}-1-a`, `${file}:2:b MATCH`, `${file}-3-c`, "--", `${file}-6-f`, `${file}:7:MATCH g`, `${file}-8-h`].join(
        "\n",
      ),
    );
  });

  test("omits the path prefix when searching a single file", async () => {
    await writeFile(join(tmpDir, "one.ts"), "x\nneedle here\n");
    const tool = createGrepTool(tmpDir, noRg);

    const result = await tool.execute({ pattern: "needle", path: "one.ts" }, makeCtx());

    expect(result.output).toBe("2:needle here");
  });

  test("applies the match limit and reports the overflow", async () => {
    const lines = Array.from({ length: 150 }, (_, i) => `hit ${i}`).join("\n");
    await writeFile(join(tmpDir, "many.txt"), `${lines}\n`);
    const tool = createGrepTool(tmpDir, noRg);

    const result = await tool.execute({ pattern: "^hit \\d+$" }, makeCtx());

    const [shown, overflow] = result.output.split("\n\n");
    expect(shown.split("\n")).toHaveLength(100);
    expect(shown.split("\n")[99]).toBe(`${tmpDir}/many.txt:100:hit 99`);
    expect(overflow).toBe("... (50 more matches not shown)");
  });

  test("returns no matches and reports invalid JavaScript regex as an error", async () => {
    await writeFile(join(tmpDir, "a.ts"), "alpha\n");
    const tool = createGrepTool(tmpDir, noRg);

    const none = await tool.execute({ pattern: "zzz" }, makeCtx());
    expect(none.output).toBe("No matches found.");

    const invalid = await tool.execute({ pattern: "(unclosed" }, makeCtx());
    expect(invalid.metadata).toMatchObject({ error: true });
    expect(invalid.output).toStartWith("Error running grep:");
  });

  test("falls back automatically when PATH has no rg and no override or bundle exists", async () => {
    const bundled = join(dirname(process.execPath), "assets", "bin", process.platform === "win32" ? "rg.exe" : "rg");
    if (existsSync(bundled)) return; // a bundled rg takes precedence on this host
    await writeFixture();
    const originalPath = process.env.PATH;
    const originalRgPath = process.env.DILIGENT_RG_PATH;
    process.env.PATH = join(tmpDir, "empty-bin");
    delete process.env.DILIGENT_RG_PATH;
    try {
      const result = await createGrepTool(tmpDir).execute({ pattern: "needle" }, makeCtx());
      expect(result.output).toBe(`${tmpDir}/src/app.ts:1:const needle = 1;`);
    } finally {
      process.env.PATH = originalPath;
      if (originalRgPath === undefined) delete process.env.DILIGENT_RG_PATH;
      else process.env.DILIGENT_RG_PATH = originalRgPath;
    }
  });

  test("matches ripgrep output on the same fixture when rg is installed", async () => {
    if (!(await hasRipgrep())) return;
    await writeFixture();
    // rg does not skip node_modules by itself; ignore it explicitly so both backends agree.
    await writeFile(join(tmpDir, ".gitignore"), "dist/\n*.log\nnode_modules/\n");
    await writeFile(join(tmpDir, "src", "ctx.ts"), "one\nneedle two\nthree\nfour\nfive\nNEEDLE six\n");
    const args = { pattern: "needle", ignore_case: true, context: 1 };

    const viaRg = await createGrepTool(tmpDir, { resolveRgBinary: () => "rg" }).execute(args, makeCtx());
    const viaFallback = await createGrepTool(tmpDir, noRg).execute(args, makeCtx());

    expect(viaFallback.output.split("\n").sort()).toEqual(viaRg.output.split("\n").sort());
  });
});
