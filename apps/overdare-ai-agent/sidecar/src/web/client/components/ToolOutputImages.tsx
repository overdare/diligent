// @summary Inline previews for images returned through the shared tool result protocol
import type { ImageBlock } from "@diligent/protocol";
import { useState } from "react";
import { ImageLightbox, type PreviewImage } from "./ImageLightbox";
import { ImageGallery } from "./icons";

function ToolOutputImage({
  image,
  index,
  onOpen,
}: {
  image: ImageBlock;
  index: number;
  onOpen: (image: PreviewImage) => void;
}) {
  const [failed, setFailed] = useState(false);
  const label = `Tool output image ${index + 1}`;
  if (failed) return <p className="text-xs text-muted">{label}: Image unavailable</p>;

  const src = `data:${image.source.media_type};base64,${image.source.data}`;
  return (
    <button
      type="button"
      className="image-thumbnail"
      aria-label={`View ${label}`}
      onClick={() => onOpen({ src, alt: label })}
    >
      <img src={src} alt={label} loading="lazy" onError={() => setFailed(true)} />
    </button>
  );
}

export function ToolOutputImages({ images }: { images?: ImageBlock[] }) {
  const [expanded, setExpanded] = useState(true);
  const [preview, setPreview] = useState<PreviewImage | null>(null);
  if (!images?.length) return null;
  return (
    <section aria-label="Tool output images" className="image-gallery">
      <button
        type="button"
        className="image-gallery-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <ImageGallery aria-hidden="true" className="image-gallery-icon" /> {images.length}{" "}
        {images.length === 1 ? "image" : "images"} <span aria-hidden="true">{expanded ? "⌄" : "›"}</span>
      </button>
      {expanded ? (
        <div className="image-gallery-thumbnails">
          {images.map((image, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: tool result images have a fixed order
            <ToolOutputImage key={index} image={image} index={index} onOpen={setPreview} />
          ))}
        </div>
      ) : null}
      {preview ? <ImageLightbox image={preview} onClose={() => setPreview(null)} /> : null}
    </section>
  );
}
