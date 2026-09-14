// @summary Generates and stores images through Diligent's selected ChatGPT OAuth provider.
import type { ImageGenerationFn, ImageMediaType } from "@diligent/core/provider-contract";
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
  "Retry only after correcting inputs, for a transient failure, or for a targeted visual repair. " +
  "Do not repeat unchanged authentication, permission, or unsupported-capability failures. " +
  "When blocked or after the third failure, stop image work and report the error. " +
  "For GUI tasks, continue with native Studio GUI panels, text, and controls only if that serves the requested scope; " +
  "reuse successful assets and explain the fallback. If generated artwork is required, report that deliverable as unfinished. " +
  "User cancellation or rejection stops the task, not a retry or fallback. " +
  "Do not substitute code-drawn images (PIL, SVG, or canvas), stock assets, or another provider " +
  "unless the user explicitly approves an alternative.";

const IMAGE_TOOL_DESCRIPTION =
  "Generate and save one UI mockup, icon, panel, or illustration directly with Diligent ChatGPT OAuth. No Codex installation is required. " +
  "Attach referenceImages for edits or coherent variants, and set background explicitly for transparent assets. " +
  "Describe one image composition per prompt. Use a string for one image, or an array of prompts for multiple images. " +
  "Do not combine separate requested pictures into a collage, grid, diptych, or split-screen unless the user explicitly requests that layout. " +
  "When multiple images are requested, submit all prompts in one generate_image call. The tool executes one n=1 HTTP request per prompt in parallel. " +
  "The same referenceImages are shared by every request; wait for shared references to exist before calling the tool. " +
  "If no references were supplied or created, omit referenceImages from every call. Do not use an earlier result as the next call's reference unless the user requested sequential edits. " +
  "images.length is the delivered file count; requestedCount is only the request. A collage in one file counts as one image. " +
  "Inspect the previews and report any shortfall instead of claiming completion. " +
  "A count mismatch is returned as an explicit warning and does not trigger extra calls; do not automatically retry or top up a shortfall. " +
  "This tool is bound to the selected ChatGPT provider and cannot switch providers. " +
  "Returns an images array with each exact absolute output file path, media type, and optional transparency inspection, plus previews. requestedModel records the request, while model is included only if the server reports it. " +
  "Transparent requests include actual pixel inspection. Repair opaque output using its preserved file; regenerate empty output from the guide or last non-empty source within the same retry budget. " +
  "To use it in Studio, pass the file to studiorpc_asset_manager_image_import and bind asset.assetid to ImageLabel or ImageButton. " +
  IMAGE_FAILURE_GUIDANCE;

const parameters = z
  .object({
    prompt: z
      .union([z.string().trim().min(1).max(6_000), z.array(z.string().trim().min(1).max(6_000)).min(1).max(10)])
      .describe(
        "Describe exactly one image composition per string. For multiple images, provide an array of prompts in this single call; the tool runs them in parallel with the same referenceImages. Repeat a prompt for variants. Do not combine separate pictures into one prompt.",
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
    description: IMAGE_TOOL_DESCRIPTION,
    parameters,
    supportParallel: true,
    async execute(args, ctx): Promise<ToolResult> {
      ctx.signal.throwIfAborted();
      const requestedModel = defaultModel;
      const background = args.background ?? "auto";
      const prompts = Array.isArray(args.prompt) ? args.prompt : [args.prompt];
      const requestedCount = prompts.length;
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
      const images: Array<{
        file: string;
        mediaType: ImageMediaType;
        transparency?: Awaited<ReturnType<typeof inspectTransparency>>;
      }> = [];
      try {
        if (!generate) throw new Error("Direct image generation requires Diligent's ChatGPT OAuth runtime.");
        const paths = await resolveReferenceImages(cwd, args.referenceImages, signal);
        const referenceImages = await readReferenceImages(paths, signal);
        const results = await Promise.allSettled(
          prompts.map((prompt) =>
            generate(
              { prompt, model: requestedModel, background, ...(referenceImages.length ? { referenceImages } : {}) },
              { signal },
            ),
          ),
        );
        signal.throwIfAborted();
        if (results.length === 1 && results[0].status === "rejected") throw results[0].reason;
        const errors = results.flatMap((result, index) =>
          result.status === "rejected"
            ? [
                {
                  promptIndex: index,
                  message: result.reason instanceof Error ? result.reason.message : String(result.reason),
                },
              ]
            : [],
        );
        const completed = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
        const generated = {
          images: completed.flatMap((result) => result.images),
          model:
            completed.length && completed.every((result) => result.model === completed[0].model)
              ? completed[0].model
              : undefined,
          background:
            completed.length && completed.every((result) => result.background === completed[0].background)
              ? completed[0].background
              : undefined,
        };
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
          ...(errors.length
            ? {
                errors,
                repairGuidance: `Retry only failed prompt indexes, preserving successful files. ${IMAGE_FAILURE_GUIDANCE}`,
              }
            : {}),
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
