// @summary Tests for post-edit diagnostics appended by write tools through the fake language server
import { afterEach, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { LspConfig } from "../../../src/config/schema";
import { createApplyPatchTool } from "../../../src/tools/apply-patch";
import { createEditTool } from "../../../src/tools/edit";
import { createPostWriteHook } from "../../../src/tools/lsp/post-edit";
import { createFakeLspProject, type FakeLspProject, type FakeServerOptions, makeToolContext } from "../../helpers/lsp";

let project: FakeLspProject | undefined;

afterEach(async () => {
  await project?.cleanup();
  project = undefined;
});

async function setup(
  options: { mode?: LspConfig["postEditDiagnostics"]; server?: FakeServerOptions; budgetMs?: number } = {},
) {
  project = await createFakeLspProject({
    server: options.server,
    lsp: { postEditDiagnostics: options.mode ?? "running" },
  });
  const file = join(project.dir, "main.fake");
  await writeFile(file, "ERROR old\nkeep\nline three\n");
  const postWrite = createPostWriteHook(project.workspace, { budgetMs: options.budgetMs });
  return { project, file, edit: createEditTool(undefined, { postWrite }) };
}

describe("post-edit diagnostics", () => {
  test("appends errors in the edited lines and leaves pre-existing errors out", async () => {
    const { project, file, edit } = await setup();
    await project.workspace.acquire(file, { start: true });

    const result = await edit.execute(
      { file_path: file, old_string: "line three", new_string: "ERROR new\nWARN soft", replace_all: false },
      makeToolContext(),
    );

    expect(result.metadata?.error).toBeUndefined();
    const [summary, ...notes] = result.output.split("\n\n");
    expect(summary).toStartWith(`Edited ${file}`);
    expect(notes).toEqual(["LSP (fake): main.fake: 1 error in edited lines\n  main.fake:3 ERROR new"]);
  });

  test("an edit that keeps pre-existing errors elsewhere appends nothing", async () => {
    const { project, file, edit } = await setup();
    await project.workspace.acquire(file, { start: true });

    const result = await edit.execute(
      { file_path: file, old_string: "keep", new_string: "kept", replace_all: false },
      makeToolContext(),
    );

    expect(result.output).toBe(`Edited ${file}: replaced 1 occurrence(s).`);
  });

  test("appends nothing when diagnostics do not arrive within the budget", async () => {
    const { project, file, edit } = await setup({ server: { silent: true }, budgetMs: 100 });
    await project.workspace.acquire(file, { start: true });

    const result = await edit.execute(
      { file_path: file, old_string: "line three", new_string: "ERROR new", replace_all: false },
      makeToolContext(),
    );

    expect(result.metadata?.error).toBeUndefined();
    expect(result.output).toBe(`Edited ${file}: replaced 1 occurrence(s).`);
  });

  test("`running` never starts a server; `start` does", async () => {
    const running = await setup({ mode: "running" });
    const quiet = await running.edit.execute(
      { file_path: running.file, old_string: "line three", new_string: "ERROR new", replace_all: false },
      makeToolContext(),
    );
    expect(quiet.output).toBe(`Edited ${running.file}: replaced 1 occurrence(s).`);
    expect(await running.project.log()).toEqual([]);
    await running.project.cleanup();

    const starting = await setup({ mode: "start" });
    const reported = await starting.edit.execute(
      { file_path: starting.file, old_string: "line three", new_string: "ERROR new", replace_all: false },
      makeToolContext(),
    );
    expect(reported.output).toContain("LSP (fake): main.fake: 1 error in edited lines");
  });

  test("`off` keeps an open document in sync without waiting for diagnostics", async () => {
    const { project, file, edit } = await setup({ mode: "off" });
    const acquired = await project.workspace.acquire(file, { start: true });
    await project.workspace.syncFromDisk(acquired!.client, file);

    const result = await edit.execute(
      { file_path: file, old_string: "line three", new_string: "ERROR new", replace_all: false },
      makeToolContext(),
    );

    expect(result.output).toBe(`Edited ${file}: replaced 1 occurrence(s).`);
    expect(acquired!.client.document(file)?.text).toBe("ERROR old\nkeep\nERROR new\n");
    // The server handles messages in order: once this request is answered, the didChange before it was received.
    await acquired!.client.request("workspace/symbol", { query: "" }, { timeoutMs: 5_000 });
    expect(await project.log()).toContain("textDocument/didChange");
  });

  test("a server that cannot start never turns the edit into an error", async () => {
    const { file, edit } = await setup({ mode: "start", server: { failInitialize: true } });

    const result = await edit.execute(
      { file_path: file, old_string: "line three", new_string: "ERROR new", replace_all: false },
      makeToolContext(),
    );

    expect(result.metadata?.error).toBeUndefined();
    expect(result.output).toBe(`Edited ${file}: replaced 1 occurrence(s).`);
  });

  test("apply_patch reports errors its hunks introduced", async () => {
    const { project, file } = await setup();
    await project.workspace.acquire(file, { start: true });
    const patch = createApplyPatchTool(project.dir, undefined, { postWrite: createPostWriteHook(project.workspace) });

    const result = await patch.execute(
      { patch: "*** Begin Patch\n*** Update File: main.fake\n@@\n keep\n-line three\n+ERROR patched\n*** End Patch" },
      makeToolContext(),
    );

    expect(result.metadata?.error).toBeUndefined();
    expect(result.output).toContain("LSP (fake): main.fake: 1 error in edited lines\n  main.fake:3 ERROR patched");
  });
});
