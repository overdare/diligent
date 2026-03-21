// @summary Unit tests for pure ThreadStore event reducer transitions
import { describe, expect, test } from "bun:test";
import { reduceThreadStoreEvent, type ThreadEventReducerState } from "../../../src/tui/components/thread-event-reducer";

type TestItem = { id: string };

function createState(overrides?: Partial<ThreadEventReducerState<TestItem>>): ThreadEventReducerState<TestItem> {
  return {
    items: [],
    thinkingStartTime: null,
    thinkingText: "",
    overlayStatus: null,
    statusBeforeCompaction: null,
    isThreadBusy: false,
    busyStartedAt: null,
    lastUsage: null,
    ...overrides,
  };
}

describe("reduceThreadStoreEvent", () => {
  test("handles status_change busy by setting busyStartedAt once", () => {
    const nowMs = 1700000000000;
    const first = reduceThreadStoreEvent(
      createState(),
      { type: "status_change", status: "busy" },
      {
        nowMs,
        buildCompactionItem: () => ({ id: "compaction" }),
        buildKnowledgeSavedItem: () => ({ id: "knowledge" }),
        buildErrorItem: () => ({ id: "error" }),
      },
    );

    expect(first.handled).toBe(true);
    expect(first.requestRender).toBe(true);
    expect(first.state.isThreadBusy).toBe(true);
    expect(first.state.busyStartedAt).toBe(nowMs);

    const second = reduceThreadStoreEvent(
      first.state,
      { type: "status_change", status: "busy" },
      {
        nowMs: nowMs + 999,
        buildCompactionItem: () => ({ id: "compaction" }),
        buildKnowledgeSavedItem: () => ({ id: "knowledge" }),
        buildErrorItem: () => ({ id: "error" }),
      },
    );
    expect(second.state.busyStartedAt).toBe(nowMs);
  });

  test("handles compaction_end by restoring previous overlay and appending item", () => {
    const result = reduceThreadStoreEvent(
      createState({
        overlayStatus: { message: "Compacting…", kind: "default", startedAt: 1000 },
        statusBeforeCompaction: "Thinking…",
      }),
      { type: "compaction_end", summary: "trimmed", tokensBefore: 4000, tokensAfter: 1800 },
      {
        nowMs: 2000,
        buildCompactionItem: () => ({ id: "compaction-item" }),
        buildKnowledgeSavedItem: () => ({ id: "knowledge" }),
        buildErrorItem: () => ({ id: "error" }),
      },
    );

    expect(result.handled).toBe(true);
    expect(result.state.statusBeforeCompaction).toBeNull();
    expect(result.state.overlayStatus?.message).toBe("Thinking…");
    expect(result.state.items).toEqual([{ id: "compaction-item" }]);
  });

  test("routes message_start via delegate without direct state change", () => {
    const initial = createState();
    const result = reduceThreadStoreEvent(
      initial,
      { type: "message_start" },
      {
        nowMs: 1,
        buildCompactionItem: () => ({ id: "compaction" }),
        buildKnowledgeSavedItem: () => ({ id: "knowledge" }),
        buildErrorItem: () => ({ id: "error" }),
      },
    );

    expect(result.handled).toBe(true);
    expect(result.requestRender).toBe(false);
    expect(result.delegate?.kind).toBe("message_start");
    expect(result.state).toBe(initial);
  });
});
