// @summary Tests for the line ranges a write changed, used to attribute diagnostics to edited lines
import { describe, expect, test } from "bun:test";
import { changedLineRanges } from "../../../src/tools/lsp/changed-lines";

const lines = (...values: string[]) => `${values.join("\n")}\n`;

describe("changedLineRanges", () => {
  test("equal content changes nothing", () => {
    expect(changedLineRanges(lines("a", "b"), lines("a", "b"))).toEqual([]);
  });

  test("a replaced line marks only that line", () => {
    expect(changedLineRanges(lines("a", "b", "c"), lines("a", "B", "c"))).toEqual([{ start: 2, end: 2 }]);
  });

  test("separate edits stay separate ranges and inserted lines extend their range", () => {
    const before = lines("a", "b", "c", "d", "e", "f");
    const after = lines("A", "b", "c", "d", "E1", "E2", "f");
    expect(changedLineRanges(before, after)).toEqual([
      { start: 1, end: 1 },
      { start: 5, end: 6 },
    ]);
  });

  test("a pure deletion marks the lines on both sides of the removed text", () => {
    expect(changedLineRanges(lines("a", "b", "c", "d"), lines("a", "d"))).toEqual([{ start: 1, end: 2 }]);
  });

  test("content written over an empty file marks every written line", () => {
    expect(changedLineRanges("", lines("a", "b"))).toEqual([{ start: 1, end: 2 }]);
  });
});
