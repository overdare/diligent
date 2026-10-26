// @summary File preview displays server-owned content and loading/errors without entering a conversation
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({ url: "http://localhost:5174/_diligent/file?path=README.md" });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { afterAll, expect, test } from "bun:test";
import type { FileReadResponse } from "@diligent/protocol";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { FilePreview } from "../../../../src/web/client/components/FilePreview";

afterAll(() => {
  void GlobalRegistrator.unregister();
});

async function show(load: (path: string, threadId?: string) => Promise<FileReadResponse>) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(createElement(FilePreview, { path: "docs/README.md", threadId: "thread-1", load })),
  );
  return {
    container,
    close: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

test("renders Markdown content, escapes raw HTML, and rewrites nested file links", async () => {
  const requests: unknown[] = [];
  const view = await show(async (...args) => {
    requests.push(args);
    return {
      kind: "markdown",
      path: "/repo/docs/README.md",
      name: "README.md",
      content:
        "# Preview\n\n**Actual file**\n\n[Next](next.md)\n\n<script>alert(1)</script>\n\n[Unsafe](javascript:alert(1))",
    };
  });
  try {
    expect(requests).toEqual([["docs/README.md", "thread-1"]]);
    expect(view.container.querySelector("h1")?.textContent).toBe("Preview");
    expect(view.container.querySelector("strong")?.textContent).toBe("Actual file");
    expect(view.container.querySelector("script")).toBeNull();
    const next = [...view.container.querySelectorAll("a")].find((a) => a.textContent === "Next");
    const href = new URL(next?.href ?? "");
    expect(href.pathname).toBe("/_diligent/file");
    expect(href.searchParams.get("path")).toBe("/repo/docs/next.md");
    expect(href.searchParams.get("threadId")).toBe("thread-1");
    expect(view.container.querySelector('a[href^="javascript:"]')).toBeNull();
  } finally {
    await view.close();
  }
});

test("shows the exact server image bytes instead of navigating to its disk path", async () => {
  const view = await show(async () => ({
    kind: "image",
    path: "/repo/shot.png",
    name: "shot.png",
    mediaType: "image/png",
    dataBase64: "aW1hZ2U=",
  }));
  try {
    expect(view.container.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,aW1hZ2U=");
    expect(view.container.querySelector("img")?.alt).toBe("shot.png");
  } finally {
    await view.close();
  }
});

test("renders code as text and offers binary content for download", async () => {
  const text = await show(async () => ({
    kind: "text",
    path: "/repo/a.ts",
    name: "a.ts",
    content: "<script>literal</script>",
  }));
  try {
    expect(text.container.querySelector("pre")?.textContent).toBe("<script>literal</script>");
    expect(text.container.querySelector("script")).toBeNull();
  } finally {
    await text.close();
  }
  const binary = await show(async () => ({
    kind: "binary",
    path: "/repo/a.bin",
    name: "a.bin",
    mediaType: "application/octet-stream",
    dataBase64: "AP8B",
  }));
  try {
    expect(binary.container.querySelector("a[download]")?.getAttribute("download")).toBe("a.bin");
    expect(binary.container.querySelector("a[download]")?.getAttribute("href")).toBe(
      "data:application/octet-stream;base64,AP8B",
    );
  } finally {
    await binary.close();
  }
});

test("directory entries preserve literal special characters and thread context", async () => {
  const view = await show(async () => ({
    kind: "directory",
    path: "/repo/docs",
    name: "docs",
    entries: [{ name: "100% #?.md", path: "/repo/docs/100% #?.md", isDirectory: false }],
  }));
  try {
    const entry = [...view.container.querySelectorAll("a")].find((a) => a.textContent?.includes("100% #?.md"));
    const href = new URL(entry?.href ?? "");
    expect(href.searchParams.get("path")).toBe("/repo/docs/100% #?.md");
    expect(href.searchParams.get("threadId")).toBe("thread-1");
  } finally {
    await view.close();
  }
});

test("shows loading until the server resolves and exposes read errors", async () => {
  let reject: ((error: Error) => void) | undefined;
  const view = await show(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  try {
    expect(view.container.textContent).toContain("Loading file");
    await act(async () => reject?.(new Error("File not found on the agent server computer.")));
    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain("File not found");
  } finally {
    await view.close();
  }
});

test("ignores stale responses when navigating to another file", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let finishFirst: ((file: FileReadResponse) => void) | undefined;
  const load = (path: string) =>
    path === "first.md"
      ? new Promise<FileReadResponse>((resolve) => {
          finishFirst = resolve;
        })
      : Promise.resolve<FileReadResponse>({
          kind: "text",
          name: "second.txt",
          path: "/repo/second.txt",
          content: "Current content",
        });
  try {
    await act(async () => root.render(createElement(FilePreview, { path: "first.md", load })));
    await act(async () => root.render(createElement(FilePreview, { path: "second.txt", load })));
    await act(async () =>
      finishFirst?.({ kind: "text", name: "first.md", path: "/repo/first.md", content: "Stale content" }),
    );
    expect(container.textContent).toContain("Current content");
    expect(container.textContent).not.toContain("Stale content");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
