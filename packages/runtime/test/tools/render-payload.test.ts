// @summary Tests for ToolRenderPayload path relativization in glob/grep outputs

import { describe, expect, test } from "bun:test";
import { deriveToolRenderPayload } from "../../src/tools/render-payload";

describe("deriveToolRenderPayload path formatting", () => {
  test("glob list paths become relative when under absolute search path", () => {
    const payload = deriveToolRenderPayload(
      "glob",
      { pattern: "**/*.ts", path: "/Users/me/project" },
      "/Users/me/project/src/main.ts\n/Users/me/project/package.json\n/opt/other/file.ts",
      false,
    );

    expect(payload?.blocks[0]?.type).toBe("list");
    const listBlock = payload?.blocks[0];
    if (!listBlock || listBlock.type !== "list") throw new Error("Expected list block");

    expect(listBlock.items).toEqual(["src/main.ts", "package.json", "/opt/other/file.ts"]);
  });

  test("grep output path becomes relative when searching a directory", () => {
    const payload = deriveToolRenderPayload(
      "grep",
      { pattern: "TODO", path: "/Users/me/project" },
      "/Users/me/project/src/main.ts:12:// TODO",
      false,
    );

    expect(payload?.blocks[0]?.type).toBe("list");
    const listBlock = payload?.blocks[0];
    if (!listBlock || listBlock.type !== "list") throw new Error("Expected list block");

    expect(listBlock.items).toEqual(["src/main.ts:12:// TODO"]);
  });

  test("grep output path becomes relative when searching a single file", () => {
    const payload = deriveToolRenderPayload(
      "grep",
      { pattern: "TODO", path: "/Users/me/project/src/main.ts" },
      "/Users/me/project/src/main.ts:1:// TODO",
      false,
    );

    expect(payload?.blocks[0]?.type).toBe("list");
    const listBlock = payload?.blocks[0];
    if (!listBlock || listBlock.type !== "list") throw new Error("Expected list block");

    expect(listBlock.items).toEqual(["main.ts:1:// TODO"]);
  });
});
