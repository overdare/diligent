// @summary Tests for extracted app runtime state timing and steering helpers
import { describe, expect, test } from "bun:test";
import { AppRuntimeState } from "../../src/tui/app-runtime-state";

describe("AppRuntimeState", () => {
  test("queues and consumes pending steers", () => {
    const state = new AppRuntimeState("default", "medium");
    state.queuePendingSteer("first");
    state.queuePendingSteer("second");

    expect(state.consumePendingSteersByText(["second"])).toEqual(["second"]);
    expect(state.pendingSteers).toEqual(["first"]);
    expect(state.consumePendingSteersFallback(1)).toEqual(["first"]);
  });

  test("consumes matching steering texts without fallback", () => {
    const state = new AppRuntimeState("default", "medium");
    state.queuePendingSteer("change approach");

    expect(state.consumePendingSteersByText(["change approach"])).toEqual(["change approach"]);
    expect(state.pendingSteers).toEqual([]);
    expect(state.consumePendingSteersFallback(0)).toEqual([]);
  });

  test("drains pending steers", () => {
    const state = new AppRuntimeState("default", "medium");
    state.queuePendingSteer("first");
    state.queuePendingSteer("second");

    expect(state.drainPendingSteers()).toEqual(["first", "second"]);
    expect(state.pendingSteers).toHaveLength(0);
  });

  test("tracks reasoning timing lifecycle", () => {
    const state = new AppRuntimeState("default", "medium");
    state.beginTurnTiming();
    state.noteThinkingDelta();
    expect(state.turnStartedAtMs).not.toBeNull();
    expect(state.reasoningStartedAtMs).not.toBeNull();

    state.noteTextDelta();
    expect(state.reasoningStartedAtMs).toBeNull();
    expect(state.reasoningAccumulatedMs).toBeGreaterThanOrEqual(0);
  });
});
