// @summary Reserved UI previews are local annotations and preserve the Studio capture and RPC contract.
import { afterEach, expect, mock, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioRpcToolProvider } from "../../../../src/tools/studiorpc";
import {
  attachImages,
  normalizeArgs,
  params,
  postProcess,
} from "../../../../src/tools/studiorpc/methods/game.screenshot";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGPkEpH7z8XFxQAABvcBW4Wvy/wAAAAASUVORK5CYII=",
  "base64",
);
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function capture() {
  const directory = await mkdtemp(join(tmpdir(), "screenshot-overlay-"));
  directories.push(directory);
  const path = join(directory, "shot.png");
  await writeFile(path, png);
  return { directory, result: { success: true, path, image: { width: 2, height: 1 }, source: "playTest" } };
}

test("accepts annotation controls but never sends them to Studio", () => {
  const args = params.parse({ reservedUi: true, hiddenCoreGui: ["JumpButton"] });
  expect(normalizeArgs(args)).toEqual({ includeGui: true });
  expect(normalizeArgs({ includeGui: false, reservedUi: false, hiddenCoreGui: ["Joystick"] })).toEqual({
    includeGui: false,
  });
  expect(params.safeParse({ hiddenCoreGui: ["All"] }).success).toBe(false);
});

test("returns an annotated preview while preserving raw bytes and reporting estimated zones", async () => {
  const { result } = await capture();
  const callRpc = mock(async () => {
    throw new Error("No extra Studio calls expected");
  });
  const output = (await postProcess(result, {}, callRpc)) as typeof result & {
    reservedUi: { status: string; path: string; source: string; hiddenCoreGui: string[]; zones: { id: string }[] };
  };
  expect(output.path).toBe(result.path);
  expect(await readFile(result.path)).toEqual(png);
  expect(output.reservedUi.status).toBe("annotated");
  expect(output.reservedUi.source).toBe("reference-layout");
  expect(output.reservedUi.hiddenCoreGui).toEqual([]);
  expect(output.reservedUi.zones.map((zone) => zone.id)).toContain("JumpButton");
  expect(output.reservedUi.path).not.toBe(result.path);
  const annotated = await readFile(output.reservedUi.path);
  expect(annotated).not.toEqual(png);
  expect((await attachImages(output))?.[0].source.data).toBe(annotated.toString("base64"));
  expect(callRpc).not.toHaveBeenCalled();
});

test("excludes only caller-declared hidden controls without claiming runtime verification", async () => {
  const { result } = await capture();
  const output = (await postProcess(result, { hiddenCoreGui: ["JumpButton"] }, mock())) as {
    reservedUi: { hiddenCoreGui: string[]; visibilitySource: string; zones: { id: string }[] };
  };
  expect(output.reservedUi.hiddenCoreGui).toEqual(["JumpButton"]);
  expect(output.reservedUi.visibilitySource).toBe("caller-script-review");
  expect(output.reservedUi.zones.map((zone) => zone.id)).not.toContain("JumpButton");
  expect(output.reservedUi.zones.map((zone) => zone.id)).toContain("Joystick");
});

test.each([{ includeGui: false }, { reservedUi: false }])("keeps a clean capture for %j", async (args) => {
  const { directory, result } = await capture();
  expect(await postProcess(result, args, mock())).toEqual(result);
  expect(await readdir(directory)).toEqual(["shot.png"]);
});

test("an unreadable source preserves the screenshot result with an explicit annotation limitation", async () => {
  const { result } = await capture();
  await rm(result.path);
  const output = (await postProcess(result, {}, mock())) as typeof result & {
    reservedUi: { status: string; warning: string };
  };
  expect(output.path).toBe(result.path);
  expect(output.reservedUi.status).toBe("unavailable");
  expect(output.reservedUi.warning).toContain("ENOENT");
  expect(await attachImages(output)).toBeUndefined();
});

test("pre-cancellation does not create an annotated file", async () => {
  const { directory, result } = await capture();
  await expect(postProcess(result, {}, mock(), AbortSignal.abort(new Error("cancelled")))).rejects.toThrow("cancelled");
  expect(await readdir(directory)).toEqual(["shot.png"]);
});

test("the product tool returns the annotated image and strips hints at the RPC boundary", async () => {
  const { directory, result } = await capture();
  const callRpc = mock(async () => result);
  const tools = await createStudioRpcToolProvider({ callRpc }).createTools({ cwd: directory });
  const tool = tools.find((entry) => entry.name === "studiorpc_game_screenshot")!;
  const args = tool.parameters.parse({ hiddenCoreGui: ["JumpButton"] });
  const response = await tool.execute(args, {
    toolCallId: "shot",
    signal: new AbortController().signal,
    abort: () => {},
  });
  expect(callRpc).toHaveBeenCalledTimes(1);
  expect(callRpc).toHaveBeenCalledWith(
    "game.screenshot",
    { includeGui: true },
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  const output = JSON.parse(response.output);
  const annotated = await readFile(output.reservedUi.path);
  expect(response.outputImages?.[0].source.data).toBe(annotated.toString("base64"));
  expect(JSON.stringify(response.render)).toContain("Estimated mobile regions (red)");
  expect(output.path).toBe(result.path);
});

test("a missing annotated file falls back to the preserved raw preview", async () => {
  const { result } = await capture();
  const output = (await postProcess(result, {}, mock())) as { reservedUi: { path: string } };
  await rm(output.reservedUi.path);
  expect((await attachImages(output))?.[0].source.data).toBe(png.toString("base64"));
});
