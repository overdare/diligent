// @summary Capability probe: runtime image generation returns a valid image that reaches the thread and the model

import { createHash } from "node:crypto";
import { resizeImageToSquarePng, validateImage } from "@diligent/core/image-contract";
import type { BundledToolProvider } from "@diligent/runtime";
import { z } from "zod";
import type { RuntimeEvalExecution, RuntimeEvalTask } from "../../runtime-task";
import { singlePixelPngRgb } from "../image-fixture";
import { finalAssistantText, RuntimeGrade, unwrapReply } from "../runtime/grading";
import { createFixtureRuntimeConfig, DEFAULT_RUNTIME_LIMITS, type RuntimeFixtureWorld } from "../runtime/helpers";

export const IMAGE_GENERATION_TOOL = "generate_image";
/** The model id the ChatGPT image endpoint expects from Codex-compatible clients. */
const IMAGE_MODEL = "gpt-image-2";
const COLORS = ["RED", "GREEN", "BLUE"] as const;
/** Minimum lead of the strongest channel over the next one before a generated image counts as one color. */
const DOMINANT_CHANNEL_MARGIN = 60;

export type GeneratedColor = (typeof COLORS)[number];

export interface GeneratedImageRecord {
  mediaType: string;
  bytes: number;
  sha256: string;
  width: number;
  height: number;
  averageRgb: readonly [number, number, number];
  dominantColor?: GeneratedColor;
}

export interface ImageGenerationCapabilityWorld extends RuntimeFixtureWorld {
  /** Color the tool requests from the generator; the model is never told it. */
  color: GeneratedColor;
  generated: GeneratedImageRecord[];
}

export const imageGenerationCapabilityTask: RuntimeEvalTask<ImageGenerationCapabilityWorld> = {
  id: "capability-image-generation",
  description: "Generate an image through the runtime binding, deliver it to the thread, and name its color.",
  fixtureVersion: "capability-image-generation-v1",
  limits: { ...DEFAULT_RUNTIME_LIMITS, maxTurns: 3, maxToolCalls: 1, maxChangedFiles: 0, timeoutMs: 900_000 },
  statePolicy: { allowedMutations: ["infrastructure", "sessions", "image_sidecars"] },
  toolPolicy: { allowedTools: [IMAGE_GENERATION_TOOL], allowedCapabilities: ["execute"], allowedCommands: [] },
  async setup(seed, root) {
    const color = COLORS[createHash("sha256").update(`image-generation:${seed}`).digest()[0]! % COLORS.length]!;
    return { root, seed, color, generated: [], expected: color, protectedPaths: [], allowedChanges: [] };
  },
  createRuntimeConfig: createFixtureRuntimeConfig,
  createBundledToolProviders: (world) => [imageGenerationProvider(world)],
  createSteps: () => [
    {
      kind: "turn",
      message: [
        `Call ${IMAGE_GENERATION_TOOL} exactly once with the prompt "a flat background swatch".`,
        "It returns the generated image. Look at that image and reply with exactly one word naming its dominant",
        "color: RED, GREEN, or BLUE.",
      ].join(" "),
    },
  ],
  snapshotWorld: async (world) => ({ color: world.color, generated: world.generated }),
  evaluate(input) {
    const grade = new RuntimeGrade("capability_image_generation");
    const calls = input.toolCalls.filter((call) => call.name === IMAGE_GENERATION_TOOL);
    if (calls.length === 0) return grade.fail("not_called", "The model never requested image generation.", "behavior");
    const image = input.world.generated[0];
    if (!image) {
      const error = calls.find((call) => call.error)?.error ?? "no image was produced";
      return grade.fail("generation_failed", `Image generation failed: ${error}`, "semantic_goal");
    }
    if (outputImageCount(input) === 0)
      return grade.fail("not_output", "thread/read did not expose the generated image on the tool result.", "behavior");
    if (!image.dominantColor) {
      grade.note(
        "ambiguous_color",
        "The generated image had no single dominant color, so model perception was not graded.",
      );
      return grade.pass();
    }
    if (image.dominantColor !== input.world.color)
      grade.note("prompt_drift", `Requested ${input.world.color}; the generator produced ${image.dominantColor}.`, {
        impact: "info",
      });
    const answer = unwrapReply(finalAssistantText(input)).toUpperCase();
    if (!answer.includes(image.dominantColor))
      return grade.fail(
        "not_seen",
        `Expected the model to report the generated ${image.dominantColor} image.`,
        "semantic_goal",
      );
    if (answer !== image.dominantColor)
      return grade.fail("format", `Expected exactly ${image.dominantColor}.`, "format_contract");
    return grade.pass();
  },
};

function imageGenerationProvider(world: ImageGenerationCapabilityWorld): BundledToolProvider {
  return {
    id: "eval-capability-image-generation",
    createTools: (context) => [
      {
        name: IMAGE_GENERATION_TOOL,
        description: "Generate one image from a text prompt with the active provider and return it.",
        parameters: z.object({ prompt: z.string().min(1) }).strict(),
        async execute({ prompt }, { signal }) {
          if (!context.generateImage) throw new Error("The runtime exposed no image generation capability.");
          const image = await context.generateImage(
            {
              prompt: `${prompt}. Fill the entire canvas with one flat, solid, pure ${world.color.toLowerCase()} color. No objects, text, gradients, borders, or other colors.`,
              model: IMAGE_MODEL,
              background: "opaque",
            },
            { signal },
          );
          const buffer = Uint8Array.from(image.bytes).buffer;
          await validateImage(buffer, image.mediaType);
          const square = await resizeImageToSquarePng(buffer, image.mediaType, 1, { signal });
          const averageRgb = singlePixelPngRgb(new Uint8Array(square.bytes));
          world.generated.push({
            mediaType: image.mediaType,
            bytes: image.bytes.byteLength,
            sha256: createHash("sha256").update(image.bytes).digest("hex"),
            width: square.source.width,
            height: square.source.height,
            averageRgb,
            dominantColor: dominantColor(averageRgb),
          });
          return {
            output: `Generated one ${square.source.width}x${square.source.height} image; it is attached.`,
            outputImages: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: image.mediaType,
                  data: Buffer.from(image.bytes).toString("base64"),
                },
              },
            ],
          };
        },
      },
    ],
  };
}

export function dominantColor(rgb: readonly [number, number, number]): GeneratedColor | undefined {
  const ranked = COLORS.map((color, index) => ({ color, value: rgb[index]! })).sort((a, b) => b.value - a.value);
  return ranked[0]!.value - ranked[1]!.value >= DOMINANT_CHANNEL_MARGIN ? ranked[0]!.color : undefined;
}

function outputImageCount(input: Pick<RuntimeEvalExecution<unknown>, "threadReads">): number {
  let count = 0;
  for (const item of input.threadReads.flatMap((read) => read.response.items)) {
    if (item.type === "toolCall" && item.toolName === IMAGE_GENERATION_TOOL) count += item.outputImages?.length ?? 0;
  }
  return count;
}
