// @summary Generates and stores images through the selected ChatGPT OAuth or Gemini provider.
import type { ImageGenerationFn, ImageMediaType } from "@diligent/core/provider-contract";
import type { Tool, ToolResult } from "@diligent/core/tool-contract";
import type { BundledToolProvider, RuntimeToolHost } from "@diligent/runtime";
import { z } from "zod";
import { type GenerateGeminiImage, generateGeminiImage } from "./gemini";
import { type GeminiImageConfig, resolveGeminiImageConfig } from "./gemini-config";
import { storeGeneratedImage } from "./image-store";
import { readReferenceImages, resolveReferenceImages } from "./reference-images";
import { inspectTransparency } from "./transparency";

const TOOL_NAME = "generate_image";
const DEFAULT_IMAGE_MODEL = "gpt-image-2.5-sunburst";
const IMAGE_FAILURE_GUIDANCE =
  "Use at most three attempts per requested image: the initial call plus two retries or repairs with this same tool. " +
  "Retry only after correcting inputs, for a transient failure, or for a targeted visual repair. " +
  "Do not repeat unchanged authentication, permission, or unsupported-capability failures. " +
  "When blocked or after the third failure, stop image work and report the error. " +
  "For GUI tasks, continue with native Studio GUI panels, text, and controls only if that serves the requested scope; " +
  "reuse successful assets and explain the fallback. If generated artwork is required, report that deliverable as unfinished. " +
  "User cancellation or rejection stops the task, not a retry or fallback. " +
  "Do not substitute code-drawn images (PIL, SVG, or canvas), stock assets, or another provider " +
  "unless the user explicitly approves an alternative.";

function getImageToolDescription(chatGPT: boolean): string {
  return (
    `Generate and save ${chatGPT ? "one UI mockup, icon, panel, or illustration directly with Diligent ChatGPT OAuth" : "UI mockups, icons, panels, or illustrations with Gemini"}. ` +
    (chatGPT ? "No Codex installation is required. " : "") +
    "Attach referenceImages for edits or coherent variants, and set background explicitly for transparent assets. " +
    "Describe one image composition per prompt. Each call requests exactly one image. " +
    "Do not combine separate requested pictures into a collage, grid, diptych, or split-screen unless the user explicitly requests that layout. " +
    "When multiple images are requested, make one call per image in parallel in the same tool round. " +
    "Pass the same referenceImages to every call in the set; wait for shared references to exist before starting the parallel calls. " +
    "If no references were supplied or created, omit referenceImages from every call. Do not use an earlier result as the next call's reference unless the user requested sequential edits. " +
    "A count mismatch is returned as an explicit warning and does not trigger extra calls. " +
    "images.length is the delivered file count; requestedCount is only the request. A collage in one file counts as one image. " +
    "Inspect the previews and report any shortfall instead of claiming completion. " +
    `This tool is bound to the selected ${chatGPT ? "ChatGPT" : "Gemini"} provider and cannot switch providers. ` +
    "Returns an images array with each exact absolute output file path, media type, and optional transparency inspection, plus previews. " +
    (chatGPT ? "requestedModel records the request, while model is included only if the server reports it. " : "") +
    "Transparent ChatGPT requests include actual pixel inspection. Repair opaque output using its preserved file; regenerate empty output from the guide or last non-empty source within the same retry budget. " +
    "To use it in Studio, pass the file to studiorpc_asset_manager_image_import and bind asset.assetid to ImageLabel or ImageButton. " +
    IMAGE_FAILURE_GUIDANCE
  );
}

const parameters = z
  .object({
    prompt: z
      .string()
      .trim()
      .min(1)
      .max(6_000)
      .describe(
        "Describe exactly one image composition. For multiple images, submit separate calls in parallel with the same referenceImages. Do not enumerate multiple pictures or request a collage unless explicitly requested.",
      ),
    background: z
      .enum(["auto", "opaque", "transparent"])
      .optional()
      .describe(
        "ChatGPT-only API background setting: transparent for cutout assets, opaque for guides or solid backgrounds; defaults to auto.",
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
      return [
        createGenerateImageTool(
          cwd,
          host,
          options.generateImage ?? generateImage,
          DEFAULT_IMAGE_MODEL,
          modelProvider,
          options,
        ),
      ];
    },
  };
}

