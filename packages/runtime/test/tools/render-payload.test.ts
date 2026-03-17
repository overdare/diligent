// @summary Tests for render payload builder helpers used by producer-first tool results

import { afterEach, describe, expect, test } from "bun:test";
import {
  createGlobRenderPayload,
  createGrepRenderPayload,
  createPatchDiffRenderPayload,
  createPlanRenderPayload,
  createToolEndRenderPayloadFromInput,
  createToolStartRenderPayload,
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

  test("summaries strip cwd prefix and show relative path", () => {
    const payload = createGlobRenderPayload(
      { pattern: "**/*.ts", path: cwd },
      `${cwd}/src/main.ts\n${cwd}/package.json`,
      { cwd },
    );

    expect(payload.blocks[1]).toMatchObject({
      type: "list",
      items: ["src/main.ts", "package.json"],
    });
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
    expect(payload?.inputSummary).toBe("pattern: Prefer batched tool calls for independent reads");
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
  const cwd = process.cwd().replace(/\\/g, "/");

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
    expect(payload?.inputSummary).toBe("src/a.ts");
    const diffBlock = payload?.blocks[0];
    if (!diffBlock || diffBlock.type !== "diff") throw new Error("Expected diff block");
    expect(diffBlock.files[0]?.filePath).toBe("src/a.ts");
  });

  test("input summary includes first target and extra count", () => {
    const patch = [
      "*** Begin Patch",
      "*** Update File: src/a.ts",
      "@@",
      "-const a = 1;",
      "+const a = 2;",
      "*** Add File: src/b.ts",
      "+export const b = 1;",
      "*** End Patch",
    ].join("\n");

    const payload = createPatchDiffRenderPayload(
      patch,
      "Success. Updated the following files:\nM src/a.ts\nA src/b.ts",
    );
    expect(payload?.inputSummary).toBe("src/a.ts (+1 more)");
  });

  test("summary removes cwd prefix from patch file path", () => {
    const payload = createPatchDiffRenderPayload(
      [
        "*** Begin Patch",
        `*** Update File: ${cwd}/src/a.ts`,
        "@@",
        "-const a = 1;",
        "+const a = 2;",
        "*** End Patch",
      ].join("\n"),
      "Success. Updated the following files:\nM src/a.ts",
    );

    expect(payload?.inputSummary).toBe("src/a.ts");
  });
});

describe("plan render payload builder", () => {
  test("creates progress, ordered list, and hint summary", () => {
    const payload = createPlanRenderPayload({
      title: "Fix Render",
      steps: [
        { text: "Inspect current output", status: "done" },
        { text: "Patch summary format", status: "in_progress" },
        { text: "Run tests", status: "pending" },
      ],
      hint: "1/3 done, 1 in progress, 1 pending. Continue working.",
    });

    expect(payload.inputSummary).toBe("Fix Render (3 steps)");
    expect(payload.outputSummary).toBe("1/3 done");
    expect(payload.blocks[0]).toEqual({
      type: "key_value",
      title: "Progress",
      items: [
        { key: "done", value: "1" },
        { key: "in_progress", value: "1" },
        { key: "pending", value: "1" },
        { key: "cancelled", value: "0" },
      ],
    });

    const listBlock = payload.blocks[1];
    if (listBlock?.type !== "list") throw new Error("Expected list block");
    expect(listBlock.ordered).toBe(true);
    expect(listBlock.items).toEqual(["☑ Inspect current output", "▶ Patch summary format", "☐ Run tests"]);
  });
});

describe("tool start render payload builder", () => {
  test("uses file target summary for apply_patch request", () => {
    const payload = createToolStartRenderPayload("apply_patch", {
      patch: [
        "*** Begin Patch",
        "*** Update File: src/a.ts",
        "@@",
        "-const a = 1;",
        "+const a = 2;",
        "*** End Patch",
      ].join("\n"),
    });

    expect(payload?.inputSummary).toBe("src/a.ts");
  });

  test("uses typed summary for update_knowledge request", () => {
    const payload = createToolStartRenderPayload("update_knowledge", {
      action: "upsert",
      type: "pattern",
      content: "Prefer concise answers",
    });
    expect(payload?.inputSummary).toBe("pattern: Prefer concise answers");
  });

  test("uses command summary for bash request", () => {
    const payload = createToolStartRenderPayload("bash", {
      command: "pwd",
      description: "Print working directory",
    });
    expect(payload?.inputSummary).toBe("pwd");
  });
});

describe("tool end render payload builder", () => {
  test("creates read error payload with file input summary", () => {
    const payload = createToolEndRenderPayloadFromInput({
      toolName: "read",
      input: { file_path: "README.md" },
      output: "Error: ENOENT",
      isError: true,
    });

    expect(payload).toBeDefined();
    expect(payload?.inputSummary).toBe("README.md");
    expect(payload?.outputSummary).toBe("Read failed");
  });

  test("creates write error payload with file input summary", () => {
    const payload = createToolEndRenderPayloadFromInput({
      toolName: "write",
      input: { file_path: "src/app.ts" },
      output: "Error: Permission denied",
      isError: true,
    });

    expect(payload).toBeDefined();
    expect(payload?.inputSummary).toBe("src/app.ts");
    expect(payload?.outputSummary).toBe("Write failed");
  });

  test("creates apply_patch error payload from patch input", () => {
    const payload = createToolEndRenderPayloadFromInput({
      toolName: "apply_patch",
      input: {
        patch: [
          "*** Begin Patch",
          "*** Update File: src/a.ts",
          "@@",
          "-const a = 1;",
          "+const a = 2;",
          "*** End Patch",
        ].join("\n"),
      },
      output: "Patch failed: context mismatch",
      isError: true,
    });

    expect(payload).toBeDefined();
    expect(payload?.inputSummary).toBe("src/a.ts");
    expect(payload?.outputSummary).toBe("Patch failed");
  });
});
