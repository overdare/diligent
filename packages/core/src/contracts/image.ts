// @summary Public image transformation policy and injected local-image loader boundary

export type { LocalImageLoader } from "../llm/image-io";
export {
  downscaleImageIfNeeded,
  type ImageAlphaStats,
  inspectImageAlpha,
  withImageDownscaling,
} from "../llm/image-resize";
