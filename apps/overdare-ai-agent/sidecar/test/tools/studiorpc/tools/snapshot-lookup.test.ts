// @summary Verifies direct snapshot ID lookup touches only the selected files and preserves metadata compatibility.

import { afterEach, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  captureSnapshot,
  findSnapshotById,
  listSnapshots,
  snapshotsDir,
} from "../../../../src/tools/studiorpc/tools/snapshot";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(): string {
  const cwd = mkdtempSync(join(tmpdir(), "snapshot-lookup-"));
  dirs.push(cwd);
  writeFileSync(join(cwd, "world.umap"), "world");
  writeFileSync(join(cwd, "world.ovdrjm"), '{"Root":{"Name":"Saved"}}');
  return cwd;
}

test("direct lookup stats the selected map and reads only its metadata without listing the directory", () => {
  const cwd = project();
  captureSnapshot(cwd, "other", 0);
  const path = captureSnapshot(cwd, "session_with_underscores", 3, { kind: "manual", userMessageId: "request" });
  const directorySpy = spyOn(fs, "readdirSync").mockImplementation(() => {
    throw new Error("Directory enumeration is forbidden for direct lookup");
  });
  const readSpy = spyOn(fs, "readFileSync");
  const statSpy = spyOn(fs, "statSync");
  try {
    expect(findSnapshotById(cwd, "session_with_underscores_3")).toMatchObject({
      id: "session_with_underscores_3",
      sessionId: "session_with_underscores",
      index: 3,
      path,
      kind: "manual",
      userMessageId: "request",
    });
    expect(directorySpy).not.toHaveBeenCalled();
    expect(statSpy.mock.calls.map((args) => args[0])).toEqual([path]);
    expect(readSpy.mock.calls.map((args) => args[0])).toEqual([path.replace(/\.ovdrjm$/, ".json")]);
  } finally {
    directorySpy.mockRestore();
    readSpy.mockRestore();
    statSpy.mockRestore();
  }
});

test("list and direct lookup preserve file-derived identity, metadata fields, and expired summary status", () => {
  const cwd = project();
  const path = captureSnapshot(cwd, "session", 2, { kind: "pre-rollback" });
  const metadataPath = path.replace(/\.ovdrjm$/, ".json");
  writeFileSync(
    metadataPath,
    JSON.stringify({
      ...JSON.parse(readFileSync(metadataPath, "utf8")),
      id: "wrong_99",
      sessionId: "wrong",
      index: 99,
      createdAt: "2020-01-01T00:00:00.000Z",
      label: "Saved state",
      userMessageId: "request",
      transcriptPath: join(cwd, "session.jsonl"),
      stateSummary: "A saved map",
      summaryStatus: "pending",
    }),
  );
  const entry = findSnapshotById(cwd, "session_2");
  expect(entry).toEqual(listSnapshots(cwd)[0]);
  expect(entry).toMatchObject({
    id: "session_2",
    sessionId: "session",
    index: 2,
    path,
    kind: "pre-rollback",
    label: "Saved state",
    userMessageId: "request",
    transcriptPath: join(cwd, "session.jsonl"),
    stateSummary: "A saved map",
    summaryStatus: "failed",
  });
  expect(entry).not.toHaveProperty("mtimeMs");
  expect(JSON.parse(readFileSync(metadataPath, "utf8")).summaryStatus).toBe("pending");
});

test.each([undefined, "{invalid json"])("direct lookup preserves legacy fallback for metadata %j", (metadata) => {
  const cwd = project();
  const dir = snapshotsDir(cwd);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "old_session_4.ovdrjm");
  writeFileSync(path, "{}");
  if (metadata !== undefined) writeFileSync(join(dir, "old_session_4.json"), metadata);
  utimesSync(path, new Date("2020-01-01T00:00:00Z"), new Date("2020-01-01T00:00:00Z"));
  const entry = findSnapshotById(cwd, "old_session_4");
  expect(entry).toEqual({
    id: "old_session_4",
    sessionId: "old_session",
    index: 4,
    path,
    kind: "turn",
    createdAt: new Date(statSync(path).mtimeMs).toISOString(),
  });
  expect(entry).toEqual(listSnapshots(cwd)[0]);
});

test.each([
  ["old_session_01", 1],
  ["old_session_1e2", 100],
] as const)("preserves legacy numeric suffix parsing for %s", (id, index) => {
  const cwd = project();
  const dir = snapshotsDir(cwd);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.ovdrjm`), "{}");
  expect(findSnapshotById(cwd, id)).toMatchObject({ id, sessionId: "old_session", index });
});

test.each([
  "../outside_0",
  "nested/session_0",
  "nested\\session_0",
  "/outside_0",
  "C:session_0",
  "session_0\0",
  "session_1.5",
  "session_text",
  "_0",
  "noSeparator",
])("rejects invalid snapshot ID %j before filesystem access", (id) => {
  const cwd = project();
  const directorySpy = spyOn(fs, "readdirSync");
  const readSpy = spyOn(fs, "readFileSync");
  const statSpy = spyOn(fs, "statSync");
  try {
    expect(() => findSnapshotById(cwd, id)).toThrow(/not found/);
    expect(directorySpy).not.toHaveBeenCalled();
    expect(readSpy).not.toHaveBeenCalled();
    expect(statSpy).not.toHaveBeenCalled();
  } finally {
    directorySpy.mockRestore();
    readSpy.mockRestore();
    statSpy.mockRestore();
  }
});

test("metadata without a committed map remains unavailable and is not read", () => {
  const cwd = project();
  const dir = snapshotsDir(cwd);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "session_1.json"), '{"id":"session_1","kind":"manual"}');
  const readSpy = spyOn(fs, "readFileSync");
  try {
    expect(() => findSnapshotById(cwd, "session_1")).toThrow(/not found/);
    expect(readSpy).not.toHaveBeenCalled();
  } finally {
    readSpy.mockRestore();
  }
});

test("a directory named like a map is not a snapshot", () => {
  const cwd = project();
  mkdirSync(join(snapshotsDir(cwd), "session_0.ovdrjm"), { recursive: true });
  expect(() => findSnapshotById(cwd, "session_0")).toThrow(/not found/);
  expect(listSnapshots(cwd)).toEqual([]);
});

test.each([
  "EACCES",
  "EIO",
  "ENOTDIR",
])("map stat error %s propagates instead of reporting a missing snapshot", (code) => {
  const cwd = project();
  captureSnapshot(cwd, "session", 0);
  const denied = Object.assign(new Error("map stat failed"), { code });
  const statSpy = spyOn(fs, "statSync").mockImplementation(() => {
    throw denied;
  });
  try {
    expect(() => findSnapshotById(cwd, "session_0")).toThrow(denied);
  } finally {
    statSpy.mockRestore();
  }
});
