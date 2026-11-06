// @summary Verifies map-wide preservation comparisons through the shared immutable snapshot tool.
import { afterEach, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as fsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStudioRpcToolProvider } from "../../../../src/tools/studiorpc";
import { snapshotsDir } from "../../../../src/tools/studiorpc/tools/snapshot";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const context = () => ({ toolCallId: "preservation", signal: new AbortController().signal, abort() {} });
const node = (ActorGuid: string, properties: Record<string, unknown> = {}) => ({
  ActorGuid,
  Name: ActorGuid,
  InstanceType: "Part",
  ...properties,
});
const map = (...children: Record<string, unknown>[]) => ({ Root: node("root", { LuaChildren: children }) });
const hash = (source: string) => createHash("sha256").update(source).digest("hex");

async function setup(before: unknown, after: unknown, utf16 = false) {
  const cwd = mkdtempSync(join(tmpdir(), "snapshot-diff-"));
  dirs.push(cwd);
  const dir = snapshotsDir(cwd);
  mkdirSync(dir, { recursive: true });
  const paths = [join(dir, "session_0.ovdrjm"), join(dir, "session_1.ovdrjm")];
  for (const [index, document] of [before, after].entries()) {
    const text = JSON.stringify(document);
    writeFileSync(
      paths[index],
      utf16 ? Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]) : text,
    );
    writeFileSync(
      join(dir, `session_${index}.json`),
      JSON.stringify({
        createdAt: "2026-01-01T00:00:00.000Z",
        kind: index === 0 ? "turn" : "manual",
      }),
    );
  }
  const rpcCalls: string[] = [];
  const provider = createStudioRpcToolProvider({
    callRpc: async (method) => {
      rpcCalls.push(method);
      throw new Error("Immutable comparison must not call Studio");
    },
  });
  const tool = (await provider.createTools({ cwd })).find((value) => value.name === "studiorpc_snapshot_context")!;
  const execute = (args: Record<string, unknown> = {}) =>
    tool.execute(
      {
        snapshotId: "session_0",
        view: "diff",
        compareToSnapshotId: "session_1",
        ...args,
      },
      context(),
    );
  const diff = async (args: Record<string, unknown> = {}) => JSON.parse((await execute(args)).output);
  return { cwd, paths, tool, execute, diff, rpcCalls };
}

test("geometry, Enabled and non-writable stored properties are compared without Studio or a live map", async () => {
  const before = map(
    node("part", { Position: { X: 1, Y: 2 }, WorldTransform: { X: 1 }, UnknownStored: 1 }),
    node("script", { InstanceType: "Script", Enabled: false, Source: "print(1)\r\n" }),
  );
  const after = map(
    node("part", { Position: { X: 3, Y: 2 }, WorldTransform: { X: 3 }, UnknownStored: "1" }),
    node("script", { InstanceType: "Script", Enabled: true, Source: "print(1)\r\n" }),
  );
  const { diff, cwd, rpcCalls } = await setup(before, after, true);
  const output = await diff();
  expect(output.snapshot.id).toBe("session_0");
  expect(output.compareToSnapshot.id).toBe("session_1");
  expect(output.data.counts).toEqual({ added: 0, removed: 0, changed: 2, unchanged: 1 });
  expect(output.data.changes.map((change: { changedProperties: string[] }) => change.changedProperties)).toEqual([
    ["Position", "UnknownStored", "WorldTransform"],
    ["Enabled"],
  ]);
  expect(output.data.changes[1].sourceSha256).toEqual({ before: hash("print(1)\r\n"), after: hash("print(1)\r\n") });
  writeFileSync(join(cwd, "world.umap"), "unrelated live map");
  writeFileSync(join(cwd, "world.ovdrjm"), "invalid live JSON");
  expect((await diff()).data).toEqual(output.data);
  rmSync(join(cwd, "world.umap"));
  rmSync(join(cwd, "world.ovdrjm"));
  expect((await diff()).data).toEqual(output.data);
  expect(rpcCalls).toEqual([]);
});

