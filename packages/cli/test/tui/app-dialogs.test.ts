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

describe("AppDialogs.handleApprove details", () => {
  async function renderApproval(details: Record<string, unknown> | undefined): Promise<string> {
    const view: { current: (Component & { handleInput(data: string): void }) | null } = { current: null };
    const dialogs = new AppDialogs({
      renderer: { requestRender: () => {} } as never,
      runtime: new AppRuntimeState("default", "medium"),
      setActiveInlineQuestion: (component) => {
        view.current = component;
      },
      restoreFocus: () => {},
    });
    const approval = dialogs.handleApprove({
      toolName: "probe_tool",
      permission: "execute",
      description: "DESCRIPTION_TEXT",
      details,
    } as never);
    const header = view.current?.render(120)[0] ?? "";
    view.current?.handleInput("a");
    expect(await approval).toBe("always");
    expect(view.current).toBeNull();
    return header;
  }

  test("prefers command over file paths", async () => {
    const header = await renderApproval({ command: "CMD_TEXT", file_path: "FILE_TEXT", path: "PATH_TEXT" });
    expect(header).toContain("CMD_TEXT");
    expect(header).not.toContain("FILE_TEXT");
    expect(header).not.toContain("DESCRIPTION_TEXT");
  });

  test("stringifies a non-string truthy command", async () => {
    const header = await renderApproval({ command: 4242, path: "PATH_TEXT" });
    expect(header).toContain("4242");
    expect(header).not.toContain("PATH_TEXT");
  });

  test("falls through an empty command to file_path before path", async () => {
    const header = await renderApproval({ command: "", file_path: "FILE_TEXT", path: "PATH_TEXT" });
    expect(header).toContain("FILE_TEXT");
    expect(header).not.toContain("PATH_TEXT");
    expect(header).not.toContain("DESCRIPTION_TEXT");
  });

  test("uses path when command is 0 and file_path is absent", async () => {
    const header = await renderApproval({ command: 0, path: "PATH_TEXT" });
    expect(header).toContain("PATH_TEXT");
    expect(header).not.toContain("DESCRIPTION_TEXT");
  });

  test("uses path when file_path is null", async () => {
    const header = await renderApproval({ file_path: null, path: "PATH_TEXT" });
    expect(header).toContain("PATH_TEXT");
  });

  test("empty file_path shadows path and falls back to description", async () => {
    const header = await renderApproval({ file_path: "", path: "PATH_TEXT" });
    expect(header).toContain("DESCRIPTION_TEXT");
    expect(header).not.toContain("PATH_TEXT");
  });

  test("falls back to description without details", async () => {
    const header = await renderApproval(undefined);
    expect(header).toContain("DESCRIPTION_TEXT");
  });

  test("falls back to description when details carry no known keys", async () => {
    const header = await renderApproval({ other: "OTHER_TEXT" });
    expect(header).toContain("DESCRIPTION_TEXT");
    expect(header).not.toContain("OTHER_TEXT");
  });
});
