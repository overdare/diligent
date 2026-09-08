// @summary Generates image bytes through the Gemini Interactions REST API.

import { z } from "zod";
import type { ImageMediaType } from "./image-store";

const GEMINI_IMAGE_TIMEOUT_MS = 300_000;
const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

const contentSchema = z
  .object({
    type: z.string(),
    data: z.string().optional(),
    mime_type: z.string().optional(),
  })
  .passthrough();

const stepSchema = z
  .object({
    type: z.string(),
    content: z.array(contentSchema).optional(),
  })
  .passthrough();

const interactionSchema = z
  .object({
    status: z.string().optional(),
    steps: z.array(stepSchema).optional(),
    error: z.object({ message: z.string() }).passthrough().optional(),
  })
  .passthrough();

type GeminiInteraction = z.infer<typeof interactionSchema>;

export type GeminiImageFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface GeneratedGeminiImage {
  bytes: Buffer;
  mediaType: ImageMediaType;
  model: string;
}

interface GeminiImageInput {
  apiKey: string;
  baseUrl?: string;
  model: string;
  prompt: string;
  signal?: AbortSignal;
}

export type GenerateGeminiImage = (input: GeminiImageInput) => Promise<GeneratedGeminiImage>;

export function createGenerateGeminiImage(fetchImage: GeminiImageFetch = fetch): GenerateGeminiImage {
  return async (input) => {
    const timeoutSignal = AbortSignal.timeout(GEMINI_IMAGE_TIMEOUT_MS);
    const signal = input.signal ? AbortSignal.any([input.signal, timeoutSignal]) : timeoutSignal;
    signal.throwIfAborted();

    const response = await requestImage(fetchImage, input, signal);
    const interaction = await readCompletedInteraction(response, signal);
    const image = decodeGeneratedImage(interaction);

    return { ...image, model: input.model };
  };
}

function requestImage(fetchImage: GeminiImageFetch, input: GeminiImageInput, signal: AbortSignal): Promise<Response> {
  const baseUrl = (input.baseUrl ?? DEFAULT_GEMINI_BASE_URL).replace(/\/+$/, "");
  return fetchImage(`${baseUrl}/interactions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": input.apiKey },
    body: JSON.stringify({
      model: input.model,
      input: [{ type: "text", text: input.prompt }],
      response_format: { type: "image" },
    }),
    signal,
  });
}

async function readCompletedInteraction(response: Response, signal: AbortSignal): Promise<GeminiInteraction> {
  const payload = await response.json().catch(() => undefined);
  signal.throwIfAborted();
  if (!response.ok) {
    throw new Error(apiErrorMessage(payload, response.status));
  }

  const parsed = interactionSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("Gemini returned an invalid image-generation response.");
  }

  const interaction = parsed.data;
  if (interaction.status && interaction.status !== "completed") {
    throw new Error(interaction.error?.message ?? `Gemini image generation ${interaction.status}.`);
  }
  return interaction;
}

function decodeGeneratedImage(interaction: GeminiInteraction): { bytes: Buffer; mediaType: ImageMediaType } {
  const modelOutputs = (interaction.steps ?? []).filter((step) => step.type === "model_output");
  const content = modelOutputs.flatMap((step) => step.content ?? []);
  const image = content.findLast((block) => block.type === "image" && block.data);
  if (!image?.data) {
    throw new Error("Gemini completed image generation without an image.");
  }

  const bytes = Buffer.from(image.data, "base64");
  if (bytes.length === 0) {
    throw new Error("Gemini returned empty image data.");
  }
  return { bytes, mediaType: imageMediaType(image.mime_type) };
}

function imageMediaType(value: string | undefined): ImageMediaType {
  if (value === "image/png" || value === "image/jpeg" || value === "image/webp") return value;
  throw new Error(`Gemini image generation returned an unsupported image format: ${value ?? "unknown"}.`);
}

function apiErrorMessage(payload: unknown, status: number): string {
  const parsed = interactionSchema.safeParse(payload);
  return parsed.success && parsed.data.error?.message
    ? parsed.data.error.message
    : `Gemini API request failed with HTTP ${status}.`;
}

export const generateGeminiImage = createGenerateGeminiImage();
