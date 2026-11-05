// @summary Verifies real pixel acquisition, mapped paths and owned-client provenance.
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createVisualObserver,
  resolveScreenshotPath,
} from "../../../../../src/tools/studiorpc/tools/playtest/visual-observation";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN9sAAAAASUVORK5CYII=",
  "base64",
);
const target = { pieSessionId: "p", clientId: "c" };
const state = { revision: 12 } as never;
const status = { running: true, pieSessionId: "p", clients: [{ clientId: "c", injectable: true, targeted: true }] };

test("maps Windows captures only within configured shared roots", () => {
  expect(
    resolveScreenshotPath("C:\\captures\\one.png", { remoteRoot: "C:\\captures", localRoot: "/mnt/captures" }),
  ).toBe("/mnt/captures/one.png");
  expect(() =>
    resolveScreenshotPath("C:\\private\\one.png", { remoteRoot: "C:\\captures", localRoot: "/mnt/captures" }),
  ).toThrow(/outside|root/i);
  expect(() =>
    resolveScreenshotPath("C:\\captures\\..\\private.png", { remoteRoot: "C:\\captures", localRoot: "/mnt/captures" }),
  ).toThrow();
  if (process.platform !== "win32")
    expect(() => resolveScreenshotPath("C:\\captures\\one.png", {})).toThrow(/mapping|host/i);
  expect(() => resolveScreenshotPath("relative.png", {})).toThrow(/absolute/i);
});

test("captures GUI pixels for the owned sole target, persists an artifact and returns metadata separately", async () => {
  const dir = await mkdtemp(join(tmpdir(), "playtest-vision-"));
  dirs.push(dir);
  const file = join(dir, "one.png");
  await writeFile(file, png);
  const calls: string[] = [];
  const clock = { now: () => 123 };
  const capture = createVisualObserver({
    clock,
    directory: dir,
    callRpc: async (method, args) => {
      calls.push(method);
      if (method === "game.pie.status") return status;
      if (method === "game.screenshot") {
        expect(args).toEqual({ includeGui: true });
        return { success: true, path: file, image: { width: 1, height: 1 }, camera: { fieldOfView: 90 } };
      }
      throw Error(method);
    },
  });
  const result = await capture(state, new AbortController().signal, target);
  expect(calls).toEqual(["game.pie.status", "game.screenshot", "game.pie.status"]);
  expect(result.dataUrl).toBe(`data:image/png;base64,${png.toString("base64")}`);
  expect(result.metadata).toMatchObject({ ...target, stateRevision: 12, capturedAtMs: 123, width: 1, height: 1 });
  expect(result.metadata.sha256).toHaveLength(64);
  expect(JSON.stringify(result.metadata)).not.toContain("base64");
  expect(await Bun.file(result.metadata.artifactPath!).arrayBuffer()).toEqual(
    png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
  );
});

test("wrong or ambiguous client prevents capture", async () => {
  for (const s of [
    { ...status, pieSessionId: "other" },
    { ...status, clients: [...status.clients, { clientId: "other", injectable: true }] },
  ]) {
    let captures = 0;
    const read = createVisualObserver({
      callRpc: async (method) => {
        if (method === "game.screenshot") captures++;
        return s;
      },
    });
    await expect(read(state, new AbortController().signal, target)).rejects.toThrow(/session|client/i);
    expect(captures).toBe(0);
  }
});

test("capture rejects a changed session, missing files, invalid PNG and dimension mismatch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "playtest-vision-"));
  dirs.push(dir);
  const file = join(dir, "bad.png");
  await writeFile(file, "not an image");
  for (const mode of ["changed", "missing", "invalid", "dimensions"]) {
    let checks = 0;
    const read = createVisualObserver({
      callRpc: async (method) => {
        if (method === "game.pie.status")
          return mode === "changed" && ++checks > 1 ? { ...status, pieSessionId: "other" } : status;
        return {
          success: true,
          path: mode === "missing" ? join(dir, "missing.png") : file,
          image: { width: 2, height: 1 },
        };
      },
    });
    if (mode === "dimensions") await writeFile(file, png);
    await expect(read(state, new AbortController().signal, target)).rejects.toThrow();
  }
});
