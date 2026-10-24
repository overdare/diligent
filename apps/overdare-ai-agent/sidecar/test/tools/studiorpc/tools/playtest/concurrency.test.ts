// @summary Promise concurrency evidence never substitutes for native physical execution proof.
import { expect, test } from "bun:test";
import { createConcurrencyTracker } from "../../../../../src/tools/studiorpc/tools/playtest/concurrency";

test("wait-only overlap and same-client overlap are not physical RPC pairs; native timing remains unknown", () => {
  const tracker = createConcurrencyTracker();
  const wait = tracker.inputStart(1, "peer", false, 0);
  const physical = tracker.inputStart(2, "main", true, 10);
  const sameClient = tracker.inputStart(3, "main", true, 20);
  wait(50, { status: "completed" });
  sameClient(60, { status: "completed" });
  physical(100, { status: "completed" });
  expect(tracker.summary()).toMatchObject({
    inputCallsMaxInFlight: 3,
    physicalRpcOverlapPairs: 0,
    nativeInputOverlapPairs: null,
    nativeExecutionTiming: "not_reported_by_transport",
  });
  const one = tracker.inputStart(4, "main", true, 110);
  const two = tracker.inputStart(5, "peer", true, 120);
  one(200, { status: "completed" });
  two(210); // failure/cancellation has no observed execution reply.
  const summary = tracker.summary();
  expect(summary.physicalRpcOverlapPairs).toBe(1);
  expect(summary.nativeInputOverlapPairs).toBeNull();
  expect(summary.inputTimings[4].executionReplyObservedAtMs).toBeUndefined();
});

test("timing storage is bounded and model counters finish idempotently", () => {
  const tracker = createConcurrencyTracker();
  const first = tracker.modelStart();
  const second = tracker.modelStart();
  first();
  first();
  second();
  const third = tracker.modelStart();
  third();
  for (let i = 0; i < 300; i++) tracker.inputStart(i, "main", true, i)(i + 1, { status: "completed" });
  expect(tracker.summary()).toMatchObject({
    modelRequestsMaxInFlight: 2,
    inputTimingsDropped: 44,
    physicalRpcOverlapPairs: 0,
  });
  expect(tracker.summary().inputTimings).toHaveLength(256);
});
