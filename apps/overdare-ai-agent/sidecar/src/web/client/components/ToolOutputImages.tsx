// @summary Inline previews for images returned through the shared tool result protocol
import type { ImageBlock } from "@diligent/protocol";
import { useState } from "react";

function ToolOutputImage({ image, index }: { image: ImageBlock; index: number }) {
  const [failed, setFailed] = useState(false);
  const label = `Tool output image ${index + 1}`;
  if (failed) return <p className="text-xs text-muted">{label}: Image unavailable</p>;

  return (
    <img
      src={`data:${image.source.media_type};base64,${image.source.data}`}
      alt={label}
      loading="lazy"
      className="max-h-48 max-w-[min(100%,20rem)] rounded-md border border-border/70 object-contain"
      onError={() => setFailed(true)}
    />
  );
}

export function ToolOutputImages({ images }: { images?: ImageBlock[] }) {
  if (!images?.length) return null;
  return (
    <section aria-label="Tool output images" className="mb-2 flex flex-wrap gap-2">
      {images.map((image, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: tool result images have a fixed order
        <ToolOutputImage key={index} image={image} index={index} />
      ))}
    </section>
  );
}
