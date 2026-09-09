// @summary Exposes image generation bound to the selected ChatGPT chat provider.

import type { Tool, ToolResult } from "@diligent/core/tool-contract";
import type { BundledToolProvider, RuntimeToolHost } from "@diligent/runtime";
import { z } from "zod";
import { type GenerateCodexImage, generateCodexImage } from "../codex-imagegen/generate";
import { type GeneratedImageSource, type StoredImage, storeGeneratedImage } from "./image-store";
import { resolveReferenceImages } from "./reference-images";

const TOOL_NAME = "generate_image";
const IMAGE_FAILURE_GUIDANCE =
  "Use at most three attempts per requested image: the initial call plus two retries or repairs with this same tool. " +
  "On failure, correct recoverable inputs (including unreadable reference paths) before retrying; " +
  "do not fall back on the first or second failure. After the third failure, stop image work and report the error. " +
  "For GUI tasks, then continue with native Studio GUI panels, text, and controls, reusing successful assets; " +
  "explain that generated artwork could not be used. User cancellation or rejection stops the task, not a retry or fallback. " +
  "Do not substitute code-drawn images (PIL, SVG, or canvas), stock assets, or another provider " +
  "unless the user explicitly approves an alternative.";

const parameters = z
  .object({
    prompt: z.string().trim().min(1).max(6_000).describe("Image-generation prompt for one image."),
    referenceImages: z
      .array(z.string().trim().min(1))
      .max(5)
      .optional()
      .describe(
        "Optional PNG, JPEG, or WebP reference files on the agent host. Reuse a mockup or anchor image for consistent variants. Absolute paths are preferred; relative paths resolve from the project directory.",
      ),
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
      "Generate and save one UI mockup, icon, panel, or illustration with ChatGPT via local Codex OAuth. " +
      "Attach referenceImages to guide edits or match a mockup's visual style. Independent requests can run in parallel; " +
      "finish a shared reference image before starting variants that depend on it. " +
      "This tool is bound to the selected ChatGPT provider and cannot switch providers. " +
      "Returns the exact absolute output file path and a preview. To use it in OVERDARE Studio, separately " +
      "pass that file to studiorpc_asset_manager_image_import, then bind the returned asset.assetid to the target " +
      "ImageLabel or ImageButton. " +
      IMAGE_FAILURE_GUIDANCE,
    parameters,
    supportParallel: true,
    async execute(args, ctx) {
      ctx.signal.throwIfAborted();
      const approval = await host?.approve?.({
        permission: "execute",
        toolName: TOOL_NAME,
        description: "Generate and save an image",
        details: {
          provider,
          prompt: args.prompt,
          ...(args.referenceImages?.length ? { referenceImages: args.referenceImages } : {}),
        },
      });
      if (approval === "reject") {
        return { output: "[Rejected by user]", metadata: { error: true, operation: "image_generation" } };
      }

      ctx.signal.throwIfAborted();
      try {
        const referenceImages = await resolveReferenceImages(cwd, args.referenceImages, ctx.signal);
        const generated = await generateImageForProvider(
          {
            cwd,
            provider,
            prompt: args.prompt,
            signal: ctx.signal,
            ...(referenceImages.length ? { referenceImages } : {}),
          },
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
  input: { cwd: string; provider: ImageProvider; prompt: string; signal: AbortSignal; referenceImages?: string[] },
  options: ImageGenerationToolProviderOptions,
): Promise<GeneratedImage> {
  const { cwd, provider, prompt, signal, referenceImages } = input;

  const generate = options.generateCodexImage ?? generateCodexImage;
  const generated = await generate({ cwd, prompt, signal, ...(referenceImages ? { referenceImages } : {}) });
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
