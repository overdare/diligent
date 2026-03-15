// @summary Tests for extracted dialog orchestration over overlays and inline prompts
import { describe, expect, mock, test } from "bun:test";
import { AppDialogs } from "../src/tui/app-dialogs";
import { AppRuntimeState } from "../src/tui/app-runtime-state";
import { OverlayStack } from "../src/tui/framework/overlay";

describe("AppDialogs", () => {
  test("confirm mounts an overlay", async () => {
    const overlayStack = new OverlayStack();
    const setActiveInlineQuestion = mock(() => {});
    const dialogs = new AppDialogs({
      overlayStack,
      renderer: {
        requestRender: () => {},
      } as never,
      runtime: new AppRuntimeState("default", "medium"),
      setActiveInlineQuestion,
      restoreFocus: () => {},
    });

    const promise = dialogs.confirm({ title: "Confirm", message: "Proceed?" });
    expect(overlayStack.hasVisible()).toBe(true);

    const top = overlayStack.getTopComponent();
    top?.handleInput?.("y");
    await expect(promise).resolves.toBe(true);
    expect(setActiveInlineQuestion).not.toHaveBeenCalled();
  });
});
