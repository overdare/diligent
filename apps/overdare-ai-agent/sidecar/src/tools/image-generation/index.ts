// @summary Generates and stores images through Diligent's selected ChatGPT OAuth provider.
import {
  type ImageGenerationFn,
  type ImageMediaType,
  MAX_IMAGE_GENERATION_COUNT,
} from "@diligent/core/provider-contract";
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
    prompt: z.string().trim().min(1).max(6_000).describe("Shared image-generation prompt for the requested images."),
    n: z
      .number()
      .int()
      .min(1)
      .max(MAX_IMAGE_GENERATION_COUNT)
      .optional()
      .describe(
        "Number of images to request in one HTTP call (default 1). The server may return fewer; Diligent reports the actual count without extra requests.",
      ),
    background: z
      .enum(["auto", "opaque", "transparent"])
      .optional()
      .describe(
        "Explicit API background setting: transparent for cutout assets, opaque for guides or solid backgrounds; defaults to auto.",
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
      "Generate and save UI mockups, icons, panels, or illustrations directly with Diligent ChatGPT OAuth. No Codex installation is required. " +
      "Attach referenceImages for edits or coherent variants, and set background explicitly for transparent assets. " +
      "Independent requests can run in parallel after shared references exist. " +
      "Use n for multiple images of the same prompt in one request. All returned images are preserved in order. " +
      "A count shortfall is reported and does not trigger extra calls; do not automatically retry or top up a shortfall. " +
      "This tool is bound to the selected ChatGPT provider and cannot switch providers. " +
      "Returns each exact absolute output file path in files, per-image details in images, and previews. A single returned image also keeps file and transparency fields. requestedModel records the request, while model is included only if the server reports it. " +
      "Transparent requests include actual pixel inspection; an opaque or empty warning needs repair within the retry budget, using the preserved file as a reference. " +
      "To use it in Studio, pass the file to studiorpc_asset_manager_image_import and bind asset.assetid to ImageLabel or ImageButton. " +
      IMAGE_FAILURE_GUIDANCE,
    parameters,
    supportParallel: true,
    async execute(args, ctx): Promise<ToolResult> {
      ctx.signal.throwIfAborted();
      const requestedModel = defaultModel;
      const background = args.background ?? "auto";
      const requestedCount = args.n ?? 1;
      const approval = await host?.approve?.({
        permission: "execute",
        toolName: TOOL_NAME,
        description: "Generate and save an image",
        details: {
          provider: "chatgpt",
          model: requestedModel,
          n: requestedCount,
          background,
          prompt: args.prompt,
          ...(args.referenceImages?.length ? { referenceImages: args.referenceImages } : {}),
        },
      });
      if (approval === "reject")
        return { output: "[Rejected by user]", metadata: { error: true, operation: "image_generation" } };
      ctx.signal.throwIfAborted();
      const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(300_000)]);
      const savedFiles: string[] = [];
      try {
        if (!generate) throw new Error("Direct image generation requires Diligent's ChatGPT OAuth runtime.");
        const paths = await resolveReferenceImages(cwd, args.referenceImages, signal);
        const referenceImages = await readReferenceImages(paths, signal);
        const generated = await generate(
          {
            prompt: args.prompt,
            model: requestedModel,
            background,
            ...(args.n !== undefined ? { n: requestedCount } : {}),
            ...(referenceImages.length ? { referenceImages } : {}),
          },
          { signal },
        );
        signal.throwIfAborted();
        const images: Array<{
          file: string;
          mediaType: ImageMediaType;
          transparency?: Awaited<ReturnType<typeof inspectTransparency>>;
        }> = [];
        const outputImages: NonNullable<ToolResult["outputImages"]> = [];
        for (const image of generated.images) {
          signal.throwIfAborted();
          const transparency = background === "transparent" ? await inspectTransparency(image) : undefined;
          signal.throwIfAborted();
          const stored = await storeGeneratedImage(cwd, image, { signal });
          savedFiles.push(stored.file);
          images.push({ file: stored.file, mediaType: stored.mediaType, ...(transparency ? { transparency } : {}) });
          outputImages.push({
            type: "image",
            source: { type: "base64", media_type: stored.mediaType, data: stored.bytes.toString("base64") },
          });
        }
        const returnedCount = images.length;
        const countStatus =
          returnedCount < requestedCount ? "shortfall" : returnedCount > requestedCount ? "excess" : "matched";
        const singleImage = returnedCount === 1 ? images[0] : undefined;
        const details = {
          files: savedFiles,
          images,
          requestedCount,
          returnedCount,
          countStatus,
          ...(singleImage
            ? {
                file: singleImage.file,
                ...(singleImage.transparency ? { transparency: singleImage.transparency } : {}),
              }
            : {}),
          ...(countStatus !== "matched"
            ? {
                warning: `Requested ${requestedCount} images, but the server returned ${returnedCount}. No additional generation requests were made. Preserve the returned files and report the count mismatch without automatically topping up.`,
              }
            : {}),
          provider: "chatgpt",
          source: "chatgpt-oauth",
          requestedModel,
          requestedBackground: background,
          ...(generated.model ? { model: generated.model } : {}),
          ...(generated.background ? { background: generated.background } : {}),
          ...(images.some((image) => image.transparency?.warning) ? { guidance: IMAGE_FAILURE_GUIDANCE } : {}),
        };
        return {
          output: JSON.stringify(details, null, 2),
          outputImages,
          metadata: { operation: "image_generation", ...details },
        };
      } catch (error) {
        ctx.signal.throwIfAborted();
        const reason = error instanceof Error ? error.message : String(error);
        const preserved = savedFiles.length ? `\nSaved images before failure: ${JSON.stringify(savedFiles)}` : "";
        throw new Error(`${reason}${preserved}\n\n${IMAGE_FAILURE_GUIDANCE}`, { cause: error });
      }
    },
  };
}
