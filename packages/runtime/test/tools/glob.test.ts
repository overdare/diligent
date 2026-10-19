// @summary Tests for glob tool file pattern matching
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ToolContext } from "@diligent/core/tool-contract";
import { createGlobTool } from "@diligent/runtime/tools";

function makeCtx(): ToolContext {
  return {
    toolCallId: "tc_test",
    signal: new AbortController().signal,
    abort: () => {},
  };
}

// Check if rg is available
async function hasRipgrep(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["rg", "--version"], { stdout: "pipe", stderr: "pipe" });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

describe("glob tool", () => {
  let tmpDir: string;
  let rgAvailable: boolean;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "glob-test-"));
    rgAvailable = await hasRipgrep();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("finds files matching pattern", async () => {
    if (!rgAvailable) return; // skip if rg not installed

    await writeFile(join(tmpDir, "app.ts"), "");
    await writeFile(join(tmpDir, "app.js"), "");
    await writeFile(join(tmpDir, "readme.md"), "");

    const tool = createGlobTool(tmpDir);
    const result = await tool.execute({ pattern: "*.ts" }, makeCtx());
    expect(result.render).toBeDefined();
    expect(result.render?.outputSummary).toBe("1 file found");
    expect(result.render?.blocks[0]).toMatchObject({ type: "summary" });
    expect(result.output).toContain("app.ts");
    expect(result.output).not.toContain("app.js");
    expect(result.output).not.toContain("readme.md");
  });

  test("searches in specified path", async () => {
    if (!rgAvailable) return;

    await mkdir(join(tmpDir, "src"));
    await writeFile(join(tmpDir, "src", "index.ts"), "");
    await writeFile(join(tmpDir, "root.ts"), "");

    const tool = createGlobTool(tmpDir);
    const result = await tool.execute({ pattern: "*.ts", path: join(tmpDir, "src") }, makeCtx());
    expect(result.output).toContain("index.ts");
    expect(result.output).not.toContain("root.ts");
  });

  test("returns no matches message for empty results", async () => {
    if (!rgAvailable) return;

    const tool = createGlobTool(tmpDir);
    const result = await tool.execute({ pattern: "*.xyz" }, makeCtx());
    expect(result.output).toContain("No files found");
    expect(result.render?.outputSummary).toBe("0 files found");
    const listBlock = result.render?.blocks.find((block) => block.type === "list");
    expect(listBlock).toMatchObject({ type: "list", title: "└ Found 0 files", items: [] });
  });

  test("respects nested glob pattern", async () => {
    if (!rgAvailable) return;

    await mkdir(join(tmpDir, "src", "components"), { recursive: true });
    await writeFile(join(tmpDir, "src", "index.ts"), "");
    await writeFile(join(tmpDir, "src", "components", "Button.ts"), "");

    const tool = createGlobTool(tmpDir);
    const result = await tool.execute({ pattern: "**/*.ts" }, makeCtx());
    expect(result.output).toContain("index.ts");
    expect(result.output).toContain("Button.ts");
  });

  test("returns error for relative path", async () => {
    const tool = createGlobTool(tmpDir);
    const result = await tool.execute({ pattern: "*.ts", path: "." }, makeCtx());
    expect(result.render?.blocks[0]).toMatchObject({ type: "text", title: "Output" });
    expect(result.output).toContain("path must be absolute");
    expect(result.metadata).toMatchObject({
      error: true,
      status: {
        kind: "invalid_scope",
        code: "relative_path",
        path: ".",
        retryable: false,
        actionable: true,
      },
    });
  });

  test("returns error for absolute filesystem patterns", async () => {
    const tool = createGlobTool(tmpDir);
    const result = await tool.execute({ pattern: `${tmpDir}/src/**/*.ts` }, makeCtx());

    expect(result.output).toContain("pattern must be relative to the search path");
    expect(result.output).toContain("Use a relative pattern like");
    expect(result.metadata).toMatchObject({
      error: true,
      status: {
        kind: "invalid_scope",
        code: "absolute_pattern",
        pattern: `${tmpDir}/src/**/*.ts`,
        path: tmpDir,
        retryable: false,
        actionable: true,
      },
    });
  });

  test("returns error for Windows absolute filesystem patterns", async () => {
    const tool = createGlobTool(tmpDir);
    const result = await tool.execute({ pattern: "C:/Users/alice/project/src/**/*.ts" }, makeCtx());

    expect(result.output).toContain("pattern must be relative to the search path");
    expect(result.metadata).toMatchObject({
      error: true,
      status: {
        kind: "invalid_scope",
        code: "absolute_pattern",
        pattern: "C:/Users/alice/project/src/**/*.ts",
        path: tmpDir,
        retryable: false,
        actionable: true,
      },
    });
  });

  test("allows root-anchored glob patterns", async () => {
    if (!rgAvailable) return;

    await mkdir(join(tmpDir, "src"), { recursive: true });
    await writeFile(join(tmpDir, "src", "index.ts"), "");

    const tool = createGlobTool(tmpDir);
    const result = await tool.execute({ pattern: "/**/src/**/*.ts" }, makeCtx());

    expect(result.output).toContain("index.ts");
    expect(result.metadata?.error).toBeUndefined();
  });

  test("returns error for filesystem root path", async () => {
    const tool = createGlobTool(tmpDir);
    const result = await tool.execute({ pattern: "**/*shim*", path: "/" }, makeCtx());
    expect(result.output).toContain("refusing to glob the filesystem root");
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

describe("glob tool without ripgrep (in-process fallback)", () => {
  const noRg = { resolveRgBinary: () => null };
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "glob-fallback-test-"));
    await mkdir(join(tmpDir, ".git"));
    await mkdir(join(tmpDir, "src", "components"), { recursive: true });
    await mkdir(join(tmpDir, "node_modules", "pkg"), { recursive: true });
    await mkdir(join(tmpDir, ".config"));
    await writeFile(join(tmpDir, ".gitignore"), "src/\n");
    await writeFile(join(tmpDir, "root.ts"), "");
    await writeFile(join(tmpDir, "readme.md"), "");
    await writeFile(join(tmpDir, "src", "index.ts"), "");
    await writeFile(join(tmpDir, "src", "components", "Button.ts"), "");
    await writeFile(join(tmpDir, ".config", "settings.ts"), "");
    await writeFile(join(tmpDir, ".git", "hook.ts"), "");
    await writeFile(join(tmpDir, "node_modules", "pkg", "types.ts"), "");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("matches basenames at any depth, includes hidden and gitignored files, skips .git and node_modules", async () => {
    const tool = createGlobTool(tmpDir, noRg);

    const result = await tool.execute({ pattern: "*.ts" }, makeCtx());

    expect(result.output.split("\n").sort()).toEqual(
      [".config/settings.ts", "root.ts", "src/components/Button.ts", "src/index.ts"].map((p) => `${tmpDir}/${p}`),
    );
    expect(result.render?.outputSummary).toBe("4 files found");
  });

  test("anchors patterns containing a slash to the search path", async () => {
    const tool = createGlobTool(tmpDir, noRg);

    const direct = await tool.execute({ pattern: "src/*.ts" }, makeCtx());
    expect(direct.output).toBe(`${tmpDir}/src/index.ts`);

    const rootAnchored = await tool.execute({ pattern: "/**/components/**/*.ts" }, makeCtx());
    expect(rootAnchored.output).toBe(`${tmpDir}/src/components/Button.ts`);
  });

  test("searches node_modules only when the pattern names it", async () => {
    const tool = createGlobTool(tmpDir, noRg);

    const result = await tool.execute({ pattern: "node_modules/**/*.ts" }, makeCtx());

    expect(result.output).toBe(`${tmpDir}/node_modules/pkg/types.ts`);
  });

  test("sorts newest first and reports overflow beyond the file limit", async () => {
    await mkdir(join(tmpDir, "many"));
    for (let i = 0; i < 105; i++) {
      const file = join(tmpDir, "many", `f${i}.txt`);
      await writeFile(file, "");
      const time = new Date(Date.UTC(2020, 0, 1, 0, 0, i));
      await utimes(file, time, time);
    }
    const tool = createGlobTool(tmpDir, noRg);

    const result = await tool.execute({ pattern: "many/*.txt" }, makeCtx());

    const [shown, overflow] = result.output.split("\n\n");
    const paths = shown.split("\n");
    expect(paths).toHaveLength(100);
    expect(paths[0]).toBe(`${tmpDir}/many/f104.txt`);
    expect(paths[99]).toBe(`${tmpDir}/many/f5.txt`);
    expect(overflow).toBe("... (5 more files not shown)");
  });

  test("reports no files when nothing matches", async () => {
    const tool = createGlobTool(tmpDir, noRg);

    const result = await tool.execute({ pattern: "*.xyz" }, makeCtx());

    expect(result.output).toBe("No files found matching pattern.");
  });

  test("falls back automatically when PATH has no rg and no override or bundle exists", async () => {
    const bundled = join(dirname(process.execPath), "assets", "bin", process.platform === "win32" ? "rg.exe" : "rg");
    if (existsSync(bundled)) return; // a bundled rg takes precedence on this host
    const originalPath = process.env.PATH;
    const originalRgPath = process.env.DILIGENT_RG_PATH;
    process.env.PATH = join(tmpDir, "empty-bin");
    delete process.env.DILIGENT_RG_PATH;
    try {
      const result = await createGlobTool(tmpDir).execute({ pattern: "**/index.ts" }, makeCtx());
      expect(result.output).toBe(`${tmpDir}/src/index.ts`);
    } finally {
      process.env.PATH = originalPath;
      if (originalRgPath === undefined) delete process.env.DILIGENT_RG_PATH;
      else process.env.DILIGENT_RG_PATH = originalRgPath;
    }
  });
});
