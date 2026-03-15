// @summary Tests for TUI structured tool payload block rendering
import { describe, expect, test } from "bun:test";
import type { ToolRenderPayload } from "@diligent/protocol";
import { renderToolPayload } from "../src/tui/render-blocks";

describe("renderToolPayload", () => {
  test("renders file block header and content", () => {
    const payload: ToolRenderPayload = {
      version: 1,
      blocks: [
        {
          type: "file",
          filePath: "packages/cli/src/tui/chat-view.ts",
          content: "line1\nline2",
          offset: 10,
          limit: 2,
        },
      ],
    };

    const lines = renderToolPayload(payload);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((line) => line.includes("packages/cli/src/tui/chat-view.ts"))).toBe(true);
    expect(lines.some((line) => line.includes("L10-11"))).toBe(true);
    expect(lines.some((line) => line.includes("line1"))).toBe(true);
    expect(lines.some((line) => line.includes("line2"))).toBe(true);
  });

  test("renders command block with command and output", () => {
    const payload: ToolRenderPayload = {
      version: 1,
      blocks: [
        {
          type: "command",
          command: "echo hello",
          output: "hello",
          isError: false,
        },
      ],
    };

    const lines = renderToolPayload(payload);
    expect(lines[0]?.includes("echo hello")).toBe(true);
    expect(lines.some((line) => line.includes("hello"))).toBe(true);
  });

  test("renders diff block action/path and hunk lines", () => {
    const payload: ToolRenderPayload = {
      version: 1,
      blocks: [
        {
          type: "diff",
          files: [
            {
              filePath: "src/a.ts",
              action: "Update",
              hunks: [{ oldString: "const a = 1;", newString: "const a = 2;" }],
            },
          ],
          output: "Updated src/a.ts",
        },
      ],
    };

    const lines = renderToolPayload(payload);
    expect(lines.some((line) => line.includes("src/a.ts"))).toBe(true);
    expect(lines.some((line) => line.includes("[Update]"))).toBe(true);
    expect(lines.some((line) => line.includes("- const a = 1;"))).toBe(true);
    expect(lines.some((line) => line.includes("+ const a = 2;"))).toBe(true);
    expect(lines.some((line) => line.includes("Updated src/a.ts"))).toBe(true);
  });

  test("renders mixed blocks without dropping known block types", () => {
    const payload: ToolRenderPayload = {
      version: 1,
      blocks: [
        { type: "summary", text: "done", tone: "success" },
        { type: "file", filePath: "x.ts", content: "x" },
        { type: "command", command: "pwd", output: "/tmp" },
      ],
    };

    const lines = renderToolPayload(payload);
    expect(lines.some((line) => line.includes("done"))).toBe(true);
    expect(lines.some((line) => line.includes("x.ts"))).toBe(true);
    expect(lines.some((line) => line.includes("pwd"))).toBe(true);
    expect(lines.some((line) => line.includes("/tmp"))).toBe(true);
  });
});
