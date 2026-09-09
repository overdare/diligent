// @summary Generates and stores images through the selected ChatGPT OAuth or Gemini provider.
import type { ImageGenerationFn } from "@diligent/core/provider-contract";
import type { Tool, ToolResult } from "@diligent/core/tool-contract";
import type { BundledToolProvider, RuntimeToolHost } from "@diligent/runtime";
import { z } from "zod";
import { type GenerateGeminiImage, generateGeminiImage } from "./gemini";
import { type GeminiImageConfig, resolveGeminiImageConfig } from "./gemini-config";
import { type ImageMediaType, storeGeneratedImage } from "./image-store";
import { readReferenceImages, resolveReferenceImages } from "./reference-images";
import { inspectTransparency } from "./transparency";

const TOOL_NAME = "generate_image";
const DEFAULT_CHATGPT_IMAGE_MODEL = "gpt-image-2.5-sunburst";
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
    background: z
      .enum(["auto", "opaque", "transparent"])
      .optional()
      .describe(
        "ChatGPT-only API background setting. Transparent is for cutout assets; opaque is for guides or chroma-key backgrounds.",
      ),
    referenceImages: z
      .array(z.string().trim().min(1))
      .max(5)
      .optional()
      .describe(
        "Optional PNG, JPEG, or WebP references on the agent host. Absolute paths are preferred; relative paths resolve from the project directory.",
      ),
  })
  .strict();

type ImageProvider = "chatgpt" | "gemini";
export interface ImageGenerationToolProviderOptions {
  generateImage?: ImageGenerationFn;
  generateGeminiImage?: GenerateGeminiImage;
  resolveGeminiImageConfig?: (cwd: string) => Promise<GeminiImageConfig | undefined>;
}

export function createImageGenerationToolProvider(
  options: ImageGenerationToolProviderOptions = {},
): BundledToolProvider {
  return {
    id: "@overdare/image-generation-tools",
    displayName: "Image Generation",
    createTools: ({ cwd, host, modelProvider, generateImage }) => {
      if (modelProvider !== "chatgpt" && modelProvider !== "gemini") return [];
      return [createGenerateImageTool(cwd, modelProvider, host, options.generateImage ?? generateImage, options)];
    },
  };
}

function createGenerateImageTool(
  cwd: string,
  provider: ImageProvider,
  host: RuntimeToolHost | undefined,
  chatGPTGenerate: ImageGenerationFn | undefined,
  options: ImageGenerationToolProviderOptions,
): Tool<typeof parameters> {
  const chatGPT = provider === "chatgpt";
  return {
    name: TOOL_NAME,
    description:
      `Generate and save one UI mockup, icon, panel, or illustration with ${chatGPT ? "Diligent ChatGPT OAuth" : "Gemini"}. ` +
      "Attach referenceImages for edits or coherent variants. Independent requests can run in parallel after shared references exist. " +
      `This tool is bound to the selected ${chatGPT ? "ChatGPT" : "Gemini"} provider and cannot switch providers. ` +
      (chatGPT ? "Set background explicitly for transparent assets. " : "Gemini uses its configured image model. ") +
      "Returns the exact absolute output file path and a preview. To use it in Studio, pass the file to studiorpc_asset_manager_image_import and bind asset.assetid to ImageLabel or ImageButton. " +
      "For transparent ChatGPT results, actual pixels are inspected; an opaque or empty warning needs repair within the retry budget using the preserved file as a reference. " +
      IMAGE_FAILURE_GUIDANCE,
    parameters,
    supportParallel: true,
    async execute(args, ctx): Promise<ToolResult> {
      ctx.signal.throwIfAborted();
      const requestedModel = DEFAULT_CHATGPT_IMAGE_MODEL;
      const requestedBackground = args.background ?? "auto";
      const approval = await host?.approve?.({
        permission: "execute",
        toolName: TOOL_NAME,
        description: "Generate and save an image",
        details: {
          provider,
          ...(chatGPT ? { model: requestedModel, background: requestedBackground } : {}),
          prompt: args.prompt,
          ...(args.referenceImages?.length ? { referenceImages: args.referenceImages } : {}),
        },
      });
      if (approval === "reject")
        return { output: "[Rejected by user]", metadata: { error: true, operation: "image_generation" } };
      const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(300_000)]);
      try {
        const paths = await resolveReferenceImages(cwd, args.referenceImages, signal);
        if (provider === "gemini") {
          const config = await (options.resolveGeminiImageConfig ?? resolveGeminiImageConfig)(cwd);
          signal.throwIfAborted();
          if (!config) throw new Error("Gemini API key is not configured.");
          const generated = await (options.generateGeminiImage ?? generateGeminiImage)({
            ...config,
            prompt: args.prompt,
            signal,
            ...(paths.length ? { referenceImages: paths } : {}),
          });
          const stored = await storeGeneratedImage(
            cwd,
            { type: "bytes", bytes: generated.bytes, mediaType: generated.mediaType },
            { signal },
          );
          return imageResult(stored.file, stored.mediaType, stored.bytes, {
            provider,
            source: "gemini-api",
            model: generated.model,
          });
        }
        if (!chatGPTGenerate) throw new Error("Direct image generation requires Diligent's ChatGPT OAuth runtime.");
        const referenceImages = await readReferenceImages(paths, signal);
        const generated = await chatGPTGenerate(
          {
            prompt: args.prompt,
            model: requestedModel,
            background: requestedBackground,
            ...(referenceImages.length ? { referenceImages } : {}),
          },
          { signal },
        );
        signal.throwIfAborted();
        const transparency = requestedBackground === "transparent" ? await inspectTransparency(generated) : undefined;
        signal.throwIfAborted();
        const stored = await storeGeneratedImage(
          cwd,
          { type: "bytes", bytes: generated.bytes, mediaType: generated.mediaType },
          { signal },
        );
        return imageResult(stored.file, stored.mediaType, stored.bytes, {
          provider,
          source: "chatgpt-oauth",
          requestedModel,
          requestedBackground,
          ...(generated.model ? { model: generated.model } : {}),
          ...(generated.background ? { background: generated.background } : {}),
          ...(transparency ? { transparency } : {}),
          ...(transparency?.warning ? { guidance: IMAGE_FAILURE_GUIDANCE } : {}),
        });
      } catch (error) {
        ctx.signal.throwIfAborted();
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`${reason}\n\n${IMAGE_FAILURE_GUIDANCE}`, { cause: error });
      }
    },
  };
}

function imageResult(
  file: string,
  mediaType: ImageMediaType,
  bytes: Buffer,
  details: Record<string, unknown>,
): ToolResult {
  return {
    output: JSON.stringify({ file, ...details }, null, 2),
    outputImages: [
      { type: "image", source: { type: "base64", media_type: mediaType, data: bytes.toString("base64") } },
    ],
    metadata: { operation: "image_generation", file, ...details },
  };
}

export type { GeneratedGeminiImage, GenerateGeminiImage } from "./gemini";
export type { GeminiImageConfig } from "./gemini-config";
