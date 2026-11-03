// @summary Viewer selection, missing measurements, all labels, offline errors and integer-clock precision.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({ url: "http://localhost/thread-1" });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { afterAll, expect, test } from "bun:test";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { PerformanceViewer } from "../../../../src/web/client/components/PerformanceViewer";
import { relativeMilliseconds } from "../../../../src/web/client/lib/performance-view";
import { PerformanceViewSchema } from "../../../../src/web/shared/performance-protocol";

afterAll(() => {
  void GlobalRegistrator.unregister();
});
const data = PerformanceViewSchema.parse({
  schemaVersion: 1,
  report: {
    jobId: "perf-00000000-0000-0000-0000-000000000001",
    case: "Idle",
    state: "partial",
    scenarioOutcome: "unverified",
    summaries: { frame_ms: { n: 2, mean: 20, p50: 10, p95: 30, max: 30, status: "ok", unit: "ms" } },
    averageFps: 50,
    conditions: {},
    quality: { dropped: 2 },
    missingMetrics: ["slate_gt_ms"],
    latestObserved: {},
  },
  frames: [
    {
      frameId: "1",
      beginMonotonicNs: "99999999999999999",
      endMonotonicNs: "100000000009999999",
      frame_ms: 10,
      lua_machine_ms: 0,
      slate_gt_ms: null,
      validity: {},
    },
    {
      frameId: "2",
      beginMonotonicNs: "100000000009999999",
      endMonotonicNs: "100000000039999999",
      frame_ms: 30,
      lua_machine_ms: 2,
      slate_gt_ms: null,
      validity: {},
    },
  ],
  luaScopes: [
    {
      frameId: "2",
      labelId: 9,
      beginMonotonicNs: "100000000010999999",
      endMonotonicNs: "100000000012999999",
      elapsed_ms: 2,
    },
  ],
  luaSummaries: Array.from({ length: 10 }, (_, labelId) => ({
    labelId,
    label: `label-${labelId}`,
    n: 1,
    mean: 2,
    p50: 2,
    p95: 2,
    max: 2,
    total_ms: 2,
    unit: "ms",
    status: "ok",
    boundary: "completed_invocation",
  })),
  processSamples: [],
  processes: [],
});

test("subtracts native integer origin before number conversion", () => {
  expect(relativeMilliseconds("100000000000000001", "100000000000000000")).toBe(0.000001);
});

test("renders all labels, selects the slow frame and refreshes only on request", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const requests: unknown[] = [];
  try {
    await act(async () =>
      root.render(
        createElement(PerformanceViewer, {
          jobId: data.report.jobId,
          threadId: "thread-1",
          load: async (params) => {
            requests.push(params);
            return data;
          },
        }),
      ),
    );
    expect(requests).toEqual([{ jobId: data.report.jobId, threadId: "thread-1" }]);
    expect(container.textContent).toContain("label-9");
    expect(container.textContent).toContain("p50");
    expect(container.textContent).toContain("unavailable");
    expect(container.textContent).toContain("partial");
    const slow = [...container.querySelectorAll("button")].find((b) => b.textContent === "Slowest frame")!;
    await act(async () => slow.click());
    expect(container.querySelector('svg[aria-label="Selected frame Lua label timeline"]')?.textContent).toContain(
      "label-9",
    );
    expect(container.textContent).toContain("Frame 2 · 30.00 ms");
    expect(requests).toHaveLength(1);
    await act(async () =>
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(requests).toHaveLength(2);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test("shows offline artifact errors without a timer or live recovery", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let calls = 0;
  try {
    await act(async () =>
      root.render(
        createElement(PerformanceViewer, {
          jobId: data.report.jobId,
          load: async () => {
            calls++;
            throw new Error("Capture artifacts are not ready");
          },
        }),
      ),
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("not ready");
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(calls).toBe(1);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
