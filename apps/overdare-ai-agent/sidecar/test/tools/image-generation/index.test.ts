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
    approve?: "once" | "reject";
  },
): Promise<Tool> {
  const { cwd, approve, ...options } = input;
  const provider = createImageGenerationToolProvider({
    generateImage: async () => {
      throw new Error("Unexpected image generation");
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
    "gemini",
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

  test("the model cannot override the image provider through tool arguments", async () => {
    const tool = await toolFor({ cwd: "/repo" });
    expect(tool.parameters.safeParse({ prompt: "A coin" }).success).toBe(true);
    expect(tool.parameters.safeParse({ prompt: "A coin", provider: "gemini" }).success).toBe(false);
  });

  test("pins the ChatGPT request model, forwards background, and does not invent a reported model", async () => {
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

  test("rejects unsupported image models", async () => {
    const tool = await toolFor({ cwd: "/repo" });
    expect(tool.parameters.safeParse({ prompt: "A coin", model: "gpt-image-1" }).success).toBe(false);
  });

  test("forwards the explicitly selected GPT Image 2.5 Flare model", async () => {
    const { cwd, cleanup } = project();
    try {
      const tool = await toolFor({
        cwd,
        generateImage: async (input) => {
          expect(input.model).toBe("gpt-image-2.5-flare");
          return { bytes: Buffer.from("image"), mediaType: "image/png", requestedModel: input.model };
        },
      });
      const args = tool.parameters.parse({ prompt: "A coin", model: "gpt-image-2.5-flare" });
      const result = await tool.execute(args, context());
      expect(JSON.parse(result.output).requestedModel).toBe("gpt-image-2.5-flare");
    } finally {
      cleanup();
    }
  });

  test("validates grid geometry and requires an explicit item or null for each cell", async () => {
    const tool = await toolFor({ cwd: "/repo" });
    for (const grid of [
      { rows: 0, columns: 1, items: ["coin"] },
      { rows: 1.5, columns: 1, items: ["coin"] },
      { rows: 2, columns: 2, items: ["coin"] },
      { rows: 1, columns: 1, items: [""] },
      { rows: 9, columns: 9, items: Array(81).fill("coin") },
      { rows: 1, columns: 1, items: ["coin"], extra: true },
    ])
      expect(tool.parameters.safeParse({ prompt: "Icons", grid }).success).toBe(false);
  });

  test("generates once and returns the original plus occupied PNG cells, skipping requested blanks", async () => {
    const { cwd, cleanup } = project();
    const bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGPgEpH7z8DAwAAABpQBPFULoekAAAAASUVORK5CYII=",
      "base64",
    );
    let calls = 0;
    try {
      const tool = await toolFor({
        cwd,
        generateImage: async (input) => {
          calls++;
          expect(input.background).toBe("transparent");
          expect(input.prompt).toContain("Warm pastel icons");
          expect(input.prompt).toContain("2 columns x 1 rows");
          expect(input.prompt).toContain("Cell 1 (row 1, column 1): coin");
          expect(input.prompt).toContain("Cell 2 (row 1, column 2): EMPTY");
          return { bytes, mediaType: "image/png", requestedModel: input.model };
        },
      });
      const result = await tool.execute(
        tool.parameters.parse({ prompt: "Warm pastel icons", grid: { rows: 1, columns: 2, items: ["coin", null] } }),
        context(),
      );
      const output = JSON.parse(result.output);
      expect(calls).toBe(1);
      expect(await readFile(output.file)).toEqual(bytes);
      expect(output.grid).toMatchObject({ rows: 1, columns: 2, width: 2, height: 1 });
      expect(output.grid.cells).toHaveLength(1);
      expect(output.grid.cells[0]).toMatchObject({
        index: 1,
        row: 1,
        column: 1,
        item: "coin",
        requestedEmpty: false,
        width: 1,
        height: 1,
      });
      expect(output.grid.skippedCells[0]).toMatchObject({
        index: 2,
        row: 1,
        column: 2,
        item: null,
        requestedEmpty: true,
        transparency: { status: "empty" },
      });
      expect(output.grid.skippedCells[0].warning).toBeUndefined();
      expect(output.grid.skippedCells[0].file).toBeUndefined();
      expect(result.outputImages).toHaveLength(2);
      for (const [index, cell] of output.grid.cells.entries()) {
        expect(isAbsolute(cell.file)).toBe(true);
        expect(cell.file.endsWith(".png")).toBe(true);
        expect((await readFile(cell.file)).toString("base64")).toBe(result.outputImages?.[index + 1]?.source.data);
      }
    } finally {
      cleanup();
    }
  });

  test("preserves the generated sheet when grid extraction fails", async () => {
    const { cwd, cleanup } = project();
    try {
      const tool = await toolFor({
        cwd,
        generateImage: async (input) => ({
          bytes: Buffer.from("invalid"),
          mediaType: "image/png",
          requestedModel: input.model,
        }),
      });
      const result = await tool.execute({ prompt: "Icons", grid: { rows: 1, columns: 1, items: ["coin"] } }, context());
      expect(result.metadata?.error).toBe(true);
      const output = JSON.parse(result.output);
      expect(output.grid.error).toContain("dimensions");
      expect(await readFile(output.file, "utf8")).toBe("invalid");
    } finally {
      cleanup();
    }
  });

  test("warns on unexpected artwork in blank cells and missing artwork in occupied cells without changing pixels", async () => {
    const { cwd, cleanup } = project();
    const bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGPgEpH7z8DAwAAABpQBPFULoekAAAAASUVORK5CYII=",
      "base64",
    );
    try {
      const tool = await toolFor({
        cwd,
        generateImage: async (input) => ({ bytes, mediaType: "image/png", requestedModel: input.model }),
      });
      const result = await tool.execute(
        { prompt: "Icons", grid: { rows: 1, columns: 2, items: [null, "coin"] } },
        context(),
      );
      const output = JSON.parse(result.output);
      const cells = output.grid.skippedCells;
      expect(output.grid.cells).toHaveLength(0);
      expect(result.outputImages).toHaveLength(1);
      expect(cells[0].warning).toContain("visible pixels remain");
      expect(cells[1].warning).toContain("no visible artwork");
      expect(cells[0].transparency.status).toBe("opaque");
      expect(cells[1].transparency.status).toBe("empty");
    } finally {
      cleanup();
    }
  });

  test("an explicit opaque grid background is forwarded and does not demand transparent empty cells", async () => {
    const { cwd, cleanup } = project();
    const bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGPkEpH7z8XFxQAABvcBW4Wvy/wAAAAASUVORK5CYII=",
      "base64",
    );
    try {
      const tool = await toolFor({
        cwd,
        generateImage: async (input) => {
          expect(input.background).toBe("opaque");
          expect(input.prompt).not.toContain("real PNG alpha");
          return { bytes, mediaType: "image/png", requestedModel: input.model };
        },
      });
      const result = await tool.execute(
        { prompt: "Icons", background: "opaque", grid: { rows: 1, columns: 2, items: [null, "coin"] } },
        context(),
      );
      const grid = JSON.parse(result.output).grid;
      expect(grid.cells).toHaveLength(1);
      expect(grid.cells[0]).toMatchObject({ index: 2, column: 2, item: "coin" });
      expect(grid.skippedCells[0]).toMatchObject({ index: 1, requestedEmpty: true });
      expect([...grid.cells, ...grid.skippedCells].every((cell: { warning?: string }) => !cell.warning)).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("a provider error emits bounded retry and scope-preserving fallback instructions without retrying internally", async () => {
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
      expect(message).toContain(
        "Do not repeat unchanged authentication, permission, or unsupported-capability failures",
      );
      expect(message).toContain("If generated artwork is required, report that deliverable as unfinished");
      expect(message).not.toContain("do not fall back on the first or second failure");
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
