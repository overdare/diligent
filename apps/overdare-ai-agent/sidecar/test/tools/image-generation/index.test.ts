// @summary Tests ChatGPT-bound image generation, unsupported-provider gating, and generate-and-store behavior.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import type { Tool } from "@diligent/core/tool-contract";
import { resolvePaths } from "@diligent/runtime";
import {
  createImageGenerationToolProvider,
  type ImageGenerationToolProviderOptions,
} from "../../../src/tools/image-generation";

function project() {
  const cwd = mkdtempSync(join(tmpdir(), "image-generation-"));
  return { cwd, cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
}

function context(signal = new AbortController().signal) {
  return { toolCallId: "test", signal, abort: () => {} };
}

async function toolFor(
  input: ImageGenerationToolProviderOptions & {
    cwd: string;
    modelProvider?: "chatgpt" | "gemini";
    approve?: "once" | "reject";
  },
): Promise<Tool> {
  const { cwd, modelProvider = "chatgpt", approve, ...options } = input;
  const provider = createImageGenerationToolProvider({
    generateImage: async () => {
      throw new Error("Unexpected image generation");
    },
    generateGeminiImage: async () => {
      throw new Error("Unexpected Gemini generation");
    },
    resolveGeminiImageConfig: async () => ({ apiKey: "test-key", model: "test-gemini-image-model" }),
    ...options,
  });
  const tools = await provider.createTools({
    cwd,
    modelProvider,
    host: { approve: async () => approve ?? "once" },
  });
  const tool = tools.find((candidate) => candidate.name === "generate_image");
  if (!tool) throw new Error("Expected the provider-bound image tool");
  return tool;
}

describe("generate_image", () => {
  test.each([
    {
      status: "opaque",
      reported: "transparent" as const,
      warning: true,
      png: "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGPkEpH7z8XFxQAABvcBW4Wvy/wAAAAASUVORK5CYII=",
    },
    {
      status: "has_transparency",
      reported: "opaque" as const,
      warning: false,
      png: "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGPgEpH7z8DAwAAABpQBPFULoekAAAAASUVORK5CYII=",
    },
    {
      status: "empty",
      reported: "transparent" as const,
      warning: true,
      png: "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAC0lEQVR4nGNggAIAAAkAAftSuKkAAAAASUVORK5CYII=",
    },
  ])("reports actual $status pixels independently of backend claims and preserves repairable bytes", async (fixture) => {
    const { cwd, cleanup } = project();
    const bytes = Buffer.from(fixture.png, "base64");
    let calls = 0;
    try {
      const tool = await toolFor({
        cwd,
        generateImage: async (input) => {
          calls++;
          return { bytes, mediaType: "image/png", requestedModel: input.model, background: fixture.reported };
        },
      });
      const result = await tool.execute({ prompt: "Cutout", background: "transparent" }, context());
      const output = JSON.parse(result.output);
      expect(output.requestedBackground).toBe("transparent");
      expect(output.background).toBe(fixture.reported);
      expect(output.transparency.status).toBe(fixture.status);
      expect(Boolean(output.transparency.warning)).toBe(fixture.warning);
      if (fixture.warning) expect(output.guidance).toContain("initial call plus two retries");
      expect(await readFile(output.file)).toEqual(bytes);
      expect(calls).toBe(1);
    } finally {
      cleanup();
    }
  });
  test("describes the ChatGPT-bound Studio asset workflow", async () => {
    const tool = await toolFor({ cwd: "/repo" });

    expect(tool.description).toContain("UI mockup");
    expect(tool.description).toContain("referenceImages");
    expect(tool.description).toContain("Diligent ChatGPT OAuth");
    expect(tool.description).toContain("selected ChatGPT provider");
    expect(tool.description).toContain("cannot switch providers");
    expect(tool.description).toContain("exact absolute output file path");
    expect(tool.description).toContain("preview");
    expect(tool.description).toContain("studiorpc_asset_manager_image_import");
    expect(tool.description).toContain("asset.assetid");
    expect(tool.description).toContain("stop image work and report the error");
    expect(tool.description).toContain("PIL, SVG, or canvas");
    expect(tool.description).toContain("user explicitly approves an alternative");
  });

  test.each([
    "anthropic",
    "openai",
    undefined,
  ] as const)("does not expose image generation for model provider %s", async (modelProvider) => {
    let generations = 0;
    const provider = createImageGenerationToolProvider({
      generateImage: async () => {
        generations += 1;
        throw new Error("Unexpected Codex generation");
      },
    });
    expect(await provider.createTools({ cwd: "/repo", modelProvider })).toEqual([]);
    expect(generations).toBe(0);
  });

  test("Gemini selection uses its own configured key and never reads the ChatGPT image capability", async () => {
    const { cwd, cleanup } = project();
    let chatGPTCalls = 0;
    try {
      const tool = await toolFor({
        cwd,
        modelProvider: "gemini",
        generateImage: async () => {
          chatGPTCalls++;
          throw new Error("Wrong provider");
        },
        generateGeminiImage: async ({ apiKey, model, prompt }) => {
          expect({ apiKey, model, prompt }).toEqual({
            apiKey: "test-key",
            model: "test-gemini-image-model",
            prompt: "A blue coin",
          });
          return { bytes: Buffer.from("gemini-image"), mediaType: "image/png", model };
        },
      });
      const result = await tool.execute({ prompt: "A blue coin" }, context());
      expect(JSON.parse(result.output)).toMatchObject({
        provider: "gemini",
        source: "gemini-api",
        model: "test-gemini-image-model",
      });
      expect(await readFile(JSON.parse(result.output).file, "utf8")).toBe("gemini-image");
      expect(chatGPTCalls).toBe(0);
    } finally {
      cleanup();
    }
  });

  test("the model cannot override the image provider through tool arguments", async () => {
    const tool = await toolFor({ cwd: "/repo" });
    expect(tool.parameters.safeParse({ prompt: "A coin" }).success).toBe(true);
    expect(tool.parameters.safeParse({ prompt: "A coin", provider: "gemini" }).success).toBe(false);
  });

  test.each([
    "chatgpt",
    "gemini",
  ] as const)("does not expose or accept an image model override for %s", async (modelProvider) => {
    const [tool] = await createImageGenerationToolProvider().createTools({ cwd: "/repo", modelProvider });
    expect(tool.parameters.safeParse({ prompt: "A coin" }).success).toBe(true);
    expect(tool.parameters.safeParse({ prompt: "A coin", model: "gpt-image-1" }).success).toBe(false);
  });

  test("pins the ChatGPT request model internally, forwards background, and does not invent a reported model", async () => {
    const { cwd, cleanup } = project();
    const image = "generated-image";
    try {
      const tool = await toolFor({
        cwd,
        generateImage: async (input) => {
          expect(input).toEqual({ prompt: "A red button", model: "gpt-image-2.5-sunburst", background: "transparent" });
          return {
            bytes: Buffer.from(image),
            mediaType: "image/webp",
            requestedModel: input.model,
            background: "transparent",
          };
        },
      });
      const result = await tool.execute({ prompt: "A red button", background: "transparent" }, context());
      const output = JSON.parse(result.output);
      expect(output).toMatchObject({
        provider: "chatgpt",
        source: "chatgpt-oauth",
        requestedModel: "gpt-image-2.5-sunburst",
        background: "transparent",
      });
      expect(output.model).toBeUndefined();
      expect(await readFile(output.file, "utf8")).toBe(image);
      expect(result.outputImages?.[0]?.source.media_type).toBe("image/webp");
      expect(result.outputImages?.[0]?.source.data).toBe(Buffer.from(image).toString("base64"));
    } finally {
      cleanup();
    }
  });

  test("a provider error emits the three-attempt GUI fallback policy without retrying or storing internally", async () => {
    const { cwd, cleanup } = project();
    let generations = 0;
    try {
      const tool = await toolFor({
        cwd,
        generateImage: async () => {
          generations += 1;
          throw new Error("Codex generation failed");
        },
      });
      const error = await tool.execute({ prompt: "A coin" }, context()).catch((error: unknown) => error);
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toContain("Codex generation failed");
      expect(message).toContain("at most three attempts per requested image");
      expect(message).toContain("native Studio GUI");
      expect(message).toContain("stop image work and report the error");
      expect(message).toContain("PIL, SVG, or canvas");
      expect(message).toContain("user explicitly approves an alternative");
      expect(existsSync(join(resolvePaths(cwd).images, "generated"))).toBe(false);
      expect(generations).toBe(1);
    } finally {
      cleanup();
    }
  });

  test("does not save a provider result after cancellation", async () => {
    const { cwd, cleanup } = project();
    const controller = new AbortController();
    const cancellation = new Error("cancelled before saving");
    try {
      const tool = await toolFor({
        cwd,
        generateImage: async (input) => {
          controller.abort(cancellation);
          return { bytes: Buffer.from("unused"), mediaType: "image/png", requestedModel: input.model };
        },
      });
      expect(await tool.execute({ prompt: "A coin" }, context(controller.signal)).catch((error) => error)).toBe(
        cancellation,
      );
      expect(existsSync(join(resolvePaths(cwd).images, "generated"))).toBe(false);
    } finally {
      cleanup();
    }
  });

  test("rejected approval does not start generation", async () => {
    let generations = 0;
    const tool = await toolFor({
      cwd: "/repo",
      approve: "reject",
      generateImage: async () => {
        generations += 1;
        throw new Error("Unexpected Codex generation");
      },
    });
    await expect(tool.execute({ prompt: "A coin" }, context())).resolves.toMatchObject({
      output: "[Rejected by user]",
      metadata: { error: true },
    });
    expect(generations).toBe(0);
  });

  test("returns an absolute stored path for a relative cwd", async () => {
    const { cwd, cleanup } = project();
    try {
      const tool = await toolFor({
        cwd: relative(process.cwd(), cwd),
        generateImage: async (input) => ({
          bytes: Buffer.from("image-data"),
          mediaType: "image/png",
          requestedModel: input.model,
        }),
      });
      const result = await tool.execute({ prompt: "A coin" }, context());
      expect(isAbsolute(JSON.parse(result.output).file)).toBe(true);
    } finally {
      cleanup();
    }
  });
});
