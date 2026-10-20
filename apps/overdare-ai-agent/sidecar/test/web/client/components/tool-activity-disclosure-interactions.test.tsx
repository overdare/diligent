// @summary Tool activity rows keep the user's open state while calls stream in and expose per-call timing
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { afterAll, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MessageListRowContent } from "../../../../src/web/client/components/MessageList/MessageListRowContent";
import { buildGroupedRows } from "../../../../src/web/client/components/MessageList/row-builder";
import type { RenderItem } from "../../../../src/web/client/lib/thread-store";

type ToolItem = Extract<RenderItem, { kind: "tool" }>;

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  void GlobalRegistrator.unregister();
});

function tool(id: string, overrides: Partial<ToolItem> = {}): ToolItem {
  return {
    id,
    kind: "tool",
    toolName: "bash",
    inputText: `echo ${id}`,
    outputText: `${id} output`,
    isError: false,
    status: "done",
    timestamp: 1,
    toolCallId: `call-${id}`,
    startedAt: 1_000,
    durationMs: 10,
    render: { inputSummary: `echo ${id}`, blocks: [] },
    ...overrides,
  };
}

/** Renders rows keyed exactly as the virtualized list keys them (`computeItemKey` = `row.key`). */
function Transcript({ items }: { items: RenderItem[] }) {
  return (
    <>
      {buildGroupedRows(items).map((row) => (
        <div key={row.key}>
          <MessageListRowContent row={row} />
        </div>
      ))}
    </>
  );
}

async function mount(items: RenderItem[]): Promise<{ container: HTMLDivElement; root: Root }> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<Transcript items={items} />));
  return { container, root };
}

async function unmount({ container, root }: { container: HTMLDivElement; root: Root }): Promise<void> {
  await act(async () => root.unmount());
  container.remove();
}

function firstToggle(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>("button[aria-expanded]");
  if (!button) throw new Error("no disclosure toggle rendered");
  return button;
}

test("an opened tool group stays open while later calls stream in", async () => {
  const view = await mount([tool("stream-1"), tool("stream-2")]);
  try {
    await act(async () => firstToggle(view.container).click());
    expect(firstToggle(view.container).getAttribute("aria-expanded")).toBe("true");

    const items = [
      tool("stream-1"),
      tool("stream-2"),
      tool("stream-3", { status: "streaming", durationMs: undefined }),
    ];
    await act(async () => view.root.render(<Transcript items={items} />));

    expect(firstToggle(view.container).getAttribute("aria-expanded")).toBe("true");
    expect(view.container.textContent).toContain("echo stream-3");
  } finally {
    await unmount(view);
  }
});

test("a tool group restores the user's choice after its row remounts", async () => {
  const items = [tool("remount-1"), tool("remount-2")];
  const first = await mount(items);
  await act(async () => firstToggle(first.container).click());
  await unmount(first);

  const second = await mount(items);
  try {
    expect(firstToggle(second.container).getAttribute("aria-expanded")).toBe("true");
    expect(second.container.textContent).toContain("echo remount-2");
  } finally {
    await unmount(second);
  }
});

test("an opened single call stays open once the next call turns it into a group", async () => {
  const view = await mount([tool("single-1")]);
  try {
    await act(async () => firstToggle(view.container).click());
    expect(view.container.textContent).toContain("single-1 output");

    await act(async () => view.root.render(<Transcript items={[tool("single-1"), tool("single-2")]} />));

    expect(firstToggle(view.container).getAttribute("aria-expanded")).toBe("true");
    expect(view.container.textContent).toContain("single-1 output");
  } finally {
    await unmount(view);
  }
});

test("a tool group shows call count, wall-clock span, and sub-second per-call timing", async () => {
  const view = await mount([
    tool("timing-1", { startedAt: 1_000, durationMs: 120 }),
    tool("timing-2", { startedAt: 1_150, durationMs: 300 }),
  ]);
  try {
    const header = firstToggle(view.container).textContent ?? "";
    expect(header).toContain("2 calls");
    // 1_000 → 1_450: the span, not the 300ms longest call nor the 420ms sum.
    expect(header).toContain("450ms");

    await act(async () => firstToggle(view.container).click());
    expect(view.container.textContent).toContain("120ms");
    expect(view.container.textContent).toContain("300ms");
  } finally {
    await unmount(view);
  }
});
