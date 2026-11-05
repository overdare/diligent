// @summary Verifies diagnostics turn run-ending adapter faults into concrete next checks.
import { expect, test } from "bun:test";
import { createDiagnosticsTracker } from "../../../../../src/tools/studiorpc/tools/playtest/diagnostics";

const stats = {
  elapsedMs: 0,
  observations: 0,
  observationErrors: 0,
  modelCalls: 0,
  decisions: 0,
  dispatchedActions: 0,
  invalidatedChoices: 0,
  gameEventsEmitted: 0,
  duplicateGameEvents: 0,
  statusChecks: 0,
  traceEvents: 0,
  traceEventsDropped: 0,
  logCallbackErrors: 0,
  maxObserveLatencyMs: 0,
  maxObservationAgeMs: 0,
};
const verification = { status: "not_declared" } as never;

test("a progress sequence regression names the monotonic counter fix", () => {
  const tracker = createDiagnosticsTracker();
  const { hints } = tracker.summary({
    outcome: "error",
    reason: "adapter progress sequence regressed (0 < 59)",
    stats,
    verification,
  });
  expect(hints.some((hint) => /monotonic counter/.test(hint) && /respawn/.test(hint))).toBe(true);
});

test("other errors do not get the progress sequence hint", () => {
  const tracker = createDiagnosticsTracker();
  const { hints } = tracker.summary({
    outcome: "error",
    reason: "adapter revision regressed (1 < 2)",
    stats,
    verification,
  });
  expect(hints.some((hint) => /monotonic counter/.test(hint))).toBe(false);
});