function createGenerateImageTool(
  cwd: string,
  host: RuntimeToolHost | undefined,
  generate: ImageGenerationFn | undefined,
  defaultModel: string,
  provider: "chatgpt" | "gemini",
  options: ImageGenerationToolProviderOptions,
): Tool<typeof parameters> {
  const chatGPT = provider === "chatgpt";
  return {
    name: TOOL_NAME,
    description: getImageToolDescription(chatGPT),
    parameters,
    supportParallel: true,
    async execute(args, ctx): Promise<ToolResult> {
      ctx.signal.throwIfAborted();
      const requestedModel = defaultModel;
      const background = args.background ?? "auto";
      const requestedCount = 1;
      if (!chatGPT && requestedCount !== 1) throw new Error("Gemini currently supports one image per call.");
      const approval = await host?.approve?.({
        permission: "execute",
        toolName: TOOL_NAME,
        description: "Generate and save an image",
        details: {
          provider,
          ...(chatGPT ? { model: requestedModel, n: requestedCount, background } : {}),
          prompt: args.prompt,
          ...(args.referenceImages?.length ? { referenceImages: args.referenceImages } : {}),
        },
      });
      if (approval === "reject")
        return { output: "[Rejected by user]", metadata: { error: true, operation: "image_generation" } };
      ctx.signal.throwIfAborted();
      const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(300_000)]);
      const images: Array<{
        file: string;
        mediaType: ImageMediaType;
        transparency?: Awaited<ReturnType<typeof inspectTransparency>>;
      }> = [];
      try {
        const paths = await resolveReferenceImages(cwd, args.referenceImages, signal);
        if (!chatGPT) {
          const config = await (options.resolveGeminiImageConfig ?? resolveGeminiImageConfig)(cwd);
          signal.throwIfAborted();
          if (!config) throw new Error("Gemini API key is not configured.");
          const generated = await (options.generateGeminiImage ?? generateGeminiImage)({
            ...config,
            prompt: args.prompt,
            signal,
            ...(paths.length ? { referenceImages: paths } : {}),
          });
          const stored = await storeGeneratedImage(cwd, generated, { signal });
          const details = {
            images: [{ file: stored.file, mediaType: stored.mediaType }],
            requestedCount,
            provider,
            source: "gemini-api",
            model: generated.model,
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
        }
        if (!generate) throw new Error("Direct image generation requires Diligent's ChatGPT OAuth runtime.");
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
        const outputImages: NonNullable<ToolResult["outputImages"]> = [];
        for (const image of generated.images) {
          signal.throwIfAborted();
          const transparency = background === "transparent" ? await inspectTransparency(image) : undefined;
          signal.throwIfAborted();
          const stored = await storeGeneratedImage(cwd, image, { signal });
          images.push({ file: stored.file, mediaType: stored.mediaType, ...(transparency ? { transparency } : {}) });
          outputImages.push({
            type: "image",
            source: { type: "base64", media_type: stored.mediaType, data: stored.bytes.toString("base64") },
          });
        }
        const warning =
          images.length === requestedCount
            ? undefined
            : `Requested ${requestedCount} ${requestedCount === 1 ? "image" : "images"}, but the server returned ${images.length} ${images.length === 1 ? "image" : "images"}.`;
        const details = {
          images,
          requestedCount,
          ...(warning ? { warning } : {}),
          provider: "chatgpt",
          source: "chatgpt-oauth",
          requestedModel,
          requestedBackground: background,
          ...(generated.model ? { model: generated.model } : {}),
          ...(generated.background ? { background: generated.background } : {}),
        };
        return {
          output: JSON.stringify(details, null, 2),
          outputImages,
          metadata: { operation: "image_generation", ...details },
        };
      } catch (error) {
        ctx.signal.throwIfAborted();
        const reason = error instanceof Error ? error.message : String(error);
        const preserved = images.length
          ? `\nSaved images before failure: ${JSON.stringify(images.map((image) => image.file))}`
          : "";
        throw new Error(`${reason}${preserved}\n\n${IMAGE_FAILURE_GUIDANCE}`, { cause: error });
      }
    },
  };
}

export type { GeneratedGeminiImage, GenerateGeminiImage } from "./gemini";
export type { GeminiImageConfig } from "./gemini-config";
