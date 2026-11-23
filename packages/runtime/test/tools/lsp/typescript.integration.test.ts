// @summary Integration test of the lsp tool and post-edit diagnostics against a real typescript-language-server
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEditTool } from "../../../src/tools/edit";
import { LspManager } from "../../../src/tools/lsp/manager";
import { createPostWriteHook } from "../../../src/tools/lsp/post-edit";
import { resolveCommand } from "../../../src/tools/lsp/servers";
import { createLspTool } from "../../../src/tools/lsp/tool";
import { LspWorkspace } from "../../../src/tools/lsp/workspace";
import { makeToolContext } from "../../helpers/lsp";

const available = resolveCommand("typescript-language-server") !== undefined;
// The server needs a TypeScript with tsserver.js; use the repository's own rather than the fixture project's.
const tsserverPath = require.resolve("typescript/lib/tsserver.js");

describe.skipIf(!available)("typescript-language-server", () => {
  let dir: string;
  let manager: LspManager;
  let workspace: LspWorkspace;

  beforeAll(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), "lsp-ts-")));
    await mkdir(join(dir, "src"));
    await writeFile(
      join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "es2022" }, include: ["src"] }),
    );
    await writeFile(
      join(dir, "src", "a.ts"),
      "export interface Bar {\n  value: number;\n}\n\nexport function makeBar(value: number): Bar {\n  return { value };\n}\n",
    );
    await writeFile(
      join(dir, "src", "b.ts"),
      'import { makeBar } from "./a";\n\nconst bar = makeBar(1);\nconsole.log(bar.value);\n',
    );
    manager = new LspManager();
    workspace = new LspWorkspace(dir, manager, {
      servers: { typescript: { initOptions: { tsserver: { path: tsserverPath } } } },
    });
  });

  afterAll(async () => {
    await manager?.shutdown();
    await rm(dir, { recursive: true, force: true });
  });

  test("finds the definition of an imported function", async () => {
    const tool = createLspTool({ workspace });
    const result = await tool.execute(
      { action: "definition", file: "src/b.ts", line: 3, symbol: "makeBar", timeout_s: 60 },
      makeToolContext(),
    );
    expect(result.metadata?.error).toBeUndefined();
    expect(result.output).toContain("src/a.ts:5  export function makeBar(value: number): Bar {");
  }, 90_000);

  test("reports the error a broken edit introduced", async () => {
    const edit = createEditTool(undefined, { postWrite: createPostWriteHook(workspace, { budgetMs: 10_000 }) });
    const file = join(dir, "src", "b.ts");
    const result = await edit.execute(
      { file_path: file, old_string: "bar.value", new_string: "bar.foo", replace_all: false },
      makeToolContext(),
    );
    expect(result.metadata?.error).toBeUndefined();
    expect(result.output).toContain("LSP (typescript): src/b.ts: 1 error in edited lines");
    expect(result.output).toContain("src/b.ts:4 Property 'foo' does not exist on type 'Bar'.");
  }, 90_000);
});
