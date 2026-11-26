// @summary Tests prompt renderer output structure around input editor spacing
import { describe, expect, test } from "bun:test";
import { renderPromptEditor } from "../../../src/tui/components/prompt-render";
import { PromptStore } from "../../../src/tui/components/prompt-store";

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

describe("renderPromptEditor", () => {
  test("does not prepend a blank spacer line when focused", () => {
    const store = new PromptStore({});
    store.focused = true;
    store.setText("hello");

    const lines = renderPromptEditor(store, 40).map(stripAnsi);

    expect(lines[0]).not.toBe("");
    expect(lines[0]).toContain("─");
  });

  test("does not prepend a blank spacer line when unfocused", () => {
    const store = new PromptStore({});
    store.focused = false;
    store.setText("hello");

    const lines = renderPromptEditor(store, 40).map(stripAnsi);

    expect(lines[0]).not.toBe("");
    expect(lines[0]).toContain("─");
  });

  test("completion popup hides, truncates, or shows descriptions by available width", () => {
    const store = new PromptStore({});
    store.focused = true;
    store.completionVisible = true;
    store.completionItems = [
      { name: "abc", description: "abcdef" },
      { name: "xyz", description: "abcde" },
    ] as never;
    store.completionIndex = 0;
    store.completionScrollOffset = 0;

    const popupAt = (width: number) => renderPromptEditor(store, width).map(stripAnsi).slice(-2);

    expect(popupAt(14)).toEqual([" ▸ abc   ", "   xyz   "]);
    expect(popupAt(15)).toEqual([" ▸ abc   abcd…", "   xyz   abcde"]);
    expect(popupAt(41)).toEqual([" ▸ abc   abcdef", "   xyz   abcde"]);
  });
});
