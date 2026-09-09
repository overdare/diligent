// @summary Provider-neutral image generation capability without exposing provider credentials.
export type ImageBackground = "auto" | "opaque" | "transparent";
export type ImageMediaType = "image/png" | "image/jpeg" | "image/webp";

export interface ImageGenerationInput {
  prompt: string;
  model: string;
  background?: ImageBackground;
  quality?: "auto" | "low" | "medium" | "high";
  size?: string;
  referenceImages?: readonly { bytes: Uint8Array; mediaType: ImageMediaType }[];
}

export interface ImageGenerationOptions {
  signal?: AbortSignal;
}

export interface ImageGenerationResult {
  bytes: Uint8Array;
  mediaType: ImageMediaType;
  requestedModel: string;
  /** Only populated when the upstream response reports a model. */
  model?: string;
  background?: ImageBackground;
}

export type ImageGenerationFn = (
  input: ImageGenerationInput,
  options?: ImageGenerationOptions,
) => Promise<ImageGenerationResult>;
