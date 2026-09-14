// @summary Count requests preserve every returned image and report shortfalls without extra generations.
import { afterEach, expect, mock, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createImageGenerationToolProvider } from "../../../src/tools/image-generation";

const opaque = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGPkEpH7z8XFxQAABvcBW4Wvy/wAAAAASUVORK5CYII=",
  "base64",
);
const transparent = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGPgEpH7z8DAwAAABpQBPFULoekAAAAASUVORK5CYII=",
  "base64",
);
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup(bytes: Buffer[]) {
  const cwd = await mkdtemp(join(tmpdir(), "image-count-"));
  directories.push(cwd);
  const generate = mock(async () => ({
    images: bytes.map((bytes) => ({ bytes, mediaType: "image/png" as const })),
    requestedModel: "test",
  }));
  const approve = mock(async () => "once" as const);
  const [tool] = await createImageGenerationToolProvider({ generateImage: generate }).createTools({
    cwd,
    modelProvider: "chatgpt",
    host: { approve },
  });
  const ctx = { toolCallId: "count", signal: new AbortController().signal, abort: () => {} };
  return { tool, ctx, generate, approve };
}

test("the model-facing contract separates distinct pictures and counts returned files", async () => {
  const { tool } = await setup([]);
  expect(tool.description).toContain("For different subjects or compositions, make separate calls");
  expect(tool.description).toContain("Do not combine separate requested pictures into a collage");
  expect(tool.description).toContain("images.length is the delivered file count");
  expect(tool.description).toContain("report any shortfall instead of claiming completion");
  expect(tool.parameters.shape.prompt.description).toContain("one image composition");
  expect(tool.parameters.shape.n.description).toContain("same single-image prompt");
});

test("n=2 uses one request, stores both images in order, and inspects each original", async () => {
  const { tool, ctx, generate, approve } = await setup([opaque, transparent]);
  const result = await tool.execute(
    tool.parameters.parse({ prompt: "Two variants", n: 2, background: "transparent" }),
    ctx,
  );
  const output = JSON.parse(result.output);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(generate).toHaveBeenCalledWith(expect.objectContaining({ n: 2 }), { signal: expect.any(AbortSignal) });
  expect(approve).toHaveBeenCalledWith(expect.objectContaining({ details: expect.objectContaining({ n: 2 }) }));
  expect(output.requestedCount).toBe(2);
  const files = output.images.map((image: { file: string }) => image.file);
  expect(files).toHaveLength(2);
  expect(files[0]).not.toBe(files[1]);
  expect(await Promise.all(files.map((file: string) => readFile(file)))).toEqual([opaque, transparent]);
  expect(output.images.map((image: { transparency: { status: string } }) => image.transparency.status)).toEqual([
    "opaque",
    "has_transparency",
  ]);
  expect(result.outputImages?.map((image) => image.source.data)).toEqual([
    opaque.toString("base64"),
    transparent.toString("base64"),
  ]);
  expect(output.file).toBeUndefined();
});

test("a short response keeps its file and reports the actual count without retrying or filling", async () => {
  const { tool, ctx, generate } = await setup([opaque]);
  const result = await tool.execute(tool.parameters.parse({ prompt: "Two variants", n: 2 }), ctx);
  const output = JSON.parse(result.output);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(output.requestedCount).toBe(2);
  expect(output.images).toHaveLength(1);
  expect(output.warning).toBe("Requested 2 images, but the server returned 1 image.");
  expect(result.metadata?.warning).toBe(output.warning);
  expect(await readFile(output.images[0].file)).toEqual(opaque);
  expect(output.file).toBeUndefined();
  expect(result.outputImages).toHaveLength(1);
});

test("the default uses the same image-array contract and forwards n=1", async () => {
  const { tool, ctx, generate } = await setup([opaque]);
  const output = JSON.parse((await tool.execute({ prompt: "An icon" }, ctx)).output);
  expect(output.requestedCount).toBe(1);
  expect(output.images).toHaveLength(1);
  expect(await readFile(output.images[0].file)).toEqual(opaque);
  expect(generate).toHaveBeenCalledWith(expect.objectContaining({ n: 1 }), { signal: expect.any(AbortSignal) });
  for (const field of ["file", "files", "transparency", "returnedCount", "countStatus"]) {
    expect(output).not.toHaveProperty(field);
  }
});

test.each([0, -1, 1.5, 11])("rejects invalid count %s at the tool boundary", async (n) => {
  const { tool, generate } = await setup([opaque]);
  expect(tool.parameters.safeParse({ prompt: "Icon", n }).success).toBe(false);
  expect(generate).not.toHaveBeenCalled();
});

test("extra server images are preserved and reported instead of silently discarded", async () => {
  const { tool, ctx, generate } = await setup([opaque, transparent]);
  const output = JSON.parse((await tool.execute({ prompt: "Icon", n: 1 }, ctx)).output);
  expect(output.requestedCount).toBe(1);
  expect(output.images).toHaveLength(2);
  expect(output.warning).toBe("Requested 1 image, but the server returned 2 images.");
  expect(generate).toHaveBeenCalledTimes(1);
});