test("Source-only changes retain exact line-ending evidence as SHA-256, never source text", async () => {
  const before = "local secret = 'before'\r\n";
  const after = "local secret = 'before'\n";
  const { diff, execute } = await setup(
    map(node("script", { Source: before })),
    map(node("script", { Source: after })),
  );
  const { data } = await diff();
  expect(data.counts).toEqual({ added: 0, removed: 0, changed: 1, unchanged: 1 });
  expect(data.changes[0]).toMatchObject({
    guid: "script",
    status: "changed",
    changedFields: [],
    changedProperties: ["Source"],
    sourceSha256: { before: hash(before), after: hash(after) },
  });
  expect((await execute()).output).not.toContain("local secret");
});

test("stable GUIDs distinguish moves, renames, class changes, additions and removals", async () => {
  const before = map(node("parent", { LuaChildren: [node("moved")] }), node("removed", { Source: "old" }));
  const after = map(
    node("moved", { Name: "Renamed", InstanceType: "Model" }),
    node("parent"),
    node("added", { Source: "new" }),
  );
  const { diff } = await setup(before, after);
  const { data } = await diff();
  expect(data.counts).toEqual({ added: 1, removed: 1, changed: 1, unchanged: 2 });
  expect(data.changes.map((change: { guid: string }) => change.guid)).toEqual(["added", "moved", "removed"]);
  expect(data.changes[1]).toMatchObject({
    status: "changed",
    changedFields: ["name", "class", "parentGuid"],
    before: { name: "moved", class: "Part", parentGuid: "parent" },
    after: { name: "Renamed", class: "Model", parentGuid: "root" },
    changedProperties: [],
  });
  expect(data.changes[0].sourceSha256).toEqual({ before: null, after: hash("new") });
  expect(data.changes[2].sourceSha256).toEqual({ before: hash("old"), after: null });
  const reverse = (await diff({ snapshotId: "session_1", compareToSnapshotId: "session_0" })).data;
  expect(reverse.changes[0].status).toBe("removed");
  expect(reverse.changes[2].status).toBe("added");
});

test("object key order, metadata and child order are ignored but array order, types and missing values matter", async () => {
  const before = map(
    node("same", { ObjectKey: "old", Parent: "ignored", Value: { b: [1, { x: 2, y: 3 }], a: null } }),
    node("array", { Value: [1, 2] }),
    node("type", { Value: 1 }),
    node("missing", { Value: null }),
  );
  const after = map(
    node("missing"),
    node("type", { Value: "1" }),
    node("array", { Value: [2, 1] }),
    node("same", { ObjectKey: "new", Parent: "different", Value: { a: null, b: [1, { y: 3, x: 2 }] } }),
  );
  const { diff } = await setup(before, after);
  const { data } = await diff();
  expect(data.counts).toEqual({ added: 0, removed: 0, changed: 3, unchanged: 2 });
  expect(data.changes.map((change: { guid: string }) => change.guid)).toEqual(["array", "missing", "type"]);
  expect(
    data.changes.every((change: { changedProperties: string[] }) => change.changedProperties.join() === "Value"),
  ).toBe(true);
});

test("unchanged maps and out-of-range offsets distinguish a clean diff from an empty page", async () => {
  const document = map(node("part"));
  const clean = await setup(document, document);
  expect((await clean.diff()).data).toMatchObject({
    view: "diff",
    units: "changes",
    total: 0,
    changes: [],
    counts: { added: 0, removed: 0, changed: 0, unchanged: 2 },
  });
  const changed = await setup(document, map(node("part", { Enabled: true })));
  const { data } = await changed.diff({ offset: 10 });
  expect(data.changes).toEqual([]);
  expect(data.total).toBe(1);
  expect(data.counts.changed).toBe(1);
  expect(data.nextOffset).toBeUndefined();
});

