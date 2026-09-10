// @summary Calls ChatGPT subscription image endpoints directly with runtime-owned OAuth credentials.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { OpenAIOAuthTokens } from "../../../auth/types";
import { validateImage } from "../../image-resize";
import type { ImageGenerationFn, ImageMediaType } from "../image-generation";
import { CHATGPT_CODEX_CLIENT_VERSION } from "./headers";

const IMAGE_BASE_URL = "https://chatgpt.com/backend-api/codex/images";
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const responseSchema = z.object({
  data: z
    .array(
      z.object({
        b64_json: z
          .string()
          .min(1)
          .max(Math.ceil(MAX_IMAGE_BYTES / 3) * 4),
      }),
    )
    .min(1),
  model: z.string().nullish(),
  background: z.enum(["auto", "opaque", "transparent"]).nullish(),
});

export interface ChatGPTImageGenerationOptions {
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}

function mediaType(bytes: Buffer): ImageMediaType {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  throw new Error("ChatGPT returned unsupported image data.");
}

function redact(message: string, tokens: OpenAIOAuthTokens): string {
  for (const secret of [tokens.access_token, tokens.refresh_token, tokens.id_token]) {
    if (secret) message = message.replaceAll(secret, "[redacted]");
  }
  return message.slice(0, 2000);
}

function errorMessage(payload: unknown, status: number, tokens: OpenAIOAuthTokens): string {
  const error = z
    .object({ error: z.object({ message: z.string() }).optional(), detail: z.string().optional() })
    .safeParse(payload);
  const detail = error.success ? (error.data.error?.message ?? error.data.detail) : undefined;
  return `ChatGPT image generation failed (${status})${detail ? `: ${redact(detail, tokens)}` : "."}`;
}

export function createChatGPTImageGeneration(
  getTokens: () => OpenAIOAuthTokens | undefined,
  options: ChatGPTImageGenerationOptions = {},
): ImageGenerationFn {
  return async (input, requestOptions = {}) => {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 300_000);
    const signal = requestOptions.signal ? AbortSignal.any([requestOptions.signal, timeout]) : timeout;
    signal.throwIfAborted();
    const tokens = getTokens();
    if (!tokens) throw new Error("ChatGPT OAuth is not configured in Diligent.");
    const references = input.referenceImages ?? [];
    if (references.length > 5) throw new Error("Use at most five reference images.");
    if (references.some((image) => !image.bytes.length || image.bytes.length > MAX_IMAGE_BYTES)) {
      throw new Error("Reference images must be non-empty and at most 32 MiB each.");
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${tokens.access_token}`,
      "Content-Type": "application/json",
      originator: "diligent",
      version: CHATGPT_CODEX_CLIENT_VERSION,
      "x-codex-image-turn-id": randomUUID(),
    };
    if (tokens.account_id) headers["ChatGPT-Account-ID"] = tokens.account_id;
    if (tokens.account_info?.chatgpt_account_is_fedramp) headers["X-OpenAI-Fedramp"] = "true";
    const response = await (options.fetch ?? fetch)(
      `${IMAGE_BASE_URL}/${references.length ? "edits" : "generations"}`,
      {
        method: "POST",
        headers,
        redirect: "error",
        signal,
        body: JSON.stringify({
          prompt: input.prompt,
          model: input.model,
          background: input.background ?? "auto",
          quality: input.quality ?? "auto",
          size: input.size ?? "auto",
          n: 1,
          output_format: "png",
          ...(references.length
            ? {
                images: references.map((image) => ({
                  image_url: `data:${image.mediaType};base64,${Buffer.from(image.bytes).toString("base64")}`,
                })),
              }
            : {}),
        }),
      },
    ).catch((error: unknown) => {
      signal.throwIfAborted();
      throw new Error(
        `ChatGPT image request failed: ${redact(error instanceof Error ? error.message : String(error), tokens)}`,
      );
    });
    const payload: unknown = await response.json().catch(() => undefined);
    signal.throwIfAborted();
    if (!response.ok) throw new Error(errorMessage(payload, response.status, tokens));
    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success) throw new Error("ChatGPT returned an invalid image-generation response.");
    const encoded = parsed.data.data[0].b64_json;
    if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
      throw new Error("ChatGPT returned invalid base64 image data.");
    }
    const bytes = Buffer.from(encoded, "base64");
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error("ChatGPT returned invalid image size.");
    const outputMediaType = mediaType(bytes);
    try {
      await validateImage(Uint8Array.from(bytes).buffer, outputMediaType);
    } catch (error) {
      signal.throwIfAborted();
      throw new Error("ChatGPT returned invalid image data.", { cause: error });
    }
    signal.throwIfAborted();
    return {
      bytes,
      mediaType: outputMediaType,
      requestedModel: input.model,
      ...(parsed.data.model ? { model: parsed.data.model } : {}),
      ...(parsed.data.background ? { background: parsed.data.background } : {}),
    };
  };
}
