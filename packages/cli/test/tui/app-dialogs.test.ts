// @summary Tests for extracted dialog orchestration over inline prompts
import { describe, expect, test } from "bun:test";
import { AppDialogs } from "../../src/tui/app-dialogs";
import { AppRuntimeState } from "../../src/tui/app-runtime-state";
import type { ListPickerItem } from "../../src/tui/components/list-picker";
import type { Component } from "../../src/tui/framework/types";

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

test("progressive picker exposes batches immediately and ignores pages after cancellation", async () => {
  const runtime = new AppRuntimeState("default", "medium");
  const loading = Promise.withResolvers<void>();
  let update!: (items: ListPickerItem[]) => boolean;
  const view: { current: (Component & { handleInput(data: string): void }) | null } = { current: null };
  const dialogs = new AppDialogs({
    renderer: { requestRender: () => {} } as never,
    runtime,
    setActiveInlineQuestion: (component) => {
      view.current = component;
    },
    restoreFocus: () => {},
  });
  const picking = dialogs.pickInline({
    title: "Sessions",
    items: [],
    load: async (onBatch) => {
      update = onBatch;
      await loading.promise;
    },
  });
  expect(view.current?.render(80).join("\n")).toContain("loading");
  expect(update([{ label: "First session", value: "first" }])).toBe(true);
  expect(view.current?.render(80).join("\n")).toContain("First session");
  view.current?.handleInput("\x1b");
  expect(await picking).toBeNull();
  expect(update([{ label: "Late session", value: "late" }])).toBe(false);
  expect(view.current).toBeNull();
  loading.resolve();
});
