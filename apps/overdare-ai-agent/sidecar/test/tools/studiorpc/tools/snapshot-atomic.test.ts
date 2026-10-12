// @summary Verifies snapshot files and metadata become visible atomically and never overwrite existing checkpoints.

import { afterEach, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  captureSnapshot,
  findLatestSnapshot,
  listSnapshots,
  nextRequestIndex,
  type SnapshotKind,
  snapshotsDir,
} from "../../../../src/tools/studiorpc/tools/snapshot";
import { summarizeSnapshot } from "../../../../src/tools/studiorpc/tools/snapshot-summary";

const dirs: string[] = [];

function project(): string {
  const cwd = mkdtempSync(join(tmpdir(), "snapshot-atomic-"));
  dirs.push(cwd);
  writeFileSync(join(cwd, "world.umap"), "world");
  writeFileSync(join(cwd, "world.ovdrjm"), '{"Root":{"Name":"original"}}');
  return cwd;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("snapshot files are owner-only even when the project is inside the OS temp directory", () => {
  const cwd = project();
  const path = captureSnapshot(cwd, "session", 0);

  if (process.platform !== "win32") {
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(path.replace(/\.ovdrjm$/, ".json")).mode & 0o777).toBe(0o600);
  }
});

test("snapshot copy preserves bytes across multiple read buffers", () => {
  const cwd = project();
  const bytes = Buffer.alloc(128 * 1024 + 3, 0x7f);
  writeFileSync(join(cwd, "world.ovdrjm"), bytes);

  const path = captureSnapshot(cwd, "session", 0);

  expect(readFileSync(path)).toEqual(bytes);
});

for (const kind of ["manual", "pre-rollback"] satisfies SnapshotKind[]) {
  test(`failed ${kind} metadata publication cannot become the default turn snapshot`, () => {
    const cwd = project();
    captureSnapshot(cwd, "session", 0, { kind: "turn" });
    const dir = snapshotsDir(cwd);
    const failedId = "session_1";
    const failedMetadata = join(dir, `${failedId}.json`);
    const originalWrite = fs.writeFileSync;
    const originalRename = fs.renameSync;
    const writeSpy = spyOn(fs, "writeFileSync").mockImplementation(((path, ...args) => {
      if (String(path) === failedMetadata) throw new Error("metadata write failed");
      return originalWrite(path, ...args);
    }) as typeof fs.writeFileSync);
    const renameSpy = spyOn(fs, "renameSync").mockImplementation((oldPath, newPath) => {
      if (String(newPath) === failedMetadata) throw new Error("metadata rename failed");
      return originalRename(oldPath, newPath);
    });

    try {
      expect(() => captureSnapshot(cwd, "session", 1, { kind })).toThrow("metadata");
    } finally {
      writeSpy.mockRestore();
      renameSpy.mockRestore();
    }

    expect(listSnapshots(cwd).map((entry) => entry.id)).toEqual(["session_0"]);
    expect(findLatestSnapshot(cwd).id).toBe("session_0");
    expect(readdirSync(dir).sort()).toEqual(["session_0.json", "session_0.ovdrjm"]);
  });
}

test("capture refuses to overwrite an already published snapshot id", () => {
  const cwd = project();
  const path = captureSnapshot(cwd, "session", 0, { kind: "turn", label: "original checkpoint" });
  const metadataPath = path.replace(/\.ovdrjm$/, ".json");
  const originalMap = readFileSync(path);
  const originalMetadata = readFileSync(metadataPath);
  writeFileSync(join(cwd, "world.ovdrjm"), '{"Root":{"Name":"replacement"}}');

  expect(() => captureSnapshot(cwd, "session", 0, { kind: "manual" })).toThrow(/already exists/i);
  expect(readFileSync(path)).toEqual(originalMap);
  expect(readFileSync(metadataPath)).toEqual(originalMetadata);
});

test("metadata left before the map commit reserves its snapshot index", () => {
  const cwd = project();
  const dir = snapshotsDir(cwd);
  fs.mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "session_4.json"), '{"id":"session_4"}');

  expect(nextRequestIndex(dir, "session")).toBe(5);
  const path = captureSnapshot(cwd, "session", nextRequestIndex(dir, "session"), { kind: "manual" });
  expect(path.endsWith("session_5.ovdrjm")).toBe(true);
  expect(readFileSync(join(dir, "session_4.json"), "utf8")).toBe('{"id":"session_4"}');
});

test("failed map publication removes the already published metadata sidecar", () => {
  const cwd = project();
  captureSnapshot(cwd, "session", 0, { kind: "turn" });
  const dir = snapshotsDir(cwd);
  const failedId = "session_1";
  const failedMap = join(dir, `${failedId}.ovdrjm`);
  const originalRename = fs.renameSync;
  const renameSpy = spyOn(fs, "renameSync").mockImplementation((oldPath, newPath) => {
    if (String(newPath) === failedMap) throw new Error("map rename failed");
    return originalRename(oldPath, newPath);
  });

  try {
    expect(() => captureSnapshot(cwd, "session", 1, { kind: "manual" })).toThrow("map rename failed");
  } finally {
    renameSpy.mockRestore();
  }

  expect(listSnapshots(cwd).map((entry) => entry.id)).toEqual(["session_0"]);
  expect(findLatestSnapshot(cwd).id).toBe("session_0");
  expect(readdirSync(dir).sort()).toEqual(["session_0.json", "session_0.ovdrjm"]);
});

test("failed summary metadata replacement leaves the published sidecar intact", async () => {
  const cwd = project();
  const path = captureSnapshot(cwd, "session", 0, {
    kind: "manual",
    label: "Manual checkpoint",
    summaryStatus: "pending",
  });
  const metadataPath = path.replace(/\.ovdrjm$/, ".json");
  const originalMetadata = readFileSync(metadataPath);
  const originalRename = fs.renameSync;
  const renameSpy = spyOn(fs, "renameSync").mockImplementation((oldPath, newPath) => {
    if (String(newPath) === metadataPath) throw new Error("metadata rename failed");
    return originalRename(oldPath, newPath);
  });

  try {
    await summarizeSnapshot({ ...listSnapshots(cwd)[0], path }, async () =>
      JSON.stringify({ label: "Generated", stateSummary: "Generated summary" }),
    );
  } finally {
    renameSpy.mockRestore();
  }

  expect(readFileSync(metadataPath)).toEqual(originalMetadata);
  expect(JSON.parse(readFileSync(metadataPath, "utf8"))).toMatchObject({
    kind: "manual",
    label: "Manual checkpoint",
    summaryStatus: "pending",
  });
  expect(readdirSync(snapshotsDir(cwd)).sort()).toEqual(["session_0.json", "session_0.ovdrjm"]);
});
