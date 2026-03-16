// @summary Tests for ToolRenderPayload path relativization in glob/grep outputs

import { afterEach, describe, expect, test } from "bun:test";
import { deriveToolRenderPayload } from "../../src/tools/render-payload";

describe("deriveToolRenderPayload path formatting", () => {
  const cwd = process.cwd().replace(/\\/g, "/");
  const originalProcess = globalThis.process;

  afterEach(() => {
    globalThis.process = originalProcess;
  });

  test("glob list paths become relative when under absolute search path", () => {
    const payload = deriveToolRenderPayload(
      "glob",
      { pattern: "**/*.ts", path: cwd },
      `${cwd}/src/main.ts\n${cwd}/package.json\n/opt/other/file.ts`,
      false,
      { cwd },
    );

    expect(payload?.version).toBe(2);
    expect(payload?.inputSummary).toBe('Search(pattern: "**/*.ts", path: ".")');
    expect(payload?.blocks[0]?.type).toBe("summary");
    const summaryBlock = payload?.blocks[0];
    if (!summaryBlock || summaryBlock.type !== "summary") throw new Error("Expected summary block");
    expect(summaryBlock.text).toBe('Search(pattern: "**/*.ts", path: ".")');

    const listBlock = payload?.blocks[1];
    if (!listBlock || listBlock.type !== "list") throw new Error("Expected list block");
    expect(listBlock.title).toBe("└ Found 3 files");
    expect(listBlock.items).toEqual(["src/main.ts", "package.json", "/opt/other/file.ts"]);

    const queryBlock = payload?.blocks[2];
    if (!queryBlock || queryBlock.type !== "key_value") throw new Error("Expected query key_value block");
    expect(queryBlock.title).toBe("Query");
    expect(queryBlock.items).toEqual([
      { key: "pattern", value: "**/*.ts" },
      { key: "path", value: "." },
    ]);
  });

  test("grep output path becomes relative when searching a directory", () => {
    const payload = deriveToolRenderPayload(
      "grep",
      { pattern: "TODO", path: cwd },
      `${cwd}/src/main.ts:12:// TODO`,
      false,
      { cwd },
    );

    expect(payload?.version).toBe(2);
    expect(payload?.inputSummary).toBe('Search(pattern: "TODO", path: ".")');
    expect(payload?.blocks[0]?.type).toBe("summary");
    const summaryBlock = payload?.blocks[0];
    if (!summaryBlock || summaryBlock.type !== "summary") throw new Error("Expected summary block");
    expect(summaryBlock.text).toBe('Search(pattern: "TODO", path: ".")');

    const listBlock = payload?.blocks[1];
    if (!listBlock || listBlock.type !== "list") throw new Error("Expected list block");
    expect(listBlock.title).toBe("└ Found 1 match");
    expect(listBlock.items).toEqual(["src/main.ts:12:// TODO"]);
  });

  test("grep output path becomes relative when searching a single file", () => {
    const targetFilePath = `${cwd}/src/main.ts`;
    const payload = deriveToolRenderPayload(
      "grep",
      { pattern: "TODO", path: targetFilePath },
      `${targetFilePath}:1:// TODO`,
      false,
      { cwd },
    );

    expect(payload?.blocks[0]?.type).toBe("summary");
    const summaryBlock = payload?.blocks[0];
    if (!summaryBlock || summaryBlock.type !== "summary") throw new Error("Expected summary block");
    expect(summaryBlock.text).toBe('Search(pattern: "TODO", path: "src/main.ts")');

    const listBlock = payload?.blocks[1];
    if (!listBlock || listBlock.type !== "list") throw new Error("Expected list block");
    expect(listBlock.items).toEqual(["main.ts:1:// TODO"]);
  });

  test("glob keeps summary and query blocks when no files found", () => {
    const payload = deriveToolRenderPayload("glob", { pattern: "**/*.nope", path: cwd }, "", false, { cwd });

    expect(payload?.blocks[0]?.type).toBe("summary");
    const summaryBlock = payload?.blocks[0];
    if (!summaryBlock || summaryBlock.type !== "summary") throw new Error("Expected summary block");
    expect(summaryBlock.text).toBe('Search(pattern: "**/*.nope", path: ".")');

    const listBlock = payload?.blocks[1];
    if (!listBlock || listBlock.type !== "list") throw new Error("Expected list block");
    expect(listBlock.title).toBe("└ Found 0 files");
    expect(listBlock.items).toEqual([]);

    const queryBlock = payload?.blocks[2];
    if (!queryBlock || queryBlock.type !== "key_value") throw new Error("Expected query key_value block");
    expect(queryBlock.items).toEqual([
      { key: "pattern", value: "**/*.nope" },
      { key: "path", value: "." },
    ]);
  });

  test("grep keeps summary and query blocks when no matches found", () => {
    const payload = deriveToolRenderPayload("grep", { pattern: "NO_MATCH", path: cwd }, "", false, { cwd });

    expect(payload?.blocks[0]?.type).toBe("summary");
    const summaryBlock = payload?.blocks[0];
    if (!summaryBlock || summaryBlock.type !== "summary") throw new Error("Expected summary block");
    expect(summaryBlock.text).toBe('Search(pattern: "NO_MATCH", path: ".")');

    const listBlock = payload?.blocks[1];
    if (!listBlock || listBlock.type !== "list") throw new Error("Expected list block");
    expect(listBlock.title).toBe("└ Found 0 matches");
    expect(listBlock.items).toEqual([]);

    const queryBlock = payload?.blocks[2];
    if (!queryBlock || queryBlock.type !== "key_value") throw new Error("Expected query key_value block");
    expect(queryBlock.items).toEqual([
      { key: "pattern", value: "NO_MATCH" },
      { key: "path", value: "." },
    ]);
  });

  test("glob summary uses absolute path when cwd option is not provided", () => {
    globalThis.process = undefined as never;

    const payload = deriveToolRenderPayload("glob", { pattern: "**/*.ts", path: cwd }, `${cwd}/src/main.ts`, false);

    const summaryBlock = payload?.blocks[0];
    if (!summaryBlock || summaryBlock.type !== "summary") throw new Error("Expected summary block");
    expect(summaryBlock.text).toBe(`Search(pattern: "**/*.ts", path: ${JSON.stringify(cwd)})`);

    const listBlock = payload?.blocks[1];
    if (!listBlock || listBlock.type !== "list") throw new Error("Expected list block");
    expect(listBlock.items).toEqual(["src/main.ts"]);
  });

  test("glob summary uses cwd option when provided", () => {
    const payload = deriveToolRenderPayload("glob", { pattern: "**/*.ts", path: cwd }, `${cwd}/src/main.ts`, false, {
      cwd,
    });

    const summaryBlock = payload?.blocks[0];
    if (!summaryBlock || summaryBlock.type !== "summary") throw new Error("Expected summary block");
    expect(summaryBlock.text).toBe('Search(pattern: "**/*.ts", path: ".")');

    const listBlock = payload?.blocks[1];
    if (!listBlock || listBlock.type !== "list") throw new Error("Expected list block");
    expect(listBlock.items).toEqual(["src/main.ts"]);
  });
});

