// @summary Integration tests of the lsp tool and post-edit diagnostics against real TypeScript language servers
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { LspConfig } from "../../../src/config/schema";
import { createEditTool } from "../../../src/tools/edit";
import { LspManager } from "../../../src/tools/lsp/manager";
import { createPostWriteHook } from "../../../src/tools/lsp/post-edit";
import { isNativeTsc, resolveCommand } from "../../../src/tools/lsp/servers";
import { createLspTool } from "../../../src/tools/lsp/tool";
import { LspWorkspace } from "../../../src/tools/lsp/workspace";
import { makeToolContext } from "../../helpers/lsp";

function resolveOptional(specifier: string): string | undefined {
  try {
    return require.resolve(specifier);
  } catch {
    return undefined;
  }
}

// The repository's own TypeScript: up to 6 it ships tsserver.js for typescript-language-server, from 7 a native tsc
// that speaks LSP itself.
const tsserverPath = resolveOptional("typescript/lib/tsserver.js");
const typescriptPackage = resolveOptional("typescript/package.json");
const repositoryTsc = typescriptPackage ? join(dirname(typescriptPackage), "bin", "tsc") : undefined;

interface Fixture {
  dir: string;
  manager: LspManager;
  workspace: LspWorkspace;
}

/** A small TypeScript project; `link` optionally places the repository's tsc in its node_modules/.bin. */
async function createFixture(config: LspConfig, link?: string): Promise<Fixture> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "lsp-ts-")));
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
  if (link) {
    await mkdir(join(dir, "node_modules", ".bin"), { recursive: true });
    await symlink(link, join(dir, "node_modules", ".bin", "tsc"));
  }
  const manager = new LspManager();
  return { dir, manager, workspace: new LspWorkspace(dir, manager, config) };
}

function defineSuite(serverName: string, setup: () => Promise<Fixture>): void {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await setup();
  });

  afterAll(async () => {
    await fixture?.manager.shutdown();
    if (fixture) await rm(fixture.dir, { recursive: true, force: true });
  });

  test("finds the definition of an imported function", async () => {
    const tool = createLspTool({ workspace: fixture.workspace });
    const result = await tool.execute(
      { action: "definition", file: "src/b.ts", line: 3, symbol: "makeBar", timeout_s: 60 },
      makeToolContext(),
    );
    expect(result.metadata?.error).toBeUndefined();
    expect(result.output).toContain("src/a.ts:5  export function makeBar(value: number): Bar {");
  }, 90_000);

  test("reports the error a broken edit introduced", async () => {
    const edit = createEditTool(undefined, {
      postWrite: createPostWriteHook(fixture.workspace, { budgetMs: 10_000 }),
    });
    const result = await edit.execute(
      {
        file_path: join(fixture.dir, "src", "b.ts"),
        old_string: "bar.value",
        new_string: "bar.foo",
        replace_all: false,
      },
      makeToolContext(),
    );
    expect(result.metadata?.error).toBeUndefined();
    expect(result.output).toContain(`LSP (${serverName}): src/b.ts: 1 error in edited lines`);
    expect(result.output).toContain("src/b.ts:4 Property 'foo' does not exist on type 'Bar'.");
  }, 90_000);
}

describe.skipIf(resolveCommand("typescript-language-server") === undefined || tsserverPath === undefined)(
  "typescript-language-server",
  () => {
    defineSuite("typescript", () =>
      createFixture({ servers: { typescript: { initOptions: { tsserver: { path: tsserverPath } } } } }),
    );
  },
);

// Found through the fixture's node_modules/.bin, not PATH, and chosen over typescript-language-server.
describe.skipIf(repositoryTsc === undefined || !isNativeTsc(repositoryTsc))("native tsc from node_modules/.bin", () => {
  defineSuite("typescript-native", () => createFixture({}, repositoryTsc));
});
