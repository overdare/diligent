// @summary Tests for the lsp tool actions against the fake language server
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ApprovalRequest } from "../../../src/approval/types";
import type { RuntimeToolHost } from "../../../src/tools/capabilities";
import { createLspTool } from "../../../src/tools/lsp/tool";
import { toReadOnlyTool } from "../../../src/tools/read-only-variant";
import { createFakeLspProject, type FakeLspProject, makeToolContext } from "../../helpers/lsp";

const A = ["function greet() {", "  return 1", "}", ""].join("\n");
const B = ["greet()", "call greet again", ""].join("\n");

let project: FakeLspProject;

beforeEach(async () => {
  project = await createFakeLspProject();
  await writeFile(join(project.dir, "a.fake"), A);
  await writeFile(join(project.dir, "b.fake"), B);
});

afterEach(async () => {
  await project.cleanup();
});

function tool(host?: RuntimeToolHost) {
  return createLspTool({ workspace: project.workspace, host });
}

async function run(args: Record<string, unknown>, host?: RuntimeToolHost) {
  return tool(host).execute(args as never, makeToolContext());
}

describe("lsp tool", () => {
  test("definition, references and hover resolve the symbol on the given line", async () => {
    await run({ action: "symbols", file: "a.fake" });

    const definition = await run({ action: "definition", file: "b.fake", line: 1, symbol: "greet" });
    expect(definition.output.split("\n").slice(1)).toEqual(["a.fake:1  function greet() {"]);
    expect(definition.render?.blocks).toContainEqual({
      type: "list",
      title: expect.any(String),
      items: ["a.fake:1  function greet() {"],
    });

    const references = await run({ action: "references", file: "a.fake", line: 1, symbol: "greet" });
    expect(references.output.split("\n").slice(1)).toEqual([
      "a.fake:1  function greet() {",
      "b.fake:1  greet()",
      "b.fake:2  call greet again",
    ]);

    const hover = await run({ action: "hover", file: "b.fake", line: 2, symbol: "greet" });
    expect(hover.output).toContain("**greet**");
  });

  test("a symbol missing from the line is an error and sends no request", async () => {
    const result = await run({ action: "hover", file: "a.fake", line: 2, symbol: "greet" });

    expect(result.metadata?.error).toBe(true);
    expect(result.output).toContain("`greet` does not occur on line 2");
    expect(await project.log()).not.toContain("textDocument/hover");
  });

  test("each request re-syncs the target file from disk", async () => {
    await run({ action: "symbols", file: "a.fake" });
    await writeFile(join(project.dir, "a.fake"), `${A}function added() {}\n`);

    const symbols = await run({ action: "symbols", file: "a.fake" });
    expect(symbols.output).toContain("a.fake:4  function added");
  });

  test("diagnostics lists errors and warnings with their lines", async () => {
    await writeFile(join(project.dir, "c.fake"), "ok\nWARN maybe\nERROR broken\n");

    const result = await run({ action: "diagnostics", file: "c.fake" });
    expect(result.output.split("\n").slice(1)).toEqual([
      "c.fake:3  error: ERROR broken (fake)",
      "c.fake:2  warning: WARN maybe (fake)",
    ]);
  });

  test("lists at most 100 entries and says how many were left out", async () => {
    await writeFile(join(project.dir, "many.fake"), `${Array.from({ length: 150 }, () => "x").join("\n")}\n`);

    const result = await run({ action: "references", file: "many.fake", line: 1, symbol: "x" });
    const lines = result.output.split("\n");
    expect(lines.filter((line) => line.startsWith("many.fake:"))).toHaveLength(100);
    expect(lines.at(-1)).toBe("… 50 more not shown");
  });

  test("rename without apply previews the edits and writes nothing", async () => {
    await run({ action: "symbols", file: "b.fake" });

    const result = await run({ action: "rename", file: "a.fake", line: 1, symbol: "greet", new_name: "welcome" });
    expect(result.metadata?.error).toBeUndefined();
    expect(result.output).toContain("3 edits in 2 files (preview");
    expect(result.output).toContain("b.fake:2  call greet again  →  call welcome again");
    expect(await readFile(join(project.dir, "a.fake"), "utf-8")).toBe(A);
    expect(await readFile(join(project.dir, "b.fake"), "utf-8")).toBe(B);
  });

  test("rename with apply asks one write approval listing every file, then writes them", async () => {
    await run({ action: "symbols", file: "b.fake" });
    const requests: ApprovalRequest[] = [];
    const host: RuntimeToolHost = {
      approve: async (request) => {
        requests.push(request);
        return "once";
      },
    };

    const result = await run(
      { action: "rename", file: "a.fake", line: 1, symbol: "greet", new_name: "welcome", apply: true },
      host,
    );

    expect(result.metadata?.error).toBeUndefined();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ permission: "write", toolName: "lsp" });
    expect([...(requests[0]?.details?.paths ?? [])].sort()).toEqual(
      [join(project.dir, "a.fake"), join(project.dir, "b.fake")].sort(),
    );
    expect(await readFile(join(project.dir, "a.fake"), "utf-8")).toBe(A.replace("greet", "welcome"));
    expect(await readFile(join(project.dir, "b.fake"), "utf-8")).toBe(B.replaceAll("greet", "welcome"));
  });

  test("rename with apply writes nothing when a file changed while waiting for approval", async () => {
    await run({ action: "symbols", file: "b.fake" });
    const changedB = `${B}greet later\n`;
    const host: RuntimeToolHost = {
      approve: async () => {
        await writeFile(join(project.dir, "b.fake"), changedB);
        return "once";
      },
    };

    const result = await run(
      { action: "rename", file: "a.fake", line: 1, symbol: "greet", new_name: "welcome", apply: true },
      host,
    );

    expect(result.metadata?.error).toBe(true);
    expect(result.output).toContain("b.fake changed while waiting for approval");
    expect(await readFile(join(project.dir, "a.fake"), "utf-8")).toBe(A);
    expect(await readFile(join(project.dir, "b.fake"), "utf-8")).toBe(changedB);
  });

  test("the read-only variant previews a rename but refuses to apply it", async () => {
    const readOnly = toReadOnlyTool(tool());
    const args = { action: "rename", file: "a.fake", line: 1, symbol: "greet", new_name: "welcome" };

    const applied = await readOnly.execute({ ...args, apply: true }, makeToolContext());
    expect(applied.metadata?.error).toBe(true);
    expect(await readFile(join(project.dir, "a.fake"), "utf-8")).toBe(A);

    const preview = await readOnly.execute(args, makeToolContext());
    expect(preview.metadata?.error).toBeUndefined();
    expect(preview.output).toContain("preview");
  });

  test("only an applied rename runs exclusively", () => {
    const { concurrency } = tool();
    expect(concurrency?.({ action: "rename", new_name: "x", apply: true })).toBe("exclusive");
    expect(concurrency?.({ action: "rename", new_name: "x" })).toBe("shared");
    expect(concurrency?.({ action: "references" })).toBe("shared");
  });
});
