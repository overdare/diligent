import { describe, expect, test } from "bun:test";
import { applyEdit } from "../../../../src/tools/studiorpc/tools/script-edit-tool";

describe("script edit newline matching", () => {
  test("matches partial lines across different line endings without consuming surrounding text", () => {
    const content = "before\r\nlocal value = 1\r\nend\r\n\r\nlocal function Next(arg)\r\nafter";
    expect(
      applyEdit(content, {
        old_string: "value = 1\nend\n\nlocal function Next",
        new_string: "value = 2\nend\n\nlocal function Next",
        replace_all: false,
      }).result,
    ).toBe("before\r\nlocal value = 2\nend\n\nlocal function Next(arg)\r\nafter");
  });

  test("rejects ambiguous newline-equivalent matches", () => {
    expect(() =>
      applyEdit("x\r\ny!\nx\ny!", {
        old_string: "x\ny",
        new_string: "z",
        replace_all: false,
      }),
    ).toThrow("old_string is not unique");
  });
});
