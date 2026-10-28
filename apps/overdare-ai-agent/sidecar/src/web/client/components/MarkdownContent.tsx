// @summary Markdown renderer using dangerouslySetInnerHTML with prose styles

import { type MouseEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { copyTextToClipboard } from "../lib/clipboard";
import { cn } from "../lib/cn";
import { loadFilePreview } from "../lib/file-preview";
import { type MarkdownOptions, renderMarkdown } from "../lib/markdown";
import { ImageLightbox, type PreviewImage } from "./ImageLightbox";

interface MarkdownContentProps {
  text: string;
  className?: string;
  options?: MarkdownOptions;
  loadFile?: typeof loadFilePreview;
}

// Preserve the rendered DOM and its focus/collapse state when only the viewer opens or closes.
const MarkdownBody = memo(function MarkdownBody({
  html,
  className,
  onClick,
  loadFile,
}: {
  html: string;
  className?: string;
  onClick: (event: MouseEvent<HTMLDivElement>) => void;
  loadFile: typeof loadFilePreview;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: HTML changes replace the image nodes and require loading their files again.
  useEffect(() => {
    let cancelled = false;
    for (const image of bodyRef.current?.querySelectorAll<HTMLImageElement>("img[data-local-image-url]") ?? []) {
      const url = new URL(image.dataset.localImageUrl!, window.location.origin);
      const button = image.closest<HTMLButtonElement>("[data-image-open]");
      void loadFile(url.searchParams.get("path")!, url.searchParams.get("threadId") ?? undefined).then(
        (file) => {
          if (cancelled) return;
          if (file.kind !== "image") {
            showUnavailable();
            return;
          }
          image.src = `data:${file.mediaType};base64,${file.dataBase64}`;
          if (button) button.disabled = false;
        },
        () => {
          if (!cancelled) showUnavailable();
        },
      );
      function showUnavailable() {
        const message = document.createElement("span");
        message.textContent = "Image unavailable";
        image.replaceWith(message);
      }
    }
    return () => {
      cancelled = true;
    };
  }, [html, loadFile]);

  return (
    <div
      ref={bodyRef}
      className={cn("prose-content", className)}
      onClick={onClick}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: agent output only — external input echoing requires DOMPurify
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});

export const MarkdownContent = memo(function MarkdownContent({
  text,
  className,
  options,
  loadFile = loadFilePreview,
}: MarkdownContentProps) {
  const resetTimers = useRef(new Map<HTMLButtonElement, number>());
  const [preview, setPreview] = useState<PreviewImage | null>(null);
  const pagePath = typeof window === "undefined" ? "" : window.location.pathname.slice(1);
  const threadId = options?.threadId ?? (pagePath && !pagePath.includes("/") ? pagePath : undefined);
  const basePath = options?.basePath;
  const safeHtml = options?.safeHtml;
  const html = useMemo(
    () => renderMarkdown(text, { threadId, basePath, safeHtml }),
    [text, threadId, basePath, safeHtml],
  );

  useEffect(
    () => () => {
      for (const timer of resetTimers.current.values()) {
        window.clearTimeout(timer);
      }
      resetTimers.current.clear();
    },
    [],
  );

  const handleClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (!(event.target instanceof Element)) return;

    const imageButton = event.target.closest("[data-image-open]");
    if (imageButton && event.currentTarget.contains(imageButton)) {
      const image = imageButton.querySelector("img");
      if (image) setPreview({ src: image.getAttribute("src") ?? "", alt: image.alt });
      return;
    }
    const imageToggle = event.target.closest("[data-image-toggle]");
    if (imageToggle && event.currentTarget.contains(imageToggle)) {
      const gallery = imageToggle.closest("[data-image-preview]");
      const thumbnail = gallery?.querySelector<HTMLElement>("[data-image-open]");
      const expanded = imageToggle.getAttribute("aria-expanded") !== "true";
      imageToggle.setAttribute("aria-expanded", String(expanded));
      if (thumbnail) thumbnail.hidden = !expanded;
      const chevron = imageToggle.querySelector("[data-image-chevron]");
      if (chevron) chevron.textContent = expanded ? "⌄" : "›";
      return;
    }

    const copyButton = event.target.closest<HTMLButtonElement>("[data-code-copy-button]");
    if (!copyButton || !event.currentTarget.contains(copyButton)) return;

    const code = copyButton.closest(".code-block")?.querySelector("pre code")?.textContent;
    if (code === undefined) return;

    void copyTextToClipboard(code).then((copied) => {
      if (!copied) return;

      const previousTimer = resetTimers.current.get(copyButton);
      if (previousTimer !== undefined) {
        window.clearTimeout(previousTimer);
      }

      copyButton.dataset.copied = "true";
      copyButton.setAttribute("aria-label", "Copied");

      const timer = window.setTimeout(() => {
        copyButton.dataset.copied = "false";
        copyButton.setAttribute("aria-label", copyButton.dataset.copyLabel ?? "Copy code");
        resetTimers.current.delete(copyButton);
      }, 1_000);
      resetTimers.current.set(copyButton, timer);
    });
  }, []);

  return (
    <>
      <MarkdownBody html={html} className={className} onClick={handleClick} loadFile={loadFile} />
      {preview ? <ImageLightbox image={preview} onClose={() => setPreview(null)} /> : null}
    </>
  );
});
