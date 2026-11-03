// @summary Offline capture viewing preserves raw detail and never recovers or mutates a capture.
import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { summarizeFrames } from "../../../src/tools/studiorpc/tools/performance-report";
import { PerformanceStore } from "../../../src/tools/studiorpc/tools/performance-store";
import type { FrameRecord, Manifest, PerformanceReport } from "../../../src/tools/studiorpc/tools/performance-types";
import { readPerformanceView } from "../../../src/web/server/performance-reader";

export const jobId = "perf-00000000-0000-0000-0000-000000000001";
const frame: FrameRecord = {
  frameId: "42",
  beginMonotonicNs: "99999999999999999",
  endMonotonicNs: "100000000019999999",
  frame_ms: 20,
  lua_machine_ms: 3,
  slate_gt_ms: null,
  validity: { slate_gt_ms: "scope_crossed_frame" },
};

test("loads every label and preserves integer clocks, zero and null from quoted CSV without Studio", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "performance-view-"));
  const store = new PerformanceStore(cwd);
  const labels = Array.from({ length: 10 }, (_, i) => `label,"${i}"\nline`);
  const manifest = {
    schemaVersion: 1,
    jobId,
    case: "idle",
    state: "completed",
    scenarioOutcome: "unverified",
    conditions: {},
    manualScopes: { status: "ok", labels },
  } as Manifest;
  const report = {
    schemaVersion: 1,
    jobId,
    case: "idle",
    state: "completed",
    scenarioOutcome: "unverified",
    ...summarizeFrames([frame], {}),
    conditions: {
      build: "test",
      resolution: "800x600",
      quality: "high",
      frameCap: 60,
      load: "idle",
      scope: "process",
      coverage: "test",
      playerCount: 1,
      topology: { effectiveRunUnderOneProcess: true, localWorldCounts: { client: 1 } },
    },
    processes: [],
    quality: {},
    missingMetrics: ["slate_gt_ms"],
    latestObserved: {},
    worstFrames: [frame],
    artifacts: {},
    luaScopes: [],
  } as PerformanceReport;
  try {
    await store.writeManifest(manifest);
    await store.finish(
      manifest,
      [frame],
      [
        {
          pid: 7,
          startTimeUtc: "start",
          role: "studio",
          monotonicMs: 1000,
          cpuSeconds: 0,
          residentBytes: 0,
          privateBytes: null,
          usedCores: 0,
          status: "ok",
        },
      ],
      report,
      labels.map((_, labelId) => ({
        labelId,
        frameId: "42",
        beginMonotonicNs: frame.beginMonotonicNs,
        endMonotonicNs: frame.endMonotonicNs,
        elapsed_ms: labelId,
      })),
    );
    const before = await readFile(store.paths(jobId).manifest, "utf8");
    const view = await readPerformanceView(cwd, { jobId });
    expect(view.frames).toEqual([frame]);
    expect(view.luaScopes).toHaveLength(10);
    expect(view.luaSummaries.map((s) => s.label)).toEqual(labels);
    expect(view.processSamples[0]?.usedCores).toBe(0);
    expect(view.processSamples[0]?.privateBytes).toBeNull();
    expect(await readFile(store.paths(jobId).manifest, "utf8")).toBe(before);
    const baseline = "perf-00000000-0000-0000-0000-000000000002";
    const baseManifest = {
      ...manifest,
      jobId: baseline,
      manualScopes: { status: "ok", labels: [...labels].reverse() },
    };
    await store.writeManifest(baseManifest);
    await store.finish(baseManifest, [frame], [], { ...report, jobId: baseline }, [
      {
        labelId: 0,
        frameId: "42",
        beginMonotonicNs: frame.beginMonotonicNs,
        endMonotonicNs: frame.endMonotonicNs,
        elapsed_ms: 100,
      },
    ]);
    const compared = await readPerformanceView(cwd, { jobId, baseline });
    expect(compared.luaComparison?.status).toBe("numeric_only");
    expect(compared.luaComparison?.deltas?.[labels[9]!]?.p50?.absolute).toBe(-91);
    await unlink(store.paths(jobId).frames);
    await expect(readPerformanceView(cwd, { jobId })).rejects.toThrow("not ready");
    await writeFile(store.paths(jobId).frames, 'frameId\n"truncated');
    await expect(readPerformanceView(cwd, { jobId })).rejects.toThrow("artifact");
    await expect(readPerformanceView(cwd, { jobId: "../../outside" })).rejects.toThrow();
    await writeFile(store.paths(jobId).manifest, JSON.stringify({ ...manifest, state: "finalizing" }));
    await expect(readPerformanceView(cwd, { jobId })).rejects.toThrow("not ready");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
