// @summary Shared full-screen image viewer with download and keyboard dismissal.
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface PreviewImage {
  src: string;
  alt: string;
}

function downloadName(src: string): string {
  if (src.startsWith("data:"))
    return `image.${src.startsWith("data:image/jpeg") ? "jpg" : src.startsWith("data:image/webp") ? "webp" : "png"}`;
  try {
    return decodeURIComponent(src.split(/[?#]/, 1)[0].split("/").at(-1) || "image.png");
  } catch {
    return "image.png";
  }
}

export function ImageLightbox({ image, onClose }: { image: PreviewImage; onClose: () => void }) {
  const [failed, setFailed] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === "Tab") {
      const controls = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]") ?? [],
      );
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  };

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
      onKeyDown={handleKeyDown}
      className="image-lightbox"
    >
      <div className="image-lightbox-toolbar">
        <a href={image.src} download={downloadName(image.src)} aria-label="Download image" title="Download image">
          ↓
        </a>
        <button ref={closeRef} type="button" onClick={onClose} aria-label="Close image preview" title="Close">
          ×
        </button>
      </div>
      <div className="image-lightbox-stage">
        {failed ? (
          <output>Image unavailable</output>
        ) : (
          <img src={image.src} alt={image.alt} onError={() => setFailed(true)} />
        )}
      </div>
    </div>,
    document.body,
  );
}
