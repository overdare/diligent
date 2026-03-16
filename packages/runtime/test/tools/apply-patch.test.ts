// @summary Tests for codex-style apply_patch tool semantics
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@diligent/core/tool/types";
import { createApplyPatchTool } from "@diligent/runtime/tools";

function makeCtx(): ToolContext {
  return {
    toolCallId: "tc_test",
    signal: new AbortController().signal,
    abort: () => {},
  };
}

describe("apply_patch tool", () => {
  let tmpDir: string;
  let tool: ReturnType<typeof createApplyPatchTool>;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "apply-patch-test-"));
    tool = createApplyPatchTool(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("applies add/update/delete together", async () => {
    const modify = join(tmpDir, "modify.txt");
    const removePath = join(tmpDir, "remove.txt");
    await writeFile(modify, "line1\nline2\n", "utf-8");
    await writeFile(removePath, "obsolete\n", "utf-8");

    const patch = [
      "*** Begin Patch",
      "*** Add File: nested/new.txt",
      "+created",
      "*** Update File: modify.txt",
      "@@",
      "-line2",
      "+changed",
      "*** Delete File: remove.txt",
      "*** End Patch",
    ].join("\n");

    const result = await tool.execute({ patch }, makeCtx());

    expect(result.render?.version).toBe(2);
    expect(result.render?.blocks[0]).toMatchObject({ type: "diff" });
    expect(result.output).toContain("Success. Updated the following files:");
    expect(result.output).toContain("A nested/new.txt");
    expect(result.output).toContain("M modify.txt");
    expect(result.output).toContain("D remove.txt");
    expect(await readFile(join(tmpDir, "nested/new.txt"), "utf-8")).toBe("created\n");
    expect(await readFile(modify, "utf-8")).toBe("line1\nchanged\n");
    await expect(readFile(removePath, "utf-8")).rejects.toThrow();
  });

  test("supports update move with strict context", async () => {
    const from = join(tmpDir, "old/name.txt");
    await mkdir(join(tmpDir, "old"), { recursive: true });
    await writeFile(from, "old content\n", "utf-8");

    const patch = [
      "*** Begin Patch",
      "*** Update File: old/name.txt",
      "*** Move to: renamed/dir/name.txt",
      "@@",
      "-old content",
      "+new content",
      "*** End Patch",
    ].join("\n");

    const result = await tool.execute({ patch }, makeCtx());
    expect(result.output).toContain("M old/name.txt -> renamed/dir/name.txt");
    await expect(readFile(from, "utf-8")).rejects.toThrow();
    expect(await readFile(join(tmpDir, "renamed/dir/name.txt"), "utf-8")).toBe("new content\n");
  });

  test("rejects malformed patch envelope", async () => {
    const result = await tool.execute({ patch: "*** Begin Patch\n*** Add File: x.txt\n+hi" }, makeCtx());
    expect(result.render?.blocks[0]).toMatchObject({ type: "text", title: "Input" });
    expect(result.metadata?.error).toBe(true);
    expect(result.output).toContain("apply_patch verification failed");
  });

  test("rejects empty patch", async () => {
    const result = await tool.execute({ patch: "*** Begin Patch\n*** End Patch" }, makeCtx());
    expect(result.metadata?.error).toBe(true);
    expect(result.output).toContain("patch rejected: empty patch");
  });

  test("rejects missing context in update", async () => {
    const target = join(tmpDir, "target.txt");
    await writeFile(target, "a\nb\nc\n", "utf-8");

    const patch = [
      "*** Begin Patch",
      "*** Update File: target.txt",
      "@@",
      "-missing",
      "+changed",
      "*** End Patch",
    ].join("\n");

    const result = await tool.execute({ patch }, makeCtx());
    expect(result.metadata?.error).toBe(true);
    expect(result.output).toContain("Failed to find expected lines");
    expect(await readFile(target, "utf-8")).toBe("a\nb\nc\n");
  });

  test("rejects absolute paths in patch headers", async () => {
    const target = join(tmpDir, "target.txt");
    await writeFile(target, "a\n", "utf-8");

    const patch = ["*** Begin Patch", `*** Update File: ${target}`, "@@", "-a", "+b", "*** End Patch"].join("\n");

    const result = await tool.execute({ patch }, makeCtx());
    expect(result.metadata?.error).toBe(true);
    expect(result.output).toContain("Patch paths must be relative");
  });
});
