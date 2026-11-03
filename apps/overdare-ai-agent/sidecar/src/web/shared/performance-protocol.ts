// @summary Product-owned, read-only capture viewer contract; raw clocks remain integer strings.
import { z } from "zod";

export const WEB_PERFORMANCE_READ_METHOD = "overdare/performance/read";
export const PerformanceJobIdSchema = z.string().regex(/^perf-[0-9a-f-]{36}$/);
export const PerformanceReadParamsSchema = z
  .object({
    jobId: PerformanceJobIdSchema,
    baseline: PerformanceJobIdSchema.optional(),
    threadId: z.string().min(1).max(256).optional(),
  })
  .strict();
export type PerformanceReadParams = z.infer<typeof PerformanceReadParamsSchema>;

const finite = z.number().finite().nonnegative();
const nullable = finite.nullable();
const clock = z.string().regex(/^\d{1,24}$/);
export const PerformanceFrameSchema = z.object({
  frameId: clock,
  beginMonotonicNs: clock,
  endMonotonicNs: clock,
  frame_ms: finite,
  lua_machine_ms: nullable,
  slate_gt_ms: nullable,
  validity: z.record(z.string()),
});
export const PerformanceLuaScopeSchema = z.object({
  labelId: z.number().int().min(0).max(31),
  frameId: clock,
  beginMonotonicNs: clock,
  endMonotonicNs: clock,
  elapsed_ms: finite,
});
export const PerformanceProcessSampleSchema = z.object({
  pid: z.number().int().positive(),
  startTimeUtc: z.string(),
  role: z.string().optional(),
  observedAtUtc: z.string().optional(),
  monotonicMs: finite,
  cpuSeconds: nullable,
  usedCores: nullable.optional(),
  intervalSeconds: nullable.optional(),
  residentBytes: nullable,
  privateBytes: nullable,
  status: z.string(),
});
const distribution = z.object({
  n: z.number().int().nonnegative(),
  mean: nullable,
  p50: nullable,
  p95: nullable,
  max: nullable,
});
const metric = distribution.extend({
  unit: z.string(),
  status: z.string(),
  reason: z.string().optional(),
  scope: z.string().optional(),
  coverage: z.string().optional(),
  invalidSamples: finite.optional(),
});
export const PerformanceViewReportSchema = z.object({
  jobId: PerformanceJobIdSchema,
  case: z.string(),
  state: z.string(),
  scenarioOutcome: z.string(),
  summaries: z.record(metric),
  averageFps: nullable,
  conditions: z.record(z.unknown()),
  quality: z.record(z.unknown()),
  missingMetrics: z.array(z.string()),
  latestObserved: z.record(z.unknown()),
  stopReason: z.string().optional(),
});
const delta = z.object({ absolute: z.number().finite().nullable(), percent: z.number().finite().nullable() });
export const PerformanceComparisonSchema = z.object({
  baseline: z.string(),
  status: z.enum(["insufficient_metadata", "conditions_differ", "numeric_only"]),
  missingConditions: z.array(z.string()),
  conditionDifferences: z.array(z.string()),
  deltas: z.record(z.record(delta)).nullable(),
});
export const PerformanceViewSchema = z.object({
  schemaVersion: z.literal(1),
  report: PerformanceViewReportSchema,
  frames: z.array(PerformanceFrameSchema).max(10000),
  luaScopes: z.array(PerformanceLuaScopeSchema).max(8192),
  luaSummaries: z
    .array(metric.extend({ label: z.string(), labelId: finite, total_ms: finite, boundary: z.string() }))
    .max(32),
  processSamples: z.array(PerformanceProcessSampleSchema).max(2000),
  processes: z.array(
    z.object({
      pid: z.number(),
      startTimeUtc: z.string(),
      role: z.string().optional(),
      boundary: z.string(),
      missingSamples: finite,
      usedCores: metric,
      residentBytes: metric,
      privateBytes: metric,
    }),
  ),
  manualScopes: z.record(z.unknown()).optional(),
  baselineReport: PerformanceViewReportSchema.optional(),
  baselineLuaSummaries: z
    .array(metric.extend({ label: z.string() }))
    .max(32)
    .optional(),
  comparison: PerformanceComparisonSchema.optional(),
  luaComparison: PerformanceComparisonSchema.optional(),
});
export type PerformanceView = z.infer<typeof PerformanceViewSchema>;
export type PerformanceViewReport = z.infer<typeof PerformanceViewReportSchema>;
export interface WebPerformanceBackend {
  read(params: PerformanceReadParams): Promise<PerformanceView>;
}
