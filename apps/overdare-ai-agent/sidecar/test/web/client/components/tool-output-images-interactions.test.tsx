// @summary Tool image arrival, collapse, and failed-preview interaction regressions
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { afterAll, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ToolBlock } from "../../../../src/web/client/components/ToolBlock";
import type { RenderItem } from "../../../../src/web/client/lib/thread-store";

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  void GlobalRegistrator.unregister();
});

test("live image results open automatically, remain collapsible, and explain failed previews", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const item: Extract<RenderItem, { kind: "tool" }> = {
    id: "image",
    kind: "tool",
    toolCallId: "image",
    toolName: "read_image",
    inputText: "",
    outputText: "Loaded image pixel.png",
    isError: false,
    status: "streaming",
    timestamp: 1,
    startedAt: 1,
  };
  try {
    await act(async () => {
      root.render(<ToolBlock item={item} />);
    });
    expect(container.querySelector("img")).toBeNull();
    const completed = {
      ...item,
      status: "done" as const,
      outputImages: [
        {
          type: "image" as const,
          source: { type: "base64" as const, media_type: "image/png" as const, data: "aGVsbG8=" },
        },
      ],
    };
    await act(async () => {
      root.render(<ToolBlock item={completed} />);
    });
    expect(container.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,aGVsbG8=");
    await act(async () => {
      container.querySelector("img")!.dispatchEvent(new Event("error"));
    });
    expect(container.textContent).toContain("Image unavailable");
    expect(container.textContent).toContain("Loaded image pixel.png");
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button[aria-expanded]")!.click();
    });
    expect(container.querySelector("section")).toBeNull();
    await act(async () => {
      root.render(<ToolBlock item={{ ...completed }} />);
    });
    expect(container.querySelector("section")).toBeNull();
  } finally {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
});
