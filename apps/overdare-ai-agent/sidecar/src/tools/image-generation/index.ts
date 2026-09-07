// @summary Exposes provider-selectable image generation with shared project-local persistence.

import type { Tool } from "@diligent/core/tool-contract";
import type { BundledToolProvider, RuntimeToolHost } from "@diligent/runtime";
import { z } from "zod";
import { type GenerateCodexImage, generateCodexImage } from "../codex-imagegen/generate";
import { type GenerateGeminiImage, generateGeminiImage } from "./gemini";
import { type GeminiImageConfig, resolveGeminiImageConfig } from "./gemini-config";
import { type GeneratedImageSource, storeGeneratedImage } from "./image-store";

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
  const generateWithCodex = options.generateCodexImage ?? generateCodexImage;
  const generateWithGemini = options.generateGeminiImage ?? generateGeminiImage;
  const resolveGemini = options.resolveGeminiImageConfig ?? resolveGeminiImageConfig;

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
      const requestedProvider = args.provider ?? "auto";
      const approval = await (host?.approve ?? (async () => "once" as const))({
        permission: "execute",
        toolName: TOOL_NAME,
        description: "Generate and save an image",
        details: { provider: requestedProvider, prompt: args.prompt },
      });
      if (approval === "reject") {
        return { output: "[Rejected by user]", metadata: { error: true, operation: "image_generation" } };
      }

      ctx.signal.throwIfAborted();
      const geminiConfig = requestedProvider === "codex" ? undefined : await resolveGemini(cwd);
      ctx.signal.throwIfAborted();
      const provider = requestedProvider === "auto" ? (geminiConfig ? "gemini" : "codex") : requestedProvider;
      let image: GeneratedImageSource;
      let source: "gemini-api" | "codex-oauth";
      let model: string | undefined;
      let revisedPrompt: string | undefined;

      if (provider === "gemini") {
        if (!geminiConfig) throw new Error("Gemini API key is not configured.");
        const generated = await generateWithGemini({
          ...geminiConfig,
          prompt: args.prompt,
          signal: ctx.signal,
        });
        image = {
          type: "bytes",
          bytes: generated.bytes,
          mediaType: generated.mediaType,
        };
        source = "gemini-api";
        model = generated.model;
      } else {
        const generated = await generateWithCodex({ cwd, prompt: args.prompt, signal: ctx.signal });
        image = { type: "file", file: generated.sourcePath };
        source = "codex-oauth";
        revisedPrompt = generated.revisedPrompt;
      }

      ctx.signal.throwIfAborted();
      const stored = await storeGeneratedImage(cwd, image, { signal: ctx.signal });
      return {
        output: JSON.stringify(
          {
            file: stored.file,
            provider,
            source,
            ...(model ? { model } : {}),
            ...(revisedPrompt ? { revisedPrompt } : {}),
          },
          null,
          2,
        ),
        outputImages: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: stored.mediaType,
              data: stored.bytes.toString("base64"),
            },
          },
        ],
        metadata: { operation: "image_generation", provider, file: stored.file, source, ...(model ? { model } : {}) },
      };
    },
  };
}

export type { GenerateCodexImage, GeneratedCodexImage } from "../codex-imagegen/generate";
export type { GeneratedGeminiImage, GenerateGeminiImage } from "./gemini";
export type { GeminiImageConfig } from "./gemini-config";
