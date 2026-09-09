// @summary Tests selected-chat-provider gating, bound image backends, and generate-and-store behavior.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import type { Tool } from "@diligent/core/tool-contract";
import { createSkillTool, discoverSkills, renderSkillsSection, resolvePaths } from "@diligent/runtime";
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
    modelProvider: "chatgpt" | "gemini";
    approve?: "once" | "reject";
  },
): Promise<Tool> {
  const { cwd, modelProvider, approve, ...options } = input;
  const provider = createImageGenerationToolProvider({
    generateCodexImage: async () => {
      throw new Error("Unexpected Codex generation");
    },
    generateGeminiImage: async () => {
      throw new Error("Unexpected Gemini generation");
    },
    resolveGeminiImageConfig: async () => ({ apiKey: "test-key", model: "test-image-model" }),
    ...options,
  });
  const tools = await provider.createTools({ cwd, modelProvider, host: { approve: async () => approve ?? "once" } });
  const tool = tools.find((candidate) => candidate.name === "generate_image");
  if (!tool) throw new Error("Expected the provider-bound image tool");
  return tool;
}

describe("generate_image", () => {
  test.each([
    ["chatgpt", "ChatGPT via local Codex OAuth", "ChatGPT"],
    ["gemini", "Gemini", "Gemini"],
  ] as const)("describes the %s-bound Studio asset workflow", async (modelProvider, backend, providerName) => {
    const tool = await toolFor({ cwd: "/repo", modelProvider });

    expect(tool.description).toContain("one bespoke icon, panel, or illustration");
    expect(tool.description).toContain("prompt");
    expect(tool.description).toContain(backend);
    expect(tool.description).toContain(`selected ${providerName} provider`);
    expect(tool.description).toContain("cannot switch providers");
    expect(tool.description).toContain("exact absolute output file path");
    expect(tool.description).toContain("preview");
    expect(tool.description).toContain("studiorpc_asset_manager_image_import");
    expect(tool.description).toContain("asset.assetid");
    expect(tool.description).toContain("stop image work and report the error");
    expect(tool.description).toContain("PIL, SVG, or canvas");
    expect(tool.description).toContain("user explicitly approves an alternative");
  });

  test("the runtime-loaded UI skill retains Studio import guidance but not generation-provider guidance", async () => {
    const { cwd, cleanup } = project();
    try {
      const { skills } = await discoverSkills({
        cwd,
        globalConfigDir: join(cwd, "empty-global"),
        additionalPaths: [join(import.meta.dir, "../../../../bootstrap/skills")],
      });
      const uiSkills = skills.filter((skill) => skill.name === "ui-generator");
      const loadSkill = createSkillTool(uiSkills);
      const result = await loadSkill.execute({ name: "ui-generator" }, context());

      expect(result.output).toContain("studiorpc_asset_manager_image_import");
      expect(result.output).toContain("asset.assetid");
      for (const content of [result.output, renderSkillsSection(uiSkills), loadSkill.description]) {
        expect(content).not.toContain("generate_image");
        expect(content).not.toContain("ChatGPT");
        expect(content).not.toContain("Gemini");
        expect(content).not.toContain("provider");
      }
    } finally {
      cleanup();
    }
  });

  test.each([
    "anthropic",
    "openai",
    undefined,
  ] as const)("does not expose image generation for model provider %s, even with other credentials", async (modelProvider) => {
    let credentialReads = 0;
    const provider = createImageGenerationToolProvider({
      resolveGeminiImageConfig: async () => {
        credentialReads += 1;
        return { apiKey: "available-key", model: "test-model" };
      },
    });
    expect(await provider.createTools({ cwd: "/repo", modelProvider })).toEqual([]);
    expect(credentialReads).toBe(0);
  });

  test("the model cannot override the image provider through tool arguments", async () => {
    const tool = await toolFor({ cwd: "/repo", modelProvider: "chatgpt" });
    expect(tool.parameters.safeParse({ prompt: "A coin" }).success).toBe(true);
    expect(tool.parameters.safeParse({ prompt: "A coin", provider: "gemini" }).success).toBe(false);
  });

  test("Gemini selection uses its saved key and stores the generated bytes", async () => {
    const { cwd, cleanup } = project();
    const calls: Array<{ apiKey: string; prompt: string; model: string }> = [];
    try {
      const tool = await toolFor({
        cwd,
        modelProvider: "gemini",
        generateGeminiImage: async ({ apiKey, prompt, model }) => {
          calls.push({ apiKey, prompt, model });
          return { bytes: Buffer.from("gemini-image"), mediaType: "image/png", model };
        },
      });
      const result = await tool.execute({ prompt: "A blue coin" }, context());
      const output = JSON.parse(result.output);
      expect(calls).toEqual([{ apiKey: "test-key", prompt: "A blue coin", model: "test-image-model" }]);
      expect(output).toMatchObject({ provider: "gemini", source: "gemini-api", model: "test-image-model" });
      expect(output.file.startsWith(join(resolvePaths(cwd).images, "generated"))).toBe(true);
      expect(await readFile(output.file, "utf8")).toBe("gemini-image");
      expect(result.outputImages?.[0]?.source.data).toBe(Buffer.from("gemini-image").toString("base64"));
    } finally {
      cleanup();
    }
  });

  test("ChatGPT selection uses Codex without reading configured Gemini credentials", async () => {
    const { cwd, cleanup } = project();
    const sourcePath = join(cwd, "codex-output.webp");
    writeFileSync(sourcePath, "codex-image");
    let credentialReads = 0;
    try {
      const tool = await toolFor({
        cwd,
        modelProvider: "chatgpt",
        resolveGeminiImageConfig: async () => {
          credentialReads += 1;
          return { apiKey: "available-key", model: "test-model" };
        },
        generateCodexImage: async ({ prompt }) => ({ sourcePath, revisedPrompt: `${prompt} refined` }),
      });
      const result = await tool.execute({ prompt: "A red button" }, context());
      const output = JSON.parse(result.output);
      expect(credentialReads).toBe(0);
      expect(output).toMatchObject({
        provider: "chatgpt",
        source: "codex-oauth",
        revisedPrompt: "A red button refined",
      });
      expect(output.file).not.toBe(sourcePath);
      expect(await readFile(output.file, "utf8")).toBe("codex-image");
      expect(result.outputImages?.[0]?.source.media_type).toBe("image/webp");
    } finally {
      cleanup();
    }
  });

  test("Gemini selection without a key fails without trying Codex", async () => {
    const tool = await toolFor({
      cwd: "/repo",
      modelProvider: "gemini",
      resolveGeminiImageConfig: async () => undefined,
    });
    await expect(tool.execute({ prompt: "A coin" }, context())).rejects.toThrow("Gemini API key is not configured");
  });

  test.each(["chatgpt", "gemini"] as const)("a %s failure never invokes the other backend", async (modelProvider) => {
    const { cwd, cleanup } = project();
    let otherCalls = 0;
    const fail = async (): Promise<never> => {
      throw new Error("selected provider failed");
    };
    const other = async (): Promise<never> => {
      otherCalls += 1;
      throw new Error("wrong provider");
    };
    try {
      const tool = await toolFor({
        cwd,
        modelProvider,
        generateCodexImage: modelProvider === "chatgpt" ? fail : other,
        generateGeminiImage: modelProvider === "gemini" ? fail : other,
      });
      const error = await tool.execute({ prompt: "A coin" }, context()).catch((error: unknown) => error);
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toContain("selected provider failed");
      expect(message).toContain("stop image work and report the error");
      expect(message).toContain("PIL, SVG, or canvas");
      expect(message).toContain("user explicitly approves an alternative");
      expect(otherCalls).toBe(0);
      expect(existsSync(join(resolvePaths(cwd).images, "generated"))).toBe(false);
    } finally {
      cleanup();
    }
  });

  test.each(["chatgpt", "gemini"] as const)("does not save a %s result after cancellation", async (modelProvider) => {
    const { cwd, cleanup } = project();
    const controller = new AbortController();
    const cancellation = new Error("cancelled before saving");
    try {
      const tool = await toolFor({
        cwd,
        modelProvider,
        generateGeminiImage: async () => {
          controller.abort(cancellation);
          return { bytes: Buffer.from("image"), mediaType: "image/png", model: "test-model" };
        },
        generateCodexImage: async () => {
          controller.abort(cancellation);
          return { sourcePath: join(cwd, "unused.png") };
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

  test("does not start generation if cancelled while resolving credentials", async () => {
    const controller = new AbortController();
    const tool = await toolFor({
      cwd: "/repo",
      modelProvider: "gemini",
      resolveGeminiImageConfig: async () => {
        controller.abort(new Error("cancelled during configuration"));
        return undefined;
      },
    });
    await expect(tool.execute({ prompt: "A coin" }, context(controller.signal))).rejects.toThrow(
      "cancelled during configuration",
    );
  });

  test("rejected approval does not read credentials or generate", async () => {
    let credentialReads = 0;
    const tool = await toolFor({
      cwd: "/repo",
      modelProvider: "gemini",
      approve: "reject",
      resolveGeminiImageConfig: async () => {
        credentialReads += 1;
        return undefined;
      },
    });
    await expect(tool.execute({ prompt: "A coin" }, context())).resolves.toMatchObject({
      output: "[Rejected by user]",
      metadata: { error: true },
    });
    expect(credentialReads).toBe(0);
  });

  test("returns an absolute stored path for a relative cwd", async () => {
    const { cwd, cleanup } = project();
    try {
      const tool = await toolFor({
        cwd: relative(process.cwd(), cwd),
        modelProvider: "gemini",
        generateGeminiImage: async ({ model }) => ({
          bytes: Buffer.from("image-data"),
          mediaType: "image/png",
          model,
        }),
      });
      const result = await tool.execute({ prompt: "A coin" }, context());
      expect(isAbsolute(JSON.parse(result.output).file)).toBe(true);
    } finally {
      cleanup();
    }
  });
});
