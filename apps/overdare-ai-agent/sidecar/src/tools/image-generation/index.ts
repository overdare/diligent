// @summary Exposes image generation bound to the selected ChatGPT or Gemini chat provider.

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
  })
  .strict();

type ImageProvider = "chatgpt" | "gemini";

interface GeneratedImage {
  image: GeneratedImageSource;
  provider: ImageProvider;
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
    createTools: ({ cwd, host, modelProvider }) => {
      if (modelProvider !== "chatgpt" && modelProvider !== "gemini") return [];
      return [createGenerateImageTool(cwd, modelProvider, host, options)];
    },
  };
}

function createGenerateImageTool(
  cwd: string,
  provider: ImageProvider,
  host: RuntimeToolHost | undefined,
  options: ImageGenerationToolProviderOptions,
): Tool<typeof parameters> {
  return {
    name: TOOL_NAME,
    description:
      `Generate one image with ${provider === "chatgpt" ? "ChatGPT via local Codex OAuth" : "Gemini"} and save it to a local file. ` +
      "Uses the current chat provider. Returns the provider, absolute file path, " +
      "and preview. To import it into OVERDARE Studio, pass file to studiorpc_asset_manager_image_import.",
    parameters,
    supportParallel: false,
    async execute(args, ctx) {
      ctx.signal.throwIfAborted();
      const approval = await host?.approve?.({
        permission: "execute",
        toolName: TOOL_NAME,
        description: "Generate and save an image",
        details: { provider, prompt: args.prompt },
      });
      if (approval === "reject") {
        return { output: "[Rejected by user]", metadata: { error: true, operation: "image_generation" } };
      }

      ctx.signal.throwIfAborted();
      const generated = await generateImageForProvider(
        { cwd, provider, prompt: args.prompt, signal: ctx.signal },
        options,
      );
      ctx.signal.throwIfAborted();
      const stored = await storeGeneratedImage(cwd, generated.image, { signal: ctx.signal });
      return buildImageToolResult(stored, generated);
    },
  };
}

async function generateImageForProvider(
  input: { cwd: string; provider: ImageProvider; prompt: string; signal: AbortSignal },
  options: ImageGenerationToolProviderOptions,
): Promise<GeneratedImage> {
  const { cwd, provider, prompt, signal } = input;

  if (provider === "gemini") {
    const resolveGemini = options.resolveGeminiImageConfig ?? resolveGeminiImageConfig;
    const geminiConfig = await resolveGemini(cwd);
    signal.throwIfAborted();
    if (!geminiConfig) {
      throw new Error("Gemini API key is not configured.");
    }
    const generate = options.generateGeminiImage ?? generateGeminiImage;
    const generated = await generate({ ...geminiConfig, prompt, signal });
    return {
      image: { type: "bytes", bytes: generated.bytes, mediaType: generated.mediaType },
      provider: "gemini",
      source: "gemini-api",
      model: generated.model,
    };
  }

  const generate = options.generateCodexImage ?? generateCodexImage;
  const generated = await generate({ cwd, prompt, signal });
  return {
    image: { type: "file", file: generated.sourcePath },
    provider: "chatgpt",
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
