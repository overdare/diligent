// @summary Generates and stores images through Diligent's selected ChatGPT OAuth provider.
import { unlink } from "node:fs/promises";
import type { ImageGenerationFn } from "@diligent/core/provider-contract";
import type { Tool, ToolResult } from "@diligent/core/tool-contract";
import type { BundledToolProvider, RuntimeToolHost } from "@diligent/runtime";
import { z } from "zod";
import { buildGridPrompt, gridSchema, storeImageGrid } from "./grid";
import { type StoredImage, storeGeneratedImage } from "./image-store";
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
  "Optionally select model gpt-image-2.5-flare for fast everyday generation; the default remains gpt-image-2.5-sunburst for editing precision. " +
  "For a batch of matching isolated assets, pass grid with rows, columns, and row-major items (null for blank cells). " +
  "Grid mode generates one sheet, adds layout/padding instructions, and returns the original plus occupied cells as lossless PNGs. Intentional blanks and fully transparent crops are omitted; skippedCells retains their diagnostics. " +
  "Grid backgrounds default to transparent. Inspect crops: generation may misplace objects despite the requested layout. " +
  "Independent requests can run in parallel after shared references exist. " +
  "This tool is bound to the selected ChatGPT provider and cannot switch providers. " +
  "Returns the exact absolute output file path and a preview. requestedModel records the request, while model is included only if the server reports it. " +
  "Transparent requests include actual pixel inspection. Repair opaque output using its preserved file; " +
  "regenerate empty output from the guide or last non-empty source within the same retry budget. " +
  "To use it in Studio, pass the file to studiorpc_asset_manager_image_import and bind asset.assetid to ImageLabel or ImageButton. " +
  IMAGE_FAILURE_GUIDANCE;

const parameters = z
  .object({
    prompt: z.string().trim().min(1).max(6_000).describe("Image-generation prompt for one image."),
    model: z
      .enum([DEFAULT_IMAGE_MODEL, "gpt-image-2.5-flare"])
      .optional()
      .describe("Optional image model; defaults to gpt-image-2.5-sunburst."),
    grid: gridSchema
      .optional()
      .describe(
        "Optional asset sheet layout (up to 64 cells). The tool builds the layout prompt and returns the original plus occupied cell PNGs in row-major order, omitting blank cells.",
      ),
    background: z
      .enum(["auto", "opaque", "transparent"])
      .optional()
      .describe(
        "Explicit API background setting: transparent for cutout assets, opaque for guides or solid backgrounds; defaults to transparent with grid, otherwise auto.",
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
      const requestedModel = args.model ?? defaultModel;
      const background = args.background ?? (args.grid ? "transparent" : "auto");
      const prompt = args.grid ? buildGridPrompt(args.prompt, args.grid, background) : args.prompt;
      const approval = await host?.approve?.({
        permission: "execute",
        toolName: TOOL_NAME,
        description: "Generate and save an image",
        details: {
          provider: "chatgpt",
          model: requestedModel,
          background,
          prompt: args.prompt,
          ...(args.grid ? { grid: args.grid } : {}),
          ...(args.referenceImages?.length ? { referenceImages: args.referenceImages } : {}),
        },
      });
      if (approval === "reject")
        return { output: "[Rejected by user]", metadata: { error: true, operation: "image_generation" } };
      ctx.signal.throwIfAborted();
      const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(300_000)]);
      const saved: StoredImage[] = [];
      try {
        if (!generate) throw new Error("Direct image generation requires Diligent's ChatGPT OAuth runtime.");
        const paths = await resolveReferenceImages(cwd, args.referenceImages, signal);
        const referenceImages = await readReferenceImages(paths, signal);
        const generated = await generate(
          {
            prompt,
            model: requestedModel,
            background,
            ...(referenceImages.length ? { referenceImages } : {}),
          },
          { signal },
        );
        signal.throwIfAborted();
        const transparency = background === "transparent" ? await inspectTransparency(generated) : undefined;
        signal.throwIfAborted();
        const stored = await storeGeneratedImage(cwd, generated, { signal });
        saved.push(stored);
        let grid:
          | Awaited<ReturnType<typeof storeImageGrid>>["details"]
          | { rows: number; columns: number; error: string; guidance: string }
          | undefined;
        let gridError = false;
        if (args.grid) {
          try {
            const split = await storeImageGrid(cwd, generated, args.grid, background, signal);
            saved.push(...split.stored);
            grid = split.details;
          } catch (error) {
            signal.throwIfAborted();
            gridError = true;
            grid = {
              rows: args.grid.rows,
              columns: args.grid.columns,
              error: error instanceof Error ? error.message : String(error),
              guidance:
                "The generated sheet is preserved in file. Grid extraction failed; do not regenerate the sheet solely to retry local cropping.",
            };
          }
        }
        signal.throwIfAborted();
        const details = {
          file: stored.file,
          provider: "chatgpt",
          source: "chatgpt-oauth",
          requestedModel,
          requestedBackground: background,
          ...(grid ? { grid } : {}),
          ...(generated.model ? { model: generated.model } : {}),
          ...(generated.background ? { background: generated.background } : {}),
          ...(transparency ? { transparency } : {}),
          ...(transparency?.warning ? { guidance: IMAGE_FAILURE_GUIDANCE } : {}),
        };
        return {
          output: JSON.stringify(details, null, 2),
          outputImages: saved.map((image) => ({
            type: "image",
            source: { type: "base64", media_type: image.mediaType, data: image.bytes.toString("base64") },
          })),
          metadata: { operation: "image_generation", ...details, ...(gridError ? { error: true } : {}) },
        };
      } catch (error) {
        await Promise.all(saved.map((image) => unlink(image.file).catch(() => {})));
        ctx.signal.throwIfAborted();
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`${reason}\n\n${IMAGE_FAILURE_GUIDANCE}`, { cause: error });
      }
    },
  };
}
