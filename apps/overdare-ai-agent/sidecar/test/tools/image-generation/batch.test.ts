// @summary A single model tool call runs separate image requests concurrently with shared references.
import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createImageGenerationToolProvider } from "../../../src/tools/image-generation";

test("one tool call starts three requests concurrently and keeps shared reference bytes", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "batch-images-"));
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGPkEpH7z8XFxQAABvcBW4Wvy/wAAAAASUVORK5CYII=",
    "base64",
  );
  const started: string[] = [];
  let active = 0;
  let maxActive = 0;
  await writeFile(join(cwd, "ref.png"), png);
  const [tool] = await createImageGenerationToolProvider({
    generateImage: async (input) => {
      started.push(input.prompt);
      expect(input.referenceImages).toEqual([{ bytes: png, mediaType: "image/png" }]);
      expect(input).not.toHaveProperty("n");
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      if (input.prompt === "second") throw new Error("Temporary generation failure");
      return { images: [{ bytes: Buffer.from(input.prompt), mediaType: "image/png" }], requestedModel: input.model };
    },
  }).createTools({ cwd, modelProvider: "chatgpt" });
  const running = tool.execute(
    tool.parameters.parse({ prompt: ["first", "second", "third"], referenceImages: ["ref.png"] }),
    { toolCallId: "batch", signal: new AbortController().signal, abort: () => {} },
  );
  try {
    const result = await running;
    const output = JSON.parse(result.output);
    expect(started).toEqual(["first", "second", "third"]);
    expect(maxActive).toBe(3);
    expect(tool.supportParallel).toBe(true);
    expect(output.requestedCount).toBe(3);
    expect(output.images).toHaveLength(2);
    expect(output.errors).toEqual([{ promptIndex: 1, message: "Temporary generation failure" }]);
    expect(output.warning).toBe("Requested 3 images, but the server returned 2 images.");
    expect(await Promise.all(output.images.map((image: { file: string }) => readFile(image.file, "utf8")))).toEqual([
      "first",
      "third",
    ]);
    expect(new Set(output.images.map((image: { file: string }) => image.file)).size).toBe(2);
    expect(result.outputImages).toHaveLength(2);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("rejects empty, oversized, and invalid prompt batches", async () => {
  const [tool] = await createImageGenerationToolProvider().createTools({ cwd: "/repo", modelProvider: "chatgpt" });
  for (const prompt of [[], Array(11).fill("image"), ["ok", " "], ["ok", 3]]) {
    expect(tool.parameters.safeParse({ prompt }).success).toBe(false);
  }
});
