// @summary Generates image bytes through the Gemini Interactions REST API.

import { z } from "zod";
import type { ImageMediaType } from "./image-store";

const GEMINI_IMAGE_TIMEOUT_MS = 300_000;
const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

const interactionSchema = z
  .object({
    status: z.string().optional(),
    steps: z
      .array(
        z
          .object({
            type: z.string(),
            content: z
              .array(
                z
                  .object({
                    type: z.string(),
                    data: z.string().optional(),
                    mime_type: z.string().optional(),
                  })
                  .passthrough(),
              )
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
    error: z.object({ message: z.string() }).passthrough().optional(),
  })
  .passthrough();

export type GeminiImageFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface GeneratedGeminiImage {
  bytes: Buffer;
  mediaType: ImageMediaType;
  model: string;
}

export type GenerateGeminiImage = (input: {
  apiKey: string;
  baseUrl?: string;
  model: string;
  prompt: string;
  signal?: AbortSignal;
}) => Promise<GeneratedGeminiImage>;

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

export function createGenerateGeminiImage(fetchImage: GeminiImageFetch = fetch): GenerateGeminiImage {
  return async (input) => {
    const baseUrl = (input.baseUrl ?? DEFAULT_GEMINI_BASE_URL).replace(/\/+$/, "");
    const timeoutSignal = AbortSignal.timeout(GEMINI_IMAGE_TIMEOUT_MS);
    const signal = input.signal ? AbortSignal.any([input.signal, timeoutSignal]) : timeoutSignal;
    signal.throwIfAborted();
    const response = await fetchImage(`${baseUrl}/interactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": input.apiKey },
      body: JSON.stringify({
        model: input.model,
        input: [{ type: "text", text: input.prompt }],
        response_format: { type: "image" },
      }),
      signal,
    });
    const payload = await response.json().catch(() => undefined);
    signal.throwIfAborted();
    if (!response.ok) throw new Error(apiErrorMessage(payload, response.status));
    const interaction = interactionSchema.safeParse(payload);
    if (!interaction.success) throw new Error("Gemini returned an invalid image-generation response.");
    if (interaction.data.status && interaction.data.status !== "completed") {
      throw new Error(interaction.data.error?.message ?? `Gemini image generation ${interaction.data.status}.`);
    }
    const image = interaction.data.steps
      ?.flatMap((step) => (step.type === "model_output" ? (step.content ?? []) : []))
      .findLast((content) => content.type === "image" && content.data);
    if (!image?.data) throw new Error("Gemini completed image generation without an image.");
    const bytes = Buffer.from(image.data, "base64");
    if (bytes.length === 0) throw new Error("Gemini returned empty image data.");
    return { bytes, mediaType: imageMediaType(image.mime_type), model: input.model };
  };
}

export const generateGeminiImage = createGenerateGeminiImage();
