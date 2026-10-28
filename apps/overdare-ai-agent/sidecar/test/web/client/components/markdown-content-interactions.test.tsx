// @summary DOM interaction tests for Markdown code-block copy feedback
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import hljs from "highlight.js/lib/core";

GlobalRegistrator.register({ url: "http://localhost:5174/" });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { afterAll, expect, test } from "bun:test";
import type { FileReadResponse } from "@diligent/protocol";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { MarkdownContent } from "../../../../src/web/client/components/MarkdownContent";

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  void GlobalRegistrator.unregister();
});

test("generated Markdown images have collapsible thumbnails and use the shared image viewer", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(MarkdownContent, {
          text: "![Landscape](/Volumes/world/.overdare/images/generated/photo.png)",
        }),
      ),
    );
    const thumbnail = container.querySelector<HTMLButtonElement>("[data-image-open]");
    expect(thumbnail).not.toBeNull();
    expect(container.textContent).toContain("1 image");
    await act(async () => thumbnail?.click());
    const dialog = document.querySelector('[role="dialog"][aria-label="Image preview"]');
    expect(dialog?.querySelector("img")?.getAttribute("src")).toBe("/_diligent/image/generated/photo.png");
    expect(Boolean(dialog?.querySelector("a[download]"))).toBe(false);
    await act(async () => dialog?.querySelector<HTMLButtonElement>('[aria-label="Close image preview"]')?.click());
    expect(document.querySelector('[role="dialog"][aria-label="Image preview"]')).toBeNull();
    const toggle = container.querySelector<HTMLButtonElement>("[data-image-toggle]");
    await act(async () => toggle?.click());
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(thumbnail?.hidden).toBe(true);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test("code-block copy button copies raw code and shows a check state for one second", async () => {
  let copiedText = "";
  Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
  Object.defineProperty(navigator, "clipboard", {
    value: {
      writeText: async (text: string) => {
        copiedText = text;
      },
    },
    configurable: true,
  });

  const rootElement = document.createElement("div");
  document.body.appendChild(rootElement);
  const root = createRoot(rootElement);

  await act(async () => {
    root.render(createElement(MarkdownContent, { text: "```ts\nconst value = 1;\n```" }));
  });

  const copyButton = rootElement.querySelector<HTMLButtonElement>("[data-code-copy-button]");
  expect(copyButton).not.toBeNull();
  expect(copyButton?.dataset.copied).toBe("false");
  expect(copyButton?.getAttribute("aria-label")).toBe("Copy ts code");

  await act(async () => {
    copyButton?.click();
  });

  expect(copiedText).toBe("const value = 1;");
  expect(copyButton?.dataset.copied).toBe("true");
  expect(copyButton?.getAttribute("aria-label")).toBe("Copied");

  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1_050));
  });

  expect(copyButton?.dataset.copied).toBe("false");
  expect(copyButton?.getAttribute("aria-label")).toBe("Copy ts code");

  await act(async () => {
    root.unmount();
  });
  rootElement.remove();
});

test("does not re-highlight unchanged markdown when a parent re-renders", async () => {
  const originalHighlight = hljs.highlight;
  let highlightCalls = 0;
  let rerenderParent: (() => void) | undefined;

  Object.defineProperty(hljs, "highlight", {
    configurable: true,
    value: (...args: unknown[]) => {
      highlightCalls += 1;
      return Reflect.apply(originalHighlight, hljs, args);
    },
  });

  function Parent() {
    const [, setVersion] = useState(0);
    rerenderParent = () => setVersion((version) => version + 1);

    return createElement(MarkdownContent, {
      text: "```ts\nconst stable = true;\n```",
    });
  }

  const rootElement = document.createElement("div");
  document.body.appendChild(rootElement);
  const root = createRoot(rootElement);

  try {
    await act(async () => {
      root.render(createElement(Parent));
    });
    expect(highlightCalls).toBe(1);

    await act(async () => {
      rerenderParent?.();
    });
    expect(highlightCalls).toBe(1);
  } finally {
    Object.defineProperty(hljs, "highlight", {
      configurable: true,
      value: originalHighlight,
    });

    await act(async () => {
      root.unmount();
    });
    rootElement.remove();
  }
});

