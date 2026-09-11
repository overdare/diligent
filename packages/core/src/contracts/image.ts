// @summary Public image transformation policy and injected local-image loader boundary

export type { LocalImageLoader } from "../llm/image-io";
export {
  compositeImageRects,
  downscaleImageIfNeeded,
  type ImageAlphaStats,
  inspectImageAlpha,
  type NormalizedImageRect,
  type ResizableMediaType,
  withImageDownscaling,
} from "../llm/image-resize";
