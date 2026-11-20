// @summary Tests for edit/multi_edit tolerant matching, line-ending preservation, and stale writes during approval
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@diligent/core/tool-contract";
import { createEditTool, createMultiEditTool, type RuntimeToolHost } from "@diligent/runtime/tools";

function makeCtx(): ToolContext {
  return { toolCallId: "tc_edit", signal: new AbortController().signal, abort: () => {} };
}

let dir = "";
let filePath = "";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "edit-matching-"));
  filePath = join(dir, "file.ts");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function edit(oldString: string, newString: string, host?: RuntimeToolHost) {
  return createEditTool(host).execute(
    { file_path: filePath, old_string: oldString, new_string: newString, replace_all: false },
    makeCtx(),
  );
}

describe("edit tolerant matching", () => {
  test("matches when only trailing whitespace differs and says so", async () => {
    await writeFile(filePath, "function a() {   \n  return 1;\n}\n");
    const result = await edit("function a() {\n  return 1;", "function a() {\n  return 2;");

    expect(result.metadata?.error).toBeUndefined();
    expect(result.output).toContain("ignoring trailing whitespace");
    expect(await readFile(filePath, "utf8")).toBe("function a() {\n  return 2;\n}\n");
  });

  test("re-indents the replacement when the match ignored indentation", async () => {
    await writeFile(filePath, "class A {\n    run() {\n        go();\n    }\n}\n");
    const result = await edit("run() {\n    go();\n}", "run() {\n    stop();\n}");

    expect(result.output).toContain("ignoring indentation");
    expect(await readFile(filePath, "utf8")).toBe("class A {\n    run() {\n        stop();\n    }\n}\n");
  });

  test("matches typographic punctuation against ASCII", async () => {
    await writeFile(filePath, "const s = \u201chello\u201d; // a \u2014 b\n");
    const result = await edit('const s = "hello"; // a - b', 'const s = "bye"; // a - b');

    expect(result.metadata?.error).toBeUndefined();
    expect(await readFile(filePath, "utf8")).toBe('const s = "bye"; // a - b\n');
  });

  test("refuses a tolerant match that is not unique and names the candidate lines", async () => {
    await writeFile(filePath, "  x();\nmid\n    x();\n");
    const result = await edit("x();", "y();");

    expect(result.metadata?.error).toBe(true);
    expect(result.output).toMatch(/lines 1, 3/);
    expect(await readFile(filePath, "utf8")).toBe("  x();\nmid\n    x();\n");
  });

  test("keeps CRLF line endings when old_string uses LF", async () => {
    await writeFile(filePath, "one\r\ntwo\r\nthree\r\n");
    const result = await edit("two\nthree", "TWO\nTHREE");

    expect(result.metadata?.error).toBeUndefined();
    expect(await readFile(filePath, "utf8")).toBe("one\r\nTWO\r\nTHREE\r\n");
  });

  test("replace_all stays exact-only", async () => {
    await writeFile(filePath, "a  \nb\n");
    const result = await createEditTool().execute(
      { file_path: filePath, old_string: "a\nb", new_string: "c", replace_all: true },
      makeCtx(),
    );
    expect(result.metadata?.error).toBe(true);
  });

  test("multi_edit applies tolerant matching per edit", async () => {
    await writeFile(filePath, "alpha   \nbeta\n");
    const result = await createMultiEditTool().execute(
      {
        file_path: filePath,
        edits: [
          { old_string: "alpha\nbeta", new_string: "ALPHA\nbeta", replace_all: false },
          { old_string: "beta", new_string: "BETA", replace_all: false },
        ],
      },
      makeCtx(),
    );
    expect(result.metadata?.error).toBeUndefined();
    expect(await readFile(filePath, "utf8")).toBe("ALPHA\nBETA\n");
  });
});

describe("edit while waiting for approval", () => {
  test("re-applies the edit when an unrelated part of the file changed during approval", async () => {
    await writeFile(filePath, "header\nvalue = 1\n");
    const host: RuntimeToolHost = {
      approve: async () => {
        await writeFile(filePath, "header changed\nvalue = 1\n");
        return "once";
      },
    };
    const result = await edit("value = 1", "value = 2", host);

    expect(result.metadata?.error).toBeUndefined();
    expect(result.output).toContain("changed while waiting for approval");
    expect(await readFile(filePath, "utf8")).toBe("header changed\nvalue = 2\n");
  });

  test("fails instead of overwriting when the edited text changed during approval", async () => {
    await writeFile(filePath, "value = 1\n");
    const host: RuntimeToolHost = {
      approve: async () => {
        await writeFile(filePath, "value = 5\n");
        return "once";
      },
    };
    const result = await edit("value = 1", "value = 2", host);

    expect(result.metadata?.error).toBe(true);
    expect(result.output).toContain("changed while waiting for approval");
    expect(await readFile(filePath, "utf8")).toBe("value = 5\n");
  });

  test("multi_edit also refuses to overwrite a concurrent change", async () => {
    await writeFile(filePath, "a\nb\n");
    const host: RuntimeToolHost = {
      approve: async () => {
        await writeFile(filePath, "a\nchanged\n");
        return "once";
      },
    };
    const result = await createMultiEditTool(host).execute(
      { file_path: filePath, edits: [{ old_string: "b", new_string: "B", replace_all: false }] },
      makeCtx(),
    );

    expect(result.metadata?.error).toBe(true);
    expect(await readFile(filePath, "utf8")).toBe("a\nchanged\n");
  });
});
