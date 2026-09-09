// @summary Checks original output pixels without discarding images that can be repaired.
import { inspectImageAlpha } from "@diligent/core/image-contract";
import type { ImageGenerationResult } from "@diligent/core/provider-contract";

export async function inspectTransparency(image: ImageGenerationResult) {
  const pixels = await inspectImageAlpha(Uint8Array.from(image.bytes).buffer, image.mediaType);
  if (!pixels)
    return {
      status: "unknown" as const,
      warning:
        "Could not verify pixel transparency. Inspect the saved image before importing it as a transparent asset.",
    };
  if (pixels.transparentPixels + pixels.partialPixels === 0) {
    return {
      status: "opaque" as const,
      ...pixels,
      warning:
        "Transparency was requested, but the actual image is fully opaque. Preserve this file as a repair reference; do not import it as a transparent asset.",
    };
  }
  if (pixels.opaquePixels + pixels.partialPixels === 0) {
    return {
      status: "empty" as const,
      ...pixels,
      warning: "The image is fully transparent with no visible artwork. Regenerate within the remaining retry budget.",
    };
  }
  return { status: "has_transparency" as const, ...pixels };
}