test("byte-limited deterministic pagination preserves every full change and parses each map only once per call", async () => {
  const children = Array.from({ length: 205 }, (_, index) =>
    node(`part-${String(index).padStart(3, "0")}`, {
      Name: "\uAC00".repeat(300),
      Enabled: false,
    }),
  );
  const { diff, execute, paths } = await setup(
    map(...children),
    map(...children.map((child) => ({ ...child, Enabled: true }))),
  );
  const readSpy = spyOn(fsPromises, "readFile");
  const changes: Array<{ guid: string; before: { name: string } }> = [];
  let offset: number | undefined = 0;
  try {
    while (offset !== undefined) {
      readSpy.mockClear();
      const result = await execute({ offset, limit: 8000 });
      expect(Buffer.byteLength(result.output)).toBeLessThanOrEqual(40_000);
      const { data } = JSON.parse(result.output);
      expect(data.total).toBe(205);
      expect(data.changes.length).toBeLessThanOrEqual(200);
      expect(data.changes.length).toBeGreaterThan(0);
      expect(readSpy.mock.calls.map((args) => args[0]).sort()).toEqual([...paths].sort());
      changes.push(...data.changes);
      if (data.nextOffset !== undefined) expect(data.nextOffset).toBeGreaterThan(offset);
      offset = data.nextOffset;
    }
  } finally {
    readSpy.mockRestore();
  }
  expect(changes.map((change) => change.guid)).toEqual(children.map((child) => child.ActorGuid));
  expect(changes.every((change) => change.before.name === "\uAC00".repeat(300))).toBe(true);
  expect((await diff({ limit: 1 })).data.changes).toEqual(changes.slice(0, 1));
});

test.each([
  "identity",
  "properties",
])("an oversized %s fails explicitly instead of truncating preservation evidence", async (kind) => {
  const properties = Object.fromEntries(Array.from({ length: 3000 }, (_, i) => [`property-${i}`, true]));
  const before = kind === "identity" ? map(node("x".repeat(45_000))) : map(node("part"));
  const after = kind === "identity" ? map(node("x".repeat(45_000), { Enabled: true })) : map(node("part", properties));
  const { execute } = await setup(before, after);
  const result = await execute();
  expect(Buffer.byteLength(result.output)).toBeLessThanOrEqual(40_000);
  expect(result.metadata?.error).toBe(true);
  expect(JSON.parse(result.output).data).toBeUndefined();
  expect(JSON.parse(result.output).dataError).toContain("output limit");
});

test.each([
  { Root: null },
  { Root: {} },
  map(node("")),
  map({ ActorGuid: 12 }),
  map(node("duplicate"), node("duplicate")),
  map(node("root")),
  { Root: node("root", { LuaChildren: [null] }) },
  { Root: node("root", { LuaChildren: {} }) },
  map(node("bad-source", { Source: 123 })),
  map(node("bad-name", { Name: {} })),
])("invalid saved maps never produce a preservation pass: %j", async (invalid) => {
  const { execute } = await setup(map(), invalid);
  for (const args of [{}, { snapshotId: "session_1", compareToSnapshotId: "session_0" }]) {
    const result = await execute(args);
    expect(result.metadata?.error).toBe(true);
    expect(JSON.parse(result.output).data).toBeUndefined();
    expect(JSON.parse(result.output).dataError).toBeString();
  }
});

test("malformed JSON is an explicit data error", async () => {
  const { paths, execute } = await setup(map(), map());
  writeFileSync(paths[1], "{broken");
  const result = await execute();
  expect(result.metadata?.error).toBe(true);
  expect(JSON.parse(result.output).dataError).toContain("Invalid snapshot .ovdrjm JSON");
});

test.each([
  "../outside_0",
  "nested/session_0",
  "nested\\session_0",
  "C:session_0",
  "session_0\0",
  "missing_0",
])("both snapshot IDs use safe direct lookup: %j", async (id) => {
  const { execute } = await setup(map(), map());
  const directorySpy = spyOn(fs, "readdirSync");
  const readSpy = spyOn(fsPromises, "readFile");
  try {
    for (const args of [{ snapshotId: id }, { compareToSnapshotId: id }]) {
      const result = await execute(args);
      expect(result.metadata?.error).toBe(true);
      expect(result.output).toContain("not found");
    }
    expect(directorySpy).not.toHaveBeenCalled();
    expect(readSpy).not.toHaveBeenCalled();
  } finally {
    directorySpy.mockRestore();
    readSpy.mockRestore();
  }
});

test.each([
  { view: "diff", compareToSnapshotId: undefined },
  { view: "diff", guid: "root" },
  { view: "tree" },
  { view: "instance", guid: "root" },
  { view: "script", guid: "root" },
])("rejects ambiguous comparison arguments: %j", async (args) => {
  const { execute } = await setup(map(), map());
  const result = await execute(args);
  expect(result.metadata?.error).toBe(true);
  expect(result.output).toMatch(/compareToSnapshotId|guid/);
});
