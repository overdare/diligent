// @summary DOM regressions for chat file drops and page-wide file navigation prevention
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { afterAll, afterEach, expect, test } from "bun:test";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ImageLightbox } from "../../../../src/web/client/components/ImageLightbox";
import { useChatFileDrop } from "../../../../src/web/client/lib/use-chat-file-drop";

const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];

afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => root.unmount());
    container.remove();
  }
});

afterAll(() => void GlobalRegistrator.unregister());

function Chat({
  enabled,
  onAddImages,
  showLightbox = false,
}: {
  enabled: boolean;
  onAddImages: (files: File[]) => void;
  showLightbox?: boolean;
}) {
  const onDrop = useChatFileDrop({ enabled, onAddImages });
  return createElement(
    "div",
    { "data-chat": true, onDrop },
    createElement("textarea"),
    showLightbox
      ? createElement(ImageLightbox, {
          image: { src: "data:image/png;base64,eA==", alt: "Preview" },
          onClose: () => {},
        })
      : null,
  );
}

async function renderChat(enabled = true) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  const batches: File[][] = [];
  const onAddImages = (files: File[]) => batches.push(files);
  await act(async () => root.render(createElement(Chat, { enabled, onAddImages })));
  return { container, root, batches, onAddImages };
}

function dragEvent(type: string, dataTransfer: Partial<DataTransfer> | null): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  return event;
}

function fileTransfer(files: File[] = []): Partial<DataTransfer> {
  return { types: ["Files"], files: files as unknown as FileList };
}

test("a drop on a nested chat element passes the complete file batch exactly once", async () => {
  const { container, batches } = await renderChat();
  const files = [
    new File(["png"], "one.png", { type: "image/png" }),
    new File(["jpg"], "two.jpg", { type: "image/jpeg" }),
  ];
  const event = dragEvent("drop", fileTransfer(files));
  await act(async () => container.querySelector("textarea")!.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  expect(batches).toEqual([files]);
});

for (const type of ["dragenter", "dragover"]) {
  test(`${type} cancels file navigation even when the protected file list is empty`, async () => {
    const { batches } = await renderChat();
    const event = dragEvent(type, fileTransfer());
    document.body.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(batches).toEqual([]);
  });
}

test("file items identify a drag when the host omits Files from types", async () => {
  await renderChat();
  const event = dragEvent("dragover", { types: [], items: [{ kind: "file" }] as unknown as DataTransferItemList });
  document.body.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
});

test("file drops outside the chat are canceled without attaching", async () => {
  const { batches } = await renderChat();
  const event = dragEvent("drop", fileTransfer([new File(["png"], "outside.png", { type: "image/png" })]));
  document.body.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(batches).toEqual([]);
});

test("drops on the image lightbox portal do not attach through React event bubbling", async () => {
  const { container, root, batches, onAddImages } = await renderChat();
  await act(async () => root.render(createElement(Chat, { enabled: true, onAddImages, showLightbox: true })));
  const preview = document.querySelector('[aria-label="Image preview"] img')!;
  expect(container.contains(preview)).toBe(false);
  const files = [new File(["png"], "image.png", { type: "image/png" })];
  const event = dragEvent("drop", fileTransfer(files));
  await act(async () => preview.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  expect(batches).toEqual([]);
  await act(async () => root.render(createElement(Chat, { enabled: true, onAddImages })));
  await act(async () => container.querySelector("textarea")!.dispatchEvent(dragEvent("drop", fileTransfer(files))));
  expect(batches).toEqual([files]);
});

test("unsupported and mixed files reach existing attachment validation without silent filtering", async () => {
  const { container, batches } = await renderChat();
  const files = [
    new File(["png"], "image.png", { type: "image/png" }),
    new File(["pdf"], "doc.pdf", { type: "application/pdf" }),
  ];
  const event = dragEvent("drop", fileTransfer(files));
  await act(async () => container.querySelector("textarea")!.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  expect(batches).toEqual([files]);
});

test("disabled attachment intake still cancels file navigation", async () => {
  const { container, batches } = await renderChat(false);
  const event = dragEvent("drop", fileTransfer([new File(["png"], "image.png", { type: "image/png" })]));
  await act(async () => container.querySelector("textarea")!.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  expect(batches).toEqual([]);
});

test("intake follows the latest enabled state and callback after rerender", async () => {
  const { container, root, batches } = await renderChat();
  const nextBatches: File[][] = [];
  await act(async () =>
    root.render(createElement(Chat, { enabled: false, onAddImages: (files) => nextBatches.push(files) })),
  );
  const files = [new File(["png"], "image.png", { type: "image/png" })];
  await act(async () => container.querySelector("textarea")!.dispatchEvent(dragEvent("drop", fileTransfer(files))));
  expect(nextBatches).toEqual([]);
  await act(async () =>
    root.render(createElement(Chat, { enabled: true, onAddImages: (files) => nextBatches.push(files) })),
  );
  await act(async () => container.querySelector("textarea")!.dispatchEvent(dragEvent("drop", fileTransfer(files))));
  expect(nextBatches).toEqual([files]);
  expect(batches).toEqual([]);
});

test("empty file drops do not invoke attachment upload", async () => {
  const { container, batches } = await renderChat();
  const event = dragEvent("drop", fileTransfer());
  await act(async () => container.querySelector("textarea")!.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  expect(batches).toEqual([]);
});

for (const transfer of [
  null,
  { types: ["text/plain"], files: [] as unknown as FileList },
  { types: ["text/uri-list"], files: [] as unknown as FileList },
]) {
  test(`non-file drags remain untouched: ${transfer?.types?.[0] ?? "missing transfer"}`, async () => {
    const { container, batches } = await renderChat();
    for (const type of ["dragenter", "dragover", "drop"]) {
      const event = dragEvent(type, transfer);
      await act(async () => container.querySelector("textarea")!.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(false);
    }
    expect(batches).toEqual([]);
  });
}

test("unmount removes the page-wide file navigation guards", async () => {
  const { root } = await renderChat();
  await act(async () => root.unmount());
  const event = dragEvent("drop", fileTransfer());
  document.body.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
});
