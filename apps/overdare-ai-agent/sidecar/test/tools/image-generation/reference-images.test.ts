// @summary Verifies real reference-image propagation, approval, and input validation.
import { afterEach, expect, mock, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeTool, ToolRegistryBuilder } from "@diligent/core/tool-contract";
import { createImageGenerationToolProvider } from "../../../src/tools/image-generation";

const directories: string[] = [];
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==",
  "base64",
);
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup() {
  const cwd = await mkdtemp(join(tmpdir(), "image-references-"));
  directories.push(cwd);
  const file = join(cwd, "mockup.png");
  await writeFile(file, png);
  const generate = mock(async () => ({ sourcePath: file }));
  const approve = mock(async () => "once" as const);
  const [tool] = await createImageGenerationToolProvider({ generateCodexImage: generate }).createTools({
    cwd,
    modelProvider: "chatgpt",
    host: { approve },
  });
  const registry = new ToolRegistryBuilder().register(tool).build();
  const call = (input: unknown) =>
    executeTool(
      registry,
      { type: "tool_call", id: "image", name: tool.name, input },
      {
        toolCallId: "image",
        signal: new AbortController().signal,
        abort: () => {},
        onUpdate: () => {},
      },
    );
  return { cwd, file, generate, approve, call };
}

test("attaches project-relative reference files to generation and retains the original", async () => {
  const { cwd, file, generate, approve, call } = await setup();
  const result = await call({ prompt: "Keep this frame; change only the icon", referenceImages: ["mockup.png"] });
  expect(result.metadata?.error).not.toBe(true);
  expect(generate).toHaveBeenCalledWith(expect.objectContaining({ cwd, referenceImages: [file] }));
  expect(approve).toHaveBeenCalledWith(
    expect.objectContaining({ details: expect.objectContaining({ referenceImages: ["mockup.png"] }) }),
  );
  const saved = JSON.parse(result.output).file;
  expect(saved).not.toBe(file);
  expect(await readFile(saved)).toEqual(png);
  expect(await readFile(file)).toEqual(png);
});

test.each([
  "missing.png",
  ".",
  "not-an-image.txt",
])("rejects an unusable reference before generating: %s", async (path) => {
  const { cwd, generate, call } = await setup();
  await writeFile(join(cwd, "not-an-image.txt"), "not image data");
  const result = await call({ prompt: "Use the reference", referenceImages: [path] });
  expect(result.metadata?.error).toBe(true);
  expect(result.output).toContain("reference");
  expect(result.output).not.toContain("Unrecognized key");
  expect(generate).not.toHaveBeenCalled();
});

test("normalizes repeated references without changing their input order", async () => {
  const { file, generate, call } = await setup();
  await call({ prompt: "Variant", referenceImages: ["mockup.png", file] });
  expect(generate).toHaveBeenCalledWith(expect.objectContaining({ referenceImages: [file] }));
});

test("rejecting generation does not inspect a missing reference or invoke the provider", async () => {
  const { cwd, generate } = await setup();
  const [tool] = await createImageGenerationToolProvider({ generateCodexImage: generate }).createTools({
    cwd,
    modelProvider: "chatgpt",
    host: { approve: async () => "reject" },
  });
  const result = await tool.execute(
    { prompt: "Icon", referenceImages: ["missing.png"] },
    {
      toolCallId: "image",
      signal: new AbortController().signal,
      abort: () => {},
      onUpdate: () => {},
    },
  );
  expect(result.output).toBe("[Rejected by user]");
  expect(generate).not.toHaveBeenCalled();
});
