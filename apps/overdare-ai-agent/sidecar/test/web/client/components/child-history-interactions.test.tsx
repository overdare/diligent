// @summary Child viewers render bounded pages, preserve completed tools, and expose load failures
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({ url: "http://localhost/" });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { afterAll, afterEach, expect, mock, test } from "bun:test";
import type { ThreadHistoryResponse } from "@diligent/protocol";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CollabEventBlock } from "../../../../src/web/client/components/CollabEventBlock";
import type { RenderItem } from "../../../../src/web/client/lib/thread-store";

const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];
afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => root.unmount());
    container.remove();
  }
});
afterAll(() => void GlobalRegistrator.unregister());

async function renderChild(
  id: string,
  loadChildThread: (id: string, cursor?: string) => Promise<ThreadHistoryResponse>,
) {
  const item: Extract<RenderItem, { kind: "collab" }> = {
    id,
    kind: "collab",
    eventType: "spawn",
    childThreadId: id,
    status: "completed",
    childTools: [],
    timestamp: 1,
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => root.render(createElement(CollabEventBlock, { item, loadChildThread, initialOpen: true })));
  return container;
}

function assistant(id: string, text: string): ThreadHistoryResponse["items"][number] {
  return {
    type: "agentMessage",
    itemId: id,
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      timestamp: 1,
      model: { provider: "openai", modelId: "retired-model" },
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      stopReason: "end_turn",
    },
  };
}

test("a child transcript keeps recent content when loading an earlier cursor", async () => {
  const load = mock(
    async (_id: string, cursor?: string): Promise<ThreadHistoryResponse> =>
      cursor
        ? { cwd: "/project", items: [assistant("earlier", "Earlier child response")] }
        : { cwd: "/project", items: [assistant("recent", "Recent child response")], nextCursor: "older" },
  );
  const container = await renderChild("child-paging", load);
  expect(container.textContent).toContain("Recent child response");
  const earlier = Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.includes("Load earlier"),
  )!;
  await act(async () => earlier.click());
  expect(load).toHaveBeenLastCalledWith("child-paging", "older");
  expect(container.textContent).toContain("Earlier child response");
  expect(container.textContent).toContain("Recent child response");
  expect(
    Array.from(container.querySelectorAll("button")).some((button) => button.textContent?.includes("Load earlier")),
  ).toBe(false);
});

test("a child page error is visible and does not automatically retry forever", async () => {
  const load = mock(async (): Promise<ThreadHistoryResponse> => {
    throw new Error("Child history unavailable");
  });
  const container = await renderChild("child-error", load);
  expect(container.textContent).toContain("Child history unavailable");
  expect(load).toHaveBeenCalledTimes(1);
  const retry = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Retry")!;
  await act(async () => retry.click());
  expect(load).toHaveBeenCalledTimes(2);
});
