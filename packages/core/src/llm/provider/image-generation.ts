// @summary Provider-neutral image generation capability without exposing provider credentials.
export type ImageBackground = "auto" | "opaque" | "transparent";
export type ImageMediaType = "image/png" | "image/jpeg" | "image/webp";
export const MAX_IMAGE_GENERATION_COUNT = 10;

export interface ImageGenerationInput {
  prompt: string;
  model: string;
  background?: ImageBackground;
  quality?: "auto" | "low" | "medium" | "high";
  size?: string;
  n?: number;
  referenceImages?: readonly { bytes: Uint8Array; mediaType: ImageMediaType }[];
}

export interface ImageGenerationOptions {
  signal?: AbortSignal;
}

export interface ImageGenerationImage {
  bytes: Uint8Array;
  mediaType: ImageMediaType;
}

export interface ImageGenerationResult {
  images: ImageGenerationImage[];
  requestedModel: string;
  /** Only populated when the upstream response reports a model. */
  model?: string;
  background?: ImageBackground;
}

export type ImageGenerationFn = (
  input: ImageGenerationInput,
  options?: ImageGenerationOptions,
) => Promise<ImageGenerationResult>;
