// @summary Tests for render payload builder helpers used by producer-first tool results

import { afterEach, describe, expect, test } from "bun:test";
import {
  createGlobRenderPayload,
  createGrepRenderPayload,
  createPatchDiffRenderPayload,
  createUpdateKnowledgeRenderPayload,
} from "../../src/tools/render-payload";

describe("search render payload builders", () => {
  const cwd = process.cwd().replace(/\\/g, "/");
  const originalProcess = globalThis.process;

  afterEach(() => {
    globalThis.process = originalProcess;
  });

  test("glob list paths become relative when under absolute search path", () => {
    const payload = createGlobRenderPayload(
      { pattern: "**/*.ts", path: cwd },
      `${cwd}/src/main.ts\n${cwd}/package.json\n/opt/other/file.ts`,
      { cwd },
    );

    expect(payload.version).toBe(2);
    expect(payload.inputSummary).toBe('Search(pattern: "**/*.ts", path: ".")');
    expect(payload.outputSummary).toBe("3 files found");
    const summaryBlock = payload.blocks[0];
    if (summaryBlock?.type !== "summary") throw new Error("Expected summary block");
    expect(summaryBlock.text).toBe('Search(pattern: "**/*.ts", path: ".")');

    const listBlock = payload.blocks[1];
    if (listBlock?.type !== "list") throw new Error("Expected list block");
    expect(listBlock.title).toBe("└ Found 3 files");
    expect(listBlock.items).toEqual(["src/main.ts", "package.json", "/opt/other/file.ts"]);
  });

  test("grep output path becomes relative when searching a single file", () => {
    const targetFilePath = `${cwd}/src/main.ts`;
    const payload = createGrepRenderPayload({ pattern: "TODO", path: targetFilePath }, `${targetFilePath}:1:// TODO`, {
      cwd,
    });

    expect(payload.outputSummary).toBe("1 match found");
    const summaryBlock = payload.blocks[0];
    if (summaryBlock?.type !== "summary") throw new Error("Expected summary block");
    expect(summaryBlock.text).toBe('Search(pattern: "TODO", path: "src/main.ts")');

    const listBlock = payload.blocks[1];
    if (listBlock?.type !== "list") throw new Error("Expected list block");
    expect(listBlock.items).toEqual(["main.ts:1:// TODO"]);
  });

  test("glob summary uses absolute path when cwd option is not provided", () => {
    globalThis.process = undefined as never;

    const payload = createGlobRenderPayload({ pattern: "**/*.ts", path: cwd }, `${cwd}/src/main.ts`);
    const summaryBlock = payload.blocks[0];
    if (summaryBlock?.type !== "summary") throw new Error("Expected summary block");
    expect(summaryBlock.text).toBe(`Search(pattern: "**/*.ts", path: ${JSON.stringify(cwd)})`);
  });
});

describe("update knowledge render payload builder", () => {
  test("renders key value + tags badges + output summary", () => {
    const payload = createUpdateKnowledgeRenderPayload(
      {
        action: "upsert",
        id: "k1",
        type: "pattern",
        content: "Prefer batched tool calls for independent reads",
        confidence: 0.9123,
        tags: ["workflow", "perf"],
      },
      "Knowledge saved: [pattern] Prefer batched tool calls",
      false,
    );

    expect(payload).toBeDefined();
    expect(payload?.version).toBe(2);
    expect(payload?.inputSummary).toBe("upsert");
    expect(payload?.outputSummary).toBe("1 knowledge entry updated");
    expect(payload?.blocks[0]).toEqual({
      type: "key_value",
      items: [
        { key: "action", value: "upsert" },
        { key: "id", value: "k1" },
        { key: "type", value: "pattern" },
        { key: "confidence", value: "0.91" },
        { key: "content", value: "Prefer batched tool calls for independent reads" },
        { key: "tags", value: "workflow, perf" },
      ],
    });
  });
});

describe("patch render payload builder", () => {
  test("creates diff block from codex patch text", () => {
    const patch = [
      "*** Begin Patch",
      "*** Update File: src/a.ts",
      "@@",
      "-const a = 1;",
      "+const a = 2;",
      "*** End Patch",
    ].join("\n");

    const payload = createPatchDiffRenderPayload(patch, "Success. Updated the following files:\nM src/a.ts");
    expect(payload?.version).toBe(2);
    const diffBlock = payload?.blocks[0];
    if (!diffBlock || diffBlock.type !== "diff") throw new Error("Expected diff block");
    expect(diffBlock.files[0]?.filePath).toBe("src/a.ts");
  });
});
