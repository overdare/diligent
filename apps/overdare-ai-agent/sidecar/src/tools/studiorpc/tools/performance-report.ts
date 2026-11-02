// @summary Computes post-capture distributions and condition-aware numeric differences without performance policy.

import type {
  Distribution,
  FrameRecord,
  LuaScopeMetadata,
  LuaScopeRecord,
  MetricInfo,
  MetricSummary,
  PerformanceReport,
  ProcessSample,
} from "./performance-types";

export function summarize(values: (number | null | undefined)[]): Distribution {
  const sorted = values
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  const n = sorted.length;
  const rank = (p: number) => sorted[Math.ceil(p * n) - 1] ?? null;
  return {
    n,
    mean: n ? sorted.reduce((sum, value) => sum + value, 0) / n : null,
    p50: rank(0.5),
    p95: rank(0.95),
    max: sorted[n - 1] ?? null,
  };
}

export function summarizeFrames(frames: FrameRecord[], metrics: Record<string, MetricInfo>) {
  const summaries: Record<string, MetricSummary> = {};
  for (const key of ["frame_ms", "lua_machine_ms", "slate_gt_ms"] as const) {
    const distribution = summarize(frames.map((frame) => (frame.validity[key] ? null : frame[key])));
    const info = metrics[key] ?? {
      status: distribution.n ? "ok" : "unsupported",
      reason: distribution.n ? undefined : "No valid samples",
    };
    summaries[key] = {
      ...info,
      ...distribution,
      unit: "ms",
      scope: info.scope ?? "process",
      invalidSamples: frames.filter((frame) => !!frame.validity[key]).length,
    };
    if (!distribution.n && info.status === "ok") {
      summaries[key]!.status = "no_samples";
      summaries[key]!.reason = "No valid completed samples";
    }
  }
  const mean = summaries.frame_ms!.mean;
  return { summaries, averageFps: mean && mean > 0 ? 1000 / mean : null };
}

export function summarizeLuaScopes(samples: LuaScopeRecord[], metadata?: LuaScopeMetadata) {
  if (!metadata) return [];
  return metadata.labels.map((label, labelId) => {
    const values = samples.filter((sample) => sample.labelId === labelId).map((sample) => sample.elapsed_ms);
    const distribution = summarize(values);
    return {
      label,
      labelId,
      ...distribution,
      total_ms: (distribution.mean ?? 0) * distribution.n,
      status: distribution.n ? metadata.status : "no_samples",
      ...(!distribution.n ? { reason: "No completed synchronous invocations" } : {}),
      scope: "process",
      source: "explicit_lua_debug_labels",
      coverage: "explicit_synchronous_lua_invocations_v1",
      boundary: "completed_invocation",
      unit: "ms",
    };
  });
}

export function summarizeProcesses(samples: ProcessSample[]) {
  const metric = (unit: string, distribution: Distribution) => ({
    unit,
    ...distribution,
    status: distribution.n ? "ok" : "no_samples",
    ...(!distribution.n ? { reason: "No valid process observations" } : {}),
  });
  const identities = new Map<string, ProcessSample[]>();
  for (const sample of samples) {
    const key = `${sample.pid}:${sample.startTimeUtc}`;
    const group = identities.get(key) ?? [];
    group.push(sample);
    identities.set(key, group);
  }
  return [...identities.values()].map((group) => {
    const first = group[0]!;
    const valid = group.filter((sample) => sample.status === "ok");
    const cpu = summarize(valid.map((sample) => sample.usedCores));
    const intervals = valid.filter((sample) => sample.usedCores != null && sample.intervalSeconds != null);
    const seconds = intervals.reduce((sum, sample) => sum + sample.intervalSeconds!, 0);
    cpu.mean = seconds
      ? intervals.reduce((sum, sample) => sum + sample.usedCores! * sample.intervalSeconds!, 0) / seconds
      : null;
    return {
      pid: first.pid,
      startTimeUtc: first.startTimeUtc,
      role: first.role,
      scope: "process",
      samples: group.length,
      coveredSeconds: seconds,
      firstObservationUtc: first.observedAtUtc,
      lastObservationUtc: group[group.length - 1]?.observedAtUtc,
      boundary: "OS worker observations; not frame aligned",
      missingSamples: group.length - valid.length,
      usedCores: {
        ...metric("cores", cpu),
        ...(!cpu.n ? { reason: "At least two valid CPU observations are required" } : {}),
      },
      cpuPct: {
        unit: "%",
        ...summarize(valid.map((sample) => sample.cpuPct)),
        status: "unsupported",
        reason: "Effective CPU capacity is not verified; use usedCores",
      },
      residentBytes: metric("bytes", summarize(valid.map((sample) => sample.residentBytes))),
      privateBytes: metric("bytes", summarize(valid.map((sample) => sample.privateBytes))),
    };
  });
}

type Comparable = Pick<PerformanceReport, "case" | "conditions" | "summaries">;
export function compareReports(candidate: Comparable, baseline: Comparable, baselineId: string) {
  const required = ["build", "resolution", "quality", "frameCap", "load", "scope", "coverage"];
  const missingConditions = required.filter(
    (key) =>
      candidate.conditions[key] == null ||
      baseline.conditions[key] == null ||
      candidate.conditions[key] === "unknown" ||
      baseline.conditions[key] === "unknown",
  );
  const conditionDifferences = ["case", ...required].filter(
    (key) =>
      JSON.stringify(key === "case" ? candidate.case : candidate.conditions[key]) !==
      JSON.stringify(key === "case" ? baseline.case : baseline.conditions[key]),
  );
  const status = missingConditions.length
    ? "insufficient_metadata"
    : conditionDifferences.length
      ? "conditions_differ"
      : "numeric_only";
  const deltas: Record<string, Record<string, { absolute: number | null; percent: number | null }>> = {};
  if (status === "numeric_only") {
    for (const [key, value] of Object.entries(candidate.summaries)) {
      const base = baseline.summaries[key];
      if (!base || base.unit !== value.unit || base.scope !== value.scope || base.coverage !== value.coverage) continue;
      deltas[key] = {};
      for (const statistic of ["mean", "p50", "p95", "max"] as const) {
        const current = value[statistic];
        const previous = base[statistic];
        deltas[key]![statistic] = {
          absolute: current == null || previous == null ? null : current - previous,
          percent:
            current == null || previous == null || previous === 0 ? null : ((current - previous) / previous) * 100,
        };
      }
    }
  }
  return {
    baseline: baselineId,
    status,
    missingConditions,
    conditionDifferences,
    deltas: status === "numeric_only" ? deltas : null,
  };
}
