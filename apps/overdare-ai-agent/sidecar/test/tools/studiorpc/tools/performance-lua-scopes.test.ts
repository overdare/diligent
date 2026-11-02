import { expect, test } from "bun:test";
import { summarizeLuaScopes } from "../../../../src/tools/studiorpc/tools/performance-report";

test("manual Lua summaries use completed invocations, preserve p50, and expose partial collection", () => {
  const metadata = { status: "partial", labels: ["AI.Step", "never closed"], unclosed: 1, dropped: 2 };
  const samples = [1, 10, 3].map((elapsed_ms) => ({
    labelId: 0,
    frameId: "99",
    beginMonotonicNs: "1",
    endMonotonicNs: "2",
    elapsed_ms,
  }));
  const rows = summarizeLuaScopes(samples, metadata);
  expect(rows[0]).toMatchObject({
    label: "AI.Step",
    n: 3,
    mean: 14 / 3,
    p50: 3,
    p95: 10,
    max: 10,
    status: "partial",
    unit: "ms",
    boundary: "completed_invocation",
  });
  expect(rows[1]).toMatchObject({ label: "never closed", n: 0, p50: null, status: "no_samples" });
  expect(summarizeLuaScopes([], undefined)).toEqual([]);
});
