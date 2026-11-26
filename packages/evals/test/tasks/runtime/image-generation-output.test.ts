// @summary Assembled-runtime grading for image generation through the ProviderManager binding

import { describe, expect, test } from "bun:test";
import type { ProviderManager, StreamContext } from "@diligent/core/provider-contract";
import type { EvalProfile } from "../../../src/task";
import { solidColorPng } from "../../../src/tasks/image-fixture";
import {
  dominantColor,
  type ImageGenerationOutputWorld,
  imageGenerationOutputTask,
} from "../../../src/tasks/runtime/image-generation-output";
import { assistantMessage } from "../../helpers/fake-stream";
import { CHATGPT_PROFILE, collectBase64Images, runScripted, text } from "../../helpers/scripted-runtime";

const generateCall = () =>
  assistantMessage(
    [{ type: "tool_call", id: "gen", name: "generate_image", input: { prompt: "a flat background swatch" } }],
    "tool_use",
  );

describe("image-generation-output", () => {
  test("generates through ProviderManager, exposes the image on thread/read, and grades the model's color", async () => {
    let requestedPrompt = "";
    let modelSawImage = false;
    const configure = (_profile: EvalProfile, manager: ProviderManager) =>
      manager.setExternalAuth("chatgpt", {
        isConfigured: () => true,
        getStream: () => {
          throw new Error("The runner installs the profile stream.");
        },
        getImageGeneration: () => async (input) => {
          requestedPrompt = input.prompt;
          return { bytes: solidColorPng("RED"), mediaType: "image/png", requestedModel: input.model };
        },
      });
    const respond = (answer: string) => (call: number, context: StreamContext) => {
      if (call === 1) return generateCall();
      modelSawImage = collectBase64Images(context.messages).includes(solidColorPng("RED").toString("base64"));
      return text(answer);
    };

    const passed = await runScripted(imageGenerationOutputTask, respond("RED"), {
      profile: CHATGPT_PROFILE,
      configureProviderManager: configure,
    });
    const world = passed.execution.world as ImageGenerationOutputWorld;
    expect(passed.failures).toEqual([]);
    expect(modelSawImage).toBe(true);
    expect(requestedPrompt).toContain(world.color.toLowerCase());
    expect(world.generated).toEqual([expect.objectContaining({ mediaType: "image/png", dominantColor: "RED" })]);

    const unseen = await runScripted(imageGenerationOutputTask, respond("BLUE"), {
      profile: CHATGPT_PROFILE,
      configureProviderManager: configure,
    });
    expect(unseen.failure).toMatchObject({ code: "task_semantic.image_generation_output.not_seen" });
  });

  test("a provider without image generation fails with the runtime error", async () => {
    const result = await runScripted(imageGenerationOutputTask, (call) => (call === 1 ? generateCall() : text("RED")));
    expect(result.failure).toMatchObject({ code: "task_semantic.image_generation_output.generation_failed" });
    expect(result.failure?.message).toContain("OAuth");
  });

  test("classifies only clearly single-channel colors", () => {
    expect(dominantColor([220, 30, 30])).toBe("RED");
    expect(dominantColor([30, 170, 60])).toBe("GREEN");
    expect(dominantColor([240, 210, 30])).toBeUndefined();
  });
});
