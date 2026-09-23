// @summary Public image transformation policy and injected local-image loader boundary

export type { LocalImageLoader } from "../llm/image-io";
export {
  downscaleImageIfNeeded,
  type ImageAlphaStats,
  type ImageGridCell,
  inspectImageAlpha,
  splitImageGrid,
  withImageDownscaling,
} from "../llm/image-resize";
