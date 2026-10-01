// @summary Routes chat file drops to existing image attachments and prevents file navigation across the page
import { type DragEvent, useCallback, useEffect } from "react";

function hasFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return (
    Array.from(dataTransfer.types ?? []).includes("Files") ||
    Array.from(dataTransfer.items ?? []).some((item) => item.kind === "file") ||
    (dataTransfer.files?.length ?? 0) > 0
  );
}

export function useChatFileDrop({
  enabled,
  onAddImages,
}: {
  enabled: boolean;
  onAddImages: (files: File[]) => void;
}): (event: DragEvent<HTMLDivElement>) => void {
  useEffect(() => {
    const preventFileNavigation = (event: globalThis.DragEvent) => {
      if (hasFiles(event.dataTransfer)) event.preventDefault();
    };
    // Capture file drops even outside the chat or behind a modal. Do not stop
    // propagation: the chat's React handler still needs to receive the drop.
    for (const type of ["dragenter", "dragover", "drop"] as const) {
      window.addEventListener(type, preventFileNavigation, true);
    }
    return () => {
      for (const type of ["dragenter", "dragover", "drop"] as const) {
        window.removeEventListener(type, preventFileNavigation, true);
      }
    };
  }, []);

  return useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!hasFiles(event.dataTransfer)) return;
      event.preventDefault();
      // Portal events bubble through React owners, including image lightboxes
      // outside the chat. Only accept drops physically inside the chat panel.
      if (!enabled || !(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
      // Read synchronously while the browser's drag data store is accessible.
      const files = Array.from(event.dataTransfer.files ?? []);
      if (files.length > 0) onAddImages(files);
    },
    [enabled, onAddImages],
  );
}
