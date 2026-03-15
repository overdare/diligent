// @summary Tests for extracted dialog orchestration over inline prompts
import { describe, expect, test } from "bun:test";
import { AppDialogs } from "../src/tui/app-dialogs";
import { AppRuntimeState } from "../src/tui/app-runtime-state";

describe("AppDialogs", () => {
  test("confirm mounts an inline prompt", async () => {
    const calls: unknown[] = [];
    const dialogs = new AppDialogs({
      renderer: {
        requestRender: () => {},
      } as never,
      runtime: new AppRuntimeState("default", "medium"),
      setActiveInlineQuestion: (component) => {
        calls.push(component);
        if (component) {
          component.handleInput("y");
        }
      },
      restoreFocus: () => {},
    });

    const promise = dialogs.confirm({ title: "Confirm", message: "Proceed?" });
    await expect(promise).resolves.toBe(true);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[0]).not.toBeNull();
    expect(calls.at(-1)).toBeNull();
  });
});
