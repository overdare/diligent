// @summary Elapsed goal time includes only current execution and clamps clock skew
import { expect, test } from "bun:test";
import { formatGoalDuration, goalElapsedMs } from "../../src/client/goal-format";

test("elapsed time includes a live run but no pause interval or negative clock skew", () => {
  expect(goalElapsedMs({ activeTimeMs: 2000, runStartedAt: 1000 }, 5000)).toBe(6000);
  expect(goalElapsedMs({ activeTimeMs: 2000 }, 5000)).toBe(2000);
  expect(goalElapsedMs({ activeTimeMs: 2000, runStartedAt: 6000 }, 5000)).toBe(2000);
  expect(formatGoalDuration(90_061_000)).toBe("1d 1h");
});
