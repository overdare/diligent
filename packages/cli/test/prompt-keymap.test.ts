// @summary Tests for prompt store and keymap transitions without renderer coupling
import { describe, expect, mock, test } from "bun:test";
import { handlePromptInput } from "../src/tui/components/prompt-keymap";
import { PromptStore } from "../src/tui/components/prompt-store";

function create() {
  const store = new PromptStore({});
  const onSubmit = mock((_text: string) => {});
  const requestRender = mock(() => {});
  return {
    store,
    onSubmit,
    requestRender,
    options: {
      onSubmit,
      requestRender,
      onComplete: (partial: string) => (partial.startsWith("he") ? ["help"] : []),
      onCompleteDetailed: (partial: string) =>
        partial.startsWith("he") ? [{ name: "help", description: "Show commands" }] : [],
    },
  };
}

describe("handlePromptInput", () => {
  test("submits trimmed prompt text and resets store", () => {
    const { store, options, onSubmit } = create();
    store.text = " hello ";
    store.cursorPos = store.text.length;

    expect(handlePromptInput(store, "\r", options)).toBe(true);
    expect(onSubmit).toHaveBeenCalledWith("hello");
    expect(store.text).toBe("");
  });

  test("tab accepts slash completion selection", () => {
    const { store, options } = create();
    store.text = "/he";
    store.cursorPos = store.text.length;
    store.updateCompletion(options.onCompleteDetailed);

    expect(handlePromptInput(store, "\t", options)).toBe(true);
    expect(store.text).toBe("/help ");
  });
});
