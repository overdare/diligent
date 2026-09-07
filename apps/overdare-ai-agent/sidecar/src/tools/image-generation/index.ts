// @summary Exposes provider-selectable image generation with shared project-local persistence.

import type { Tool, ToolResult } from "@diligent/core/tool-contract";
import type { BundledToolProvider, RuntimeToolHost } from "@diligent/runtime";
import { z } from "zod";
import { type GenerateCodexImage, generateCodexImage } from "../codex-imagegen/generate";
import { type GenerateGeminiImage, generateGeminiImage } from "./gemini";
import { type GeminiImageConfig, resolveGeminiImageConfig } from "./gemini-config";
import { type GeneratedImageSource, type StoredImage, storeGeneratedImage } from "./image-store";

const TOOL_NAME = "generate_image";

const parameters = z
  .object({
    prompt: z.string().trim().min(1).max(6_000).describe("Image-generation prompt for one image."),
    provider: z
      .enum(["auto", "gemini", "codex"])
      .optional()
      .describe('Image provider. "auto" (default) uses a configured Gemini API key, otherwise Codex managed OAuth.'),
  })
  .strict();

type ImageGenerationArgs = z.infer<typeof parameters>;

interface GeneratedImage {
  image: GeneratedImageSource;
  provider: "gemini" | "codex";
  source: "gemini-api" | "codex-oauth";
  model?: string;
  revisedPrompt?: string;
}

export interface ImageGenerationToolProviderOptions {
  generateCodexImage?: GenerateCodexImage;
  generateGeminiImage?: GenerateGeminiImage;
  resolveGeminiImageConfig?: (cwd: string) => Promise<GeminiImageConfig | undefined>;
}

export function createImageGenerationToolProvider(
  options: ImageGenerationToolProviderOptions = {},
): BundledToolProvider {
  return {
    id: "@overdare/image-generation-tools",
    displayName: "Image Generation",
    createTools: ({ cwd, host }) => [createGenerateImageTool(cwd, host, options)],
  };
}

function createGenerateImageTool(
  cwd: string,
  host: RuntimeToolHost | undefined,
  options: ImageGenerationToolProviderOptions,
): Tool<typeof parameters> {
  return {
    name: TOOL_NAME,
    description:
      "Generate one image and save it to a local file. By default, use a configured Gemini API key when available; " +
      "otherwise use the signed-in Codex managed ChatGPT OAuth account. Returns the provider, absolute file path, " +
      "and preview. To import it into OVERDARE Studio, pass file to studiorpc_asset_manager_image_import.",
    parameters,
    supportParallel: false,
    async execute(args, ctx) {
      ctx.signal.throwIfAborted();
      const approval = await host?.approve?.({
        permission: "execute",
        toolName: TOOL_NAME,
        description: "Generate and save an image",
        details: { provider: args.provider ?? "auto", prompt: args.prompt },
      });
      if (approval === "reject") {
        return { output: "[Rejected by user]", metadata: { error: true, operation: "image_generation" } };
      }

      ctx.signal.throwIfAborted();
      const generated = await generateImageForProvider(cwd, args, ctx.signal, options);
      ctx.signal.throwIfAborted();
      const stored = await storeGeneratedImage(cwd, generated.image, { signal: ctx.signal });
      return buildImageToolResult(stored, generated);
    },
  };
}

async function generateImageForProvider(
  cwd: string,
  args: ImageGenerationArgs,
  signal: AbortSignal,
  options: ImageGenerationToolProviderOptions,
): Promise<GeneratedImage> {
  const resolveGemini = options.resolveGeminiImageConfig ?? resolveGeminiImageConfig;
  const geminiConfig = args.provider === "codex" ? undefined : await resolveGemini(cwd);
  signal.throwIfAborted();

  if (args.provider === "gemini" || geminiConfig) {
    if (!geminiConfig) {
      throw new Error("Gemini API key is not configured.");
    }
    const generate = options.generateGeminiImage ?? generateGeminiImage;
    const generated = await generate({ ...geminiConfig, prompt: args.prompt, signal });
    return {
      image: { type: "bytes", bytes: generated.bytes, mediaType: generated.mediaType },
      provider: "gemini",
      source: "gemini-api",
      model: generated.model,
    };
  }

  const generate = options.generateCodexImage ?? generateCodexImage;
  const generated = await generate({ cwd, prompt: args.prompt, signal });
  return {
    image: { type: "file", file: generated.sourcePath },
    provider: "codex",
    source: "codex-oauth",
    revisedPrompt: generated.revisedPrompt,
  };
}

function buildImageToolResult(stored: StoredImage, generated: GeneratedImage): ToolResult {
  const { provider, source, model, revisedPrompt } = generated;
  const details = { file: stored.file, provider, source, ...(model ? { model } : {}) };
  return {
    output: JSON.stringify({ ...details, ...(revisedPrompt ? { revisedPrompt } : {}) }, null, 2),
    outputImages: [
      {
        type: "image",
        source: { type: "base64", media_type: stored.mediaType, data: stored.bytes.toString("base64") },
      },
    ],
    metadata: { operation: "image_generation", ...details },
  };
}

export type { GenerateCodexImage, GeneratedCodexImage } from "../codex-imagegen/generate";
export type { GeneratedGeminiImage, GenerateGeminiImage } from "./gemini";
export type { GeminiImageConfig } from "./gemini-config";
