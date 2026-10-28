// @summary Verifies local thumbnail finalization, project storage, and cancellation without generation.
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { inspectImageAlpha } from "@diligent/core/image-contract";
import { createPermissionEngine, type RuntimeToolHost } from "@diligent/runtime";
import { createImageGenerationToolProvider } from "../../../src/tools/image-generation";

const roots: string[] = [];
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGPkEpH7z8XFxQAABvcBW4Wvy/wAAAAASUVORK5CYII=",
  "base64",
);
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function setup(approve?: RuntimeToolHost["approve"]) {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), "world-thumbnail-")));
  roots.push(cwd);
  const sourceImage = join(cwd, "source.png");
  await writeFile(sourceImage, png);
  const tools = await createImageGenerationToolProvider({
    generateImage: async () => {
      throw new Error("Finalizing must never generate another image");
    },
  }).createTools({ cwd, modelProvider: "chatgpt", host: { approve: approve ?? (async () => "once") } });
  const tool = tools.find((candidate) => candidate.name === "prepare_world_thumbnail");
  expect(tool).toBeDefined();
  return { cwd, sourceImage, tool: tool! };
}
const context = (signal = new AbortController().signal) => ({ toolCallId: "thumbnail", signal, abort() {} });

test("saves one upload-ready 1080px PNG inside the project and returns its folder and matching image", async () => {
  const { cwd, sourceImage, tool } = await setup();
  const result = await tool.execute({ sourceImage }, context());
  const output = JSON.parse(result.output);
  expect(output).toMatchObject({
    directory: join(cwd, "thumbnails"),
    width: 1080,
    height: 1080,
    mediaType: "image/png",
  });
  expect(dirname(output.file)).toBe(output.directory);
  const saved = await readFile(output.file);
  expect(saved.length).toBe(output.bytes);
  expect(saved.length).toBeLessThan(10_000_000);
  expect(await inspectImageAlpha(Uint8Array.from(saved).buffer, "image/png")).toMatchObject({
    width: 1080,
    height: 1080,
  });
  expect(output.crop).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  expect(output.source).toEqual({ width: 2, height: 1 });
  expect(await readFile(sourceImage)).toEqual(png);
  expect(await readdir(output.directory)).toEqual([output.file.split(/[\\/]/).at(-1)]);
  expect(result.outputImages).toHaveLength(1);
  expect(result.outputImages![0].source).toEqual({
    type: "base64",
    media_type: "image/png",
    data: saved.toString("base64"),
  });
  const second = JSON.parse((await tool.execute({ sourceImage: "source.png" }, context())).output);
  expect(second.file).not.toBe(output.file);
  expect(await readFile(output.file)).toEqual(saved);
  expect(await readdir(output.directory)).toHaveLength(2);
});

test("rejection stops before reading even a missing source or creating a folder", async () => {
  let details: unknown;
  const { cwd, tool } = await setup(async (request) => {
    details = request.details;
    return "reject";
  });
  const result = await tool.execute({ sourceImage: "missing.png" }, context());
  expect(result.metadata?.error).toBe(true);
  expect(details).toMatchObject({ sourceImage: "missing.png" });
  expect(await readdir(cwd)).toEqual(["source.png"]);
});

test.each(["allow", "deny"] as const)("output path participates in %s permission rules", async (action) => {
  let pattern = "";
  const { cwd, sourceImage, tool } = await setup(async (request) => {
    const engine = createPermissionEngine([{ permission: "write", pattern, action }]);
    expect(engine.evaluate(request)).toBe(action);
    const remembered = createPermissionEngine([]);
    remembered.remember(request, "allow");
    expect(
      remembered.evaluate({ ...request, details: { file_path: `${cwd.replaceAll("\\", "/")}/thumbnails/next.png` } }),
    ).toBe("allow");
    expect(remembered.evaluate({ ...request, details: { file_path: `${cwd.replaceAll("\\", "/")}/other.png` } })).toBe(
      "prompt",
    );
    return action === "deny" ? "reject" : "once";
  });
  pattern = `${cwd.replaceAll("\\", "/")}/thumbnails/**`;
  const result = await tool.execute({ sourceImage }, context());
  expect(Boolean(result.metadata?.error)).toBe(action === "deny");
  if (action === "deny") expect(await readdir(cwd)).toEqual(["source.png"]);
});

test("cancellation after approval and invalid image bytes leave no deliverable", async () => {
  const controller = new AbortController();
  const { cwd, sourceImage, tool } = await setup(async () => {
    controller.abort(new Error("stop"));
    return "once";
  });
  await expect(tool.execute({ sourceImage }, context(controller.signal))).rejects.toThrow("stop");
  expect(await readdir(cwd)).toEqual(["source.png"]);
  const other = await setup();
  await writeFile(other.sourceImage, "not an image");
  await expect(other.tool.execute({ sourceImage: other.sourceImage }, context())).rejects.toThrow();
  expect(await readdir(other.cwd)).toEqual(["source.png"]);
});

test("an output-folder symlink cannot redirect the thumbnail outside the project", async () => {
  const { cwd, sourceImage, tool } = await setup();
  const outside = await mkdtemp(join(tmpdir(), "thumbnail-outside-"));
  roots.push(outside);
  await symlink(outside, join(cwd, "thumbnails"), process.platform === "win32" ? "junction" : "dir");
  await expect(tool.execute({ sourceImage }, context())).rejects.toThrow("inside the project");
  expect(await readdir(outside)).toEqual([]);
});
