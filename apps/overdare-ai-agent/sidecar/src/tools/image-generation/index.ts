// @summary Generates and stores images through Diligent's selected ChatGPT OAuth provider.
import type { ImageGenerationFn } from "@diligent/core/provider-contract";
import type { Tool, ToolResult } from "@diligent/core/tool-contract";
import type { BundledToolProvider, RuntimeToolHost } from "@diligent/runtime";
import { z } from "zod";
import { storeGeneratedImage } from "./image-store";
import { readReferenceImages, resolveReferenceImages } from "./reference-images";
import { inspectTransparency } from "./transparency";

const TOOL_NAME = "generate_image";
const DEFAULT_IMAGE_MODEL = "gpt-image-2.5-sunburst";
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
        "Explicit API background setting: transparent for cutout assets, opaque for guides or chroma-key backgrounds; defaults to auto.",
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

export interface ImageGenerationToolProviderOptions {
  generateImage?: ImageGenerationFn;
}

export function createImageGenerationToolProvider(
  options: ImageGenerationToolProviderOptions = {},
): BundledToolProvider {
  return {
    id: "@overdare/image-generation-tools",
    displayName: "Image Generation",
    createTools: ({ cwd, host, modelProvider, generateImage }) => {
      if (modelProvider !== "chatgpt") return [];
      return [createGenerateImageTool(cwd, host, options.generateImage ?? generateImage, DEFAULT_IMAGE_MODEL)];
    },
  };
}

function createGenerateImageTool(
  cwd: string,
  host: RuntimeToolHost | undefined,
  generate: ImageGenerationFn | undefined,
  defaultModel: string,
): Tool<typeof parameters> {
  return {
    name: TOOL_NAME,
    description:
      "Generate and save one UI mockup, icon, panel, or illustration directly with Diligent ChatGPT OAuth. No Codex installation is required. " +
      "Attach referenceImages for edits or coherent variants, and set background explicitly for transparent assets. " +
      "Independent requests can run in parallel after shared references exist. " +
      "This tool is bound to the selected ChatGPT provider and cannot switch providers. " +
      "Returns the exact absolute output file path and a preview. requestedModel records the request, while model is included only if the server reports it. " +
      "Transparent requests include actual pixel inspection; an opaque or empty warning needs repair within the retry budget, using the preserved file as a reference. " +
      "To use it in Studio, pass the file to studiorpc_asset_manager_image_import and bind asset.assetid to ImageLabel or ImageButton. " +
      IMAGE_FAILURE_GUIDANCE,
    parameters,
    supportParallel: true,
    async execute(args, ctx): Promise<ToolResult> {
      ctx.signal.throwIfAborted();
      const requestedModel = defaultModel;
      const background = args.background ?? "auto";
      const approval = await host?.approve?.({
        permission: "execute",
        toolName: TOOL_NAME,
        description: "Generate and save an image",
        details: {
          provider: "chatgpt",
          model: requestedModel,
          background,
          prompt: args.prompt,
          ...(args.referenceImages?.length ? { referenceImages: args.referenceImages } : {}),
        },
      });
      if (approval === "reject")
        return { output: "[Rejected by user]", metadata: { error: true, operation: "image_generation" } };
      ctx.signal.throwIfAborted();
      const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(300_000)]);
      try {
        if (!generate) throw new Error("Direct image generation requires Diligent's ChatGPT OAuth runtime.");
        const paths = await resolveReferenceImages(cwd, args.referenceImages, signal);
        const referenceImages = await readReferenceImages(paths, signal);
        const generated = await generate(
          {
            prompt: args.prompt,
            model: requestedModel,
            background,
            ...(referenceImages.length ? { referenceImages } : {}),
          },
          { signal },
        );
        signal.throwIfAborted();
        const transparency = background === "transparent" ? await inspectTransparency(generated) : undefined;
        signal.throwIfAborted();
        const stored = await storeGeneratedImage(
          cwd,
          { type: "bytes", bytes: generated.bytes, mediaType: generated.mediaType },
          { signal },
        );
        const details = {
          file: stored.file,
          provider: "chatgpt",
          source: "chatgpt-oauth",
          requestedModel,
          requestedBackground: background,
          ...(generated.model ? { model: generated.model } : {}),
          ...(generated.background ? { background: generated.background } : {}),
          ...(transparency ? { transparency } : {}),
          ...(transparency?.warning ? { guidance: IMAGE_FAILURE_GUIDANCE } : {}),
        };
        return {
          output: JSON.stringify(details, null, 2),
          outputImages: [
            {
              type: "image",
              source: { type: "base64", media_type: stored.mediaType, data: stored.bytes.toString("base64") },
            },
          ],
          metadata: { operation: "image_generation", ...details },
        };
      } catch (error) {
        ctx.signal.throwIfAborted();
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`${reason}\n\n${IMAGE_FAILURE_GUIDANCE}`, { cause: error });
      }
    },
  };
}