describe("deriveToolRenderPayload update_knowledge", () => {
  test("renders key value + tags badges + output summary", () => {
    const payload = deriveToolRenderPayload(
      "update_knowledge",
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
    expect(payload?.outputSummary).toBe("Knowledge saved: [pattern] Prefer batched tool calls");
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

    const tagsBlock = payload?.blocks[1];
    if (!tagsBlock || tagsBlock.type !== "status_badges") throw new Error("Expected status_badges block");
    expect(tagsBlock.title).toBe("Tags");
    expect(tagsBlock.items).toEqual([{ label: "workflow" }, { label: "perf" }]);

    const summaryBlock = payload?.blocks[2];
    if (!summaryBlock || summaryBlock.type !== "summary") throw new Error("Expected summary block");
    expect(summaryBlock.text).toBe("Knowledge saved: [pattern] Prefer batched tool calls");
    expect(summaryBlock.tone).toBe("success");
  });

  test("delete action keeps concise details and marks error summary tone", () => {
    const payload = deriveToolRenderPayload(
      "update_knowledge",
      { action: "delete", id: "k1" },
      "Knowledge delete failed: missing id",
      true,
    );

    expect(payload).toBeDefined();
    expect(payload?.version).toBe(2);
    expect(payload?.inputSummary).toBe("delete");
    expect(payload?.outputSummary).toBe("Knowledge delete failed: missing id");

    const detailBlock = payload?.blocks[0];
    if (!detailBlock || detailBlock.type !== "key_value") throw new Error("Expected key_value block");
    expect(detailBlock.items).toEqual([
      { key: "action", value: "delete" },
      { key: "id", value: "k1" },
    ]);

    const summaryBlock = payload?.blocks[payload.blocks.length - 1];
    if (!summaryBlock || summaryBlock.type !== "summary") throw new Error("Expected summary block");
    expect(summaryBlock.tone).toBe("danger");
    expect(summaryBlock.text).toBe("Knowledge delete failed: missing id");
  });
});
