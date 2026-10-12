// @summary Independent session cursors, root-group filtering, and bounded RAM expiration
import { expect, test } from "bun:test";
import type { EditLogEnvelope } from "../../../src/tools/studiorpc/tools/edit-log";
import { StudioChangeStore } from "../../../src/tools/studiorpc/tools/studio-change-store";

const a = { sessionId: "A", rootSessionId: "A", resumed: false };
const b = { sessionId: "B", rootSessionId: "B", resumed: false };
const child = { sessionId: "A1", rootSessionId: "A", resumed: false };
const entry = (guid: string, sessionId?: string, kind = "mcp"): EditLogEnvelope => ({
  timestamp: "now",
  subjectGuids: [guid],
  origin: sessionId ? { kind, sessionId } : undefined,
  objects: [{ guid, name: guid, type: "Part", changes: [{ property: "Name", before: "old", after: guid }] }],
});

test("acknowledgment advances only the consumer and never beyond the captured high-water", () => {
  const store = new StudioChangeStore();
  store.append([entry("first")]);
  const capture = store.read(a);
  store.append([entry("second")]);
  capture.acknowledge();
  expect(store.read(a).envelopes.map((e) => e.objects[0].guid)).toEqual(["second"]);
  expect(store.read(b).envelopes.map((e) => e.objects[0].guid)).toEqual(["first", "second"]);
  const newer = store.read(a);
  newer.acknowledge();
  capture.acknowledge();
  expect(store.read(a).envelopes).toEqual([]);
});

test("root descendants are hidden only from their own group and child queries do not acknowledge the parent", () => {
  const store = new StudioChangeStore();
  const release = store.registerSession(child);
  store.append([entry("child", "A1"), entry("legacy"), entry("mixed", "A", "mixed"), entry("other", "B")]);
  store.read(child).acknowledge();
  expect(store.read(a).envelopes.map((e) => e.objects[0].guid)).toEqual(["legacy", "mixed", "other"]);
  expect(store.read(b).envelopes.map((e) => e.objects[0].guid)).toEqual(["child", "legacy", "mixed"]);
  release();
});

test("eviction ignores abandoned markers and explicitly expires partial batches", () => {
  const store = new StudioChangeStore({ limits: { maxRecords: 2 } });
  store.read(b);
  store.append([entry("first"), entry("second")]);
  const batch = store.read(a).batchId!;
  store.append([entry("third")]);
  expect(store.read(b).gaps.join(" ")).toMatch(/history|retained/i);
  expect(() => store.readBatch(batch, a)).toThrow(/expired/i);
  expect(store.read(b).envelopes.map((e) => e.objects[0].guid)).toEqual(["second", "third"]);
});

test("byte bounds, marker eviction, identity eviction and batch limits are independent", () => {
  const store = new StudioChangeStore({ limits: { maxBytes: 1, maxConsumers: 1, maxIdentities: 1, maxBatches: 1 } });
  store.append([entry("oversized")]);
  expect(store.read(a).envelopes).toEqual([]);
  expect(store.read(a).gaps.length).toBeGreaterThan(0);
  const one = new StudioChangeStore({ limits: { maxConsumers: 1, maxBatches: 1 } });
  one.append([entry("external")]);
  const old = one.read(a).batchId!;
  one.read(b).acknowledge();
  expect(one.read(a).gaps.length).toBeGreaterThan(0);
  expect(() => one.readBatch(old, a)).toThrow(/expired/i);
  const identities = new StudioChangeStore({ limits: { maxIdentities: 1 } });
  identities.registerSession(child)();
  identities.append([entry("child", "A1")]);
  identities.registerSession(b)();
  expect(identities.read(a).envelopes).toEqual([]);
});

test("resumed sessions and explicit gaps remain visible with no edit envelopes", () => {
  const store = new StudioChangeStore();
  const consumer = { ...a, resumed: true };
  const read = store.read(consumer);
  expect(read.gaps.join(" ")).toMatch(/restart|RAM/i);
  read.acknowledge();
  expect(store.read(consumer).gaps).toEqual([]);
  store.recordGap("Malformed source input; inspect current Studio state.");
  expect(store.read(b).gaps.join(" ")).toContain("Malformed");
  expect(() => store.readBatch("previous-process", b)).toThrow(/expired/i);
});

test("active capacity rejects admission and detail reads do not acknowledge changes", () => {
  const store = new StudioChangeStore({ limits: { maxConsumers: 1, maxIdentities: 1 } });
  const release = store.registerSession(a);
  expect(() => store.registerSession(b)).toThrow(/capacity/i);
  store.append([entry("external")]);
  const capture = store.read(a);
  expect(store.readBatch(capture.batchId!, a)).toHaveLength(1);
  expect(store.read(a).envelopes).toHaveLength(1);
  expect(() => store.readBatch(capture.batchId!, b)).toThrow(/consumer/i);
  release();
  store.registerSession(b)();
});
