// @summary Tests steering queue indicator rendering in the TUI input editor
import { describe, expect, test } from "bun:test";
import { InputEditor } from "../src/tui/components/input-editor";

function stripAnsi(input: string): string {
  let out = "";
  let i = 0;

  while (i < input.length) {
    if (input.charCodeAt(i) === 27 && input[i + 1] === "[") {
      i += 2;
      while (i < input.length) {
        const ch = input[i];
        if ((ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z")) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    out += input[i];
    i++;
  }

  return out;
}

describe("InputEditor steering queue", () => {
  test("renders steering indicator above prompt when pending steers exist", () => {
    const editor = new InputEditor({ prompt: "❯ " }, () => {});
    editor.focused = true;

    editor.setPendingSteers(["change approach"]);
    const lines = editor.render(80).map(stripAnsi);

    expect(lines.some((line) => line.includes("⚑ steering (1) change approach"))).toBe(true);
  });

  test("does not render steering indicator when queue is empty", () => {
    const editor = new InputEditor({ prompt: "❯ " }, () => {});
    editor.focused = true;

    editor.setPendingSteers([]);
    const lines = editor.render(80).map(stripAnsi);

    expect(lines.some((line) => line.includes("⚑ steering"))).toBe(false);
  });
});
