// @summary Exposes image generation bound to the selected ChatGPT chat provider.

import type { Tool, ToolResult } from "@diligent/core/tool-contract";
import type { BundledToolProvider, RuntimeToolHost } from "@diligent/runtime";
import { z } from "zod";
import { type GenerateCodexImage, generateCodexImage } from "../codex-imagegen/generate";
import { type GeneratedImageSource, type StoredImage, storeGeneratedImage } from "./image-store";

const TOOL_NAME = "generate_image";
const IMAGE_FAILURE_GUIDANCE =
  "If generation fails, stop image work and report the error. " +
  "Do not substitute code-drawn images (PIL, SVG, or canvas), stock assets, or another provider " +
  "unless the user explicitly approves an alternative.";

const parameters = z
  .object({
    prompt: z.string().trim().min(1).max(6_000).describe("Image-generation prompt for one image."),
  })
  .strict();

type ImageProvider = "chatgpt";

interface GeneratedImage {
  image: GeneratedImageSource;
  provider: ImageProvider;
  source: "codex-oauth";
  revisedPrompt?: string;
}

export interface ImageGenerationToolProviderOptions {
  generateCodexImage?: GenerateCodexImage;
}

export function createImageGenerationToolProvider(
  options: ImageGenerationToolProviderOptions = {},
): BundledToolProvider {
  return {
    id: "@overdare/image-generation-tools",
    displayName: "Image Generation",
    createTools: ({ cwd, host, modelProvider }) => {
      if (modelProvider !== "chatgpt") return [];
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
      "Generate and save one bespoke icon, panel, or illustration from a prompt with ChatGPT via local Codex OAuth. " +
      "This tool is bound to the selected ChatGPT provider and cannot switch providers. " +
      "Returns the exact absolute output file path and a preview. To use it in OVERDARE Studio, separately " +
      "pass that file to studiorpc_asset_manager_image_import, then bind the returned asset.assetid to the target " +
      "ImageLabel or ImageButton. " +
      IMAGE_FAILURE_GUIDANCE,
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
      try {
        const generated = await generateImageForProvider(
          { cwd, provider, prompt: args.prompt, signal: ctx.signal },
          options,
        );
        ctx.signal.throwIfAborted();
        const stored = await storeGeneratedImage(cwd, generated.image, { signal: ctx.signal });
        return buildImageToolResult(stored, generated);
      } catch (error) {
        ctx.signal.throwIfAborted();
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`${reason}\n\n${IMAGE_FAILURE_GUIDANCE}`, { cause: error });
      }
    },
  };
}

async function generateImageForProvider(
  input: { cwd: string; provider: ImageProvider; prompt: string; signal: AbortSignal },
  options: ImageGenerationToolProviderOptions,
): Promise<GeneratedImage> {
  const { cwd, provider, prompt, signal } = input;

  const generate = options.generateCodexImage ?? generateCodexImage;
  const generated = await generate({ cwd, prompt, signal });
  return {
    image: { type: "file", file: generated.sourcePath },
    provider,
    source: "codex-oauth",
    revisedPrompt: generated.revisedPrompt,
  };
}

function buildImageToolResult(stored: StoredImage, generated: GeneratedImage): ToolResult {
  const { provider, source, revisedPrompt } = generated;
  const details = { file: stored.file, provider, source };
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
