import { describe, expect, test } from "bun:test";
import { compareReports, summarize, summarizeFrames } from "../../../../src/tools/studiorpc/tools/performance-report";

describe("performance summaries", () => {
  test("uses nearest rank, preserves zero, and always includes p50 for missing data", () => {
    expect(summarize([0, 1, 2, 100, Number.NaN, -1])).toEqual({ n: 4, mean: 25.75, p50: 1, p95: 100, max: 100 });
    expect(summarize([])).toEqual({ n: 0, mean: null, p50: null, p95: null, max: null });
  });

  test("excludes invalid scopes without discarding the completed frame interval", () => {
    const result = summarizeFrames(
      [
        {
          frameId: "1",
          beginMonotonicNs: "1",
          endMonotonicNs: "2",
          frame_ms: 10,
          lua_machine_ms: 0,
          slate_gt_ms: null,
          validity: { slate_gt_ms: "scope_crossed_frame" },
        },
        {
          frameId: "2",
          beginMonotonicNs: "2",
          endMonotonicNs: "3",
          frame_ms: 30,
          lua_machine_ms: 4,
          slate_gt_ms: 2,
          validity: {},
        },
      ],
      {},
    );
    expect(result.summaries.frame_ms.p50).toBe(10);
    expect(result.summaries.lua_machine_ms.mean).toBe(2);
    expect(result.summaries.slate_gt_ms.n).toBe(1);
    expect(result.averageFps).toBe(50);
  });

  test("withholds deltas for unknown or differing conditions and keeps a zero baseline absolute delta", () => {
    const report = {
      case: "idle",
      conditions: {
        build: "shipping",
        resolution: "1920x1080",
        quality: "high",
        frameCap: "60",
        load: "1 player",
        scope: "process",
        coverage: "v1",
      },
      summaries: { frame_ms: { ...summarize([0]), unit: "ms", scope: "process", status: "ok" } },
    };
    expect(
      compareReports({ ...report, summaries: { frame_ms: { ...report.summaries.frame_ms, p50: 2 } } }, report, "base")
        .deltas?.frame_ms?.p50,
    ).toEqual({ absolute: 2, percent: null });
    expect(
      compareReports({ ...report, conditions: { ...report.conditions, load: "2 players" } }, report, "base").status,
    ).toBe("conditions_differ");
    expect(compareReports({ ...report, conditions: {} }, report, "base").status).toBe("insufficient_metadata");
  });
});