for (const path of ["thumbnails/shot.png", "/repo/thumbnails/shot.png", "C:/repo/thumbnails/shot.png"]) {
  test(`project image ${path} loads server bytes and enlarges without navigating to a disk path`, async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const requests: unknown[] = [];
    const loadFile = async (...args: unknown[]): Promise<FileReadResponse> => {
      requests.push(args);
      return {
        kind: "image",
        path: "/repo/thumbnails/shot.png",
        name: "shot.png",
        mediaType: "image/png",
        dataBase64: "cGl4ZWxz",
      };
    };
    try {
      await act(async () =>
        root.render(
          createElement(MarkdownContent, {
            text: `![Thumbnail](<${path}>)`,
            options: { threadId: "origin-thread" },
            loadFile,
          }),
        ),
      );
      expect(requests).toEqual([[path, "origin-thread"]]);
      expect(container.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,cGl4ZWxz");
      const button = container.querySelector<HTMLButtonElement>("[data-image-open]")!;
      button.focus();
      await act(async () => button.click());
      const dialog = document.querySelector('[aria-label="Image preview"]')!;
      expect(dialog.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,cGl4ZWxz");
      expect(Boolean(dialog.querySelector("a[download]"))).toBe(false);
      const close = dialog.querySelector<HTMLButtonElement>('button[aria-label="Close image preview"]')!;
      expect(document.activeElement).toBe(close);
      const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
      await act(async () => close.dispatchEvent(tab));
      expect(tab.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(close);
      await act(async () => close.click());
      expect(document.activeElement).toBe(button);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
}

test("project image reads preserve document-relative paths and ignore stale results", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const requests: unknown[] = [];
  let finishFirst: ((file: FileReadResponse) => void) | undefined;
  const loadFile = (path: string, threadId?: string): Promise<FileReadResponse> => {
    requests.push([path, threadId]);
    if (path.endsWith("first.png"))
      return new Promise((resolve) => {
        finishFirst = resolve;
      });
    return Promise.resolve({ kind: "image", path, name: "second.png", mediaType: "image/png", dataBase64: "bmV3" });
  };
  const options = { basePath: "/repo/docs/brief.md", threadId: "origin-thread" };
  try {
    await act(async () =>
      root.render(createElement(MarkdownContent, { text: "![First](first.png)", options, loadFile })),
    );
    expect(container.querySelector("img")?.hasAttribute("src")).toBe(false);
    expect(container.querySelector<HTMLButtonElement>("[data-image-open]")?.disabled).toBe(true);
    await act(async () =>
      root.render(createElement(MarkdownContent, { text: "![Second](second.png)", options, loadFile })),
    );
    await act(async () =>
      finishFirst?.({
        kind: "image",
        path: "/repo/docs/first.png",
        name: "first.png",
        mediaType: "image/png",
        dataBase64: "b2xk",
      }),
    );
    expect(requests).toEqual([
      ["/repo/docs/first.png", "origin-thread"],
      ["/repo/docs/second.png", "origin-thread"],
    ]);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,bmV3");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

for (const failure of ["missing", "non-image"]) {
  test(`project image ${failure} cannot open a broken viewer`, async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const loadFile = async (): Promise<FileReadResponse> => {
      if (failure === "missing") throw new Error("File not found");
      return { kind: "text", path: "/repo/image.png", name: "image.png", content: "not an image" };
    };
    try {
      await act(async () => root.render(createElement(MarkdownContent, { text: "![Thumbnail](image.png)", loadFile })));
      expect(container.textContent).toContain("Image unavailable");
      expect(container.querySelector<HTMLButtonElement>("[data-image-open]")?.disabled).toBe(true);
      expect(container.querySelector("img")).toBeNull();
      expect(document.querySelector('[aria-label="Image preview"]')).toBeNull();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
}
