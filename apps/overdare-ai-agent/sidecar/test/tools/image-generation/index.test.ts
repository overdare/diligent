// @summary Tests ChatGPT-bound image generation, unsupported-provider gating, and generate-and-store behavior.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import type { Tool } from "@diligent/core/tool-contract";
import { createSkillTool, discoverSkills, resolvePaths } from "@diligent/runtime";
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
    approve?: "once" | "reject";
  },
): Promise<Tool> {
  const { cwd, approve, ...options } = input;
  const provider = createImageGenerationToolProvider({
    generateCodexImage: async () => {
      throw new Error("Unexpected Codex generation");
    },
    ...options,
  });
  const tools = await provider.createTools({
    cwd,
    modelProvider: "chatgpt",
    host: { approve: async () => approve ?? "once" },
  });
  const tool = tools.find((candidate) => candidate.name === "generate_image");
  if (!tool) throw new Error("Expected the provider-bound image tool");
  return tool;
}

describe("generate_image", () => {
  test("describes the ChatGPT-bound Studio asset workflow", async () => {
    const tool = await toolFor({ cwd: "/repo" });

    expect(tool.description).toContain("UI mockup");
    expect(tool.description).toContain("referenceImages");
    expect(tool.description).toContain("ChatGPT via local Codex OAuth");
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

  test("the runtime-loaded GUI builder keeps image generation conditional on tool availability", async () => {
    const { cwd, cleanup } = project();
    try {
      const { skills } = await discoverSkills({
        cwd,
        globalConfigDir: join(cwd, "empty-global"),
        additionalPaths: [join(import.meta.dir, "../../../../bootstrap/skills")],
      });
      const uiSkills = skills.filter((skill) => skill.name === "gui-builder");
      const loadSkill = createSkillTool(uiSkills);
      const result = await loadSkill.execute({ name: "gui-builder" }, context());

      expect(result.output).toContain("studiorpc_asset_manager_image_import");
      expect(result.output).toContain("asset.assetid");
      expect(result.output).toContain("If `generate_image` is unavailable for the selected provider");
      expect(result.output).toContain("switch providers, or substitute code-drawn or stock art without approval");
    } finally {
      cleanup();
    }
  });

  test.each([
    "gemini",
    "anthropic",
    "openai",
    undefined,
  ] as const)("does not expose image generation for model provider %s", async (modelProvider) => {
    let generations = 0;
    const provider = createImageGenerationToolProvider({
      generateCodexImage: async () => {
        generations += 1;
        throw new Error("Unexpected Codex generation");
      },
    });
    expect(await provider.createTools({ cwd: "/repo", modelProvider })).toEqual([]);
    expect(generations).toBe(0);
  });

  test("the model cannot override the image provider through tool arguments", async () => {
    const tool = await toolFor({ cwd: "/repo" });
    expect(tool.parameters.safeParse({ prompt: "A coin" }).success).toBe(true);
    expect(tool.parameters.safeParse({ prompt: "A coin", provider: "gemini" }).success).toBe(false);
  });

  test("ChatGPT selection stores the Codex source-file fixture and returns its preview", async () => {
    const { cwd, cleanup } = project();
    const sourcePath = join(cwd, "codex-output.webp");
    const image = "codex-image";
    writeFileSync(sourcePath, image);
    try {
      const tool = await toolFor({
        cwd,
        generateCodexImage: async ({ prompt }) => ({ sourcePath, revisedPrompt: `${prompt} refined` }),
      });
      const result = await tool.execute({ prompt: "A red button" }, context());
      const output = JSON.parse(result.output);
      expect(output).toMatchObject({
        provider: "chatgpt",
        source: "codex-oauth",
        revisedPrompt: "A red button refined",
      });
      expect(output.file).not.toBe(sourcePath);
      expect(await readFile(output.file, "utf8")).toBe(image);
      expect(result.outputImages?.[0]?.source.media_type).toBe("image/webp");
      expect(result.outputImages?.[0]?.source.data).toBe(Buffer.from(image).toString("base64"));
    } finally {
      cleanup();
    }
  });

  test("a Codex error rejects without storing an image", async () => {
    const { cwd, cleanup } = project();
    try {
      const tool = await toolFor({
        cwd,
        generateCodexImage: async () => {
          throw new Error("Codex generation failed");
        },
      });
      const error = await tool.execute({ prompt: "A coin" }, context()).catch((error: unknown) => error);
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toContain("Codex generation failed");
      expect(message).toContain("stop image work and report the error");
      expect(message).toContain("PIL, SVG, or canvas");
      expect(message).toContain("user explicitly approves an alternative");
      expect(existsSync(join(resolvePaths(cwd).images, "generated"))).toBe(false);
    } finally {
      cleanup();
    }
  });

  test("does not save a Codex result after cancellation", async () => {
    const { cwd, cleanup } = project();
    const controller = new AbortController();
    const cancellation = new Error("cancelled before saving");
    try {
      const tool = await toolFor({
        cwd,
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

  test("rejected approval does not start Codex generation", async () => {
    let generations = 0;
    const tool = await toolFor({
      cwd: "/repo",
      approve: "reject",
      generateCodexImage: async () => {
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
        generateCodexImage: async () => ({ sourcePath: join(cwd, "codex-output.png") }),
      });
      writeFileSync(join(cwd, "codex-output.png"), "image-data");
      const result = await tool.execute({ prompt: "A coin" }, context());
      expect(isAbsolute(JSON.parse(result.output).file)).toBe(true);
    } finally {
      cleanup();
    }
  });
});
