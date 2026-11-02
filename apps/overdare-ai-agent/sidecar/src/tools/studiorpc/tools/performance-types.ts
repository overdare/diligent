// @summary Shared wire and persisted data for bounded product-owned performance captures.

export interface Distribution {
  n: number;
  mean: number | null;
  p50: number | null;
  p95: number | null;
  max: number | null;
}

export interface MetricInfo {
  status: string;
  scope?: string;
  coverage?: string;
  source?: string;
  reason?: string;
}

export interface FrameRecord {
  frameId: string;
  beginMonotonicNs: string;
  endMonotonicNs: string;
  frame_ms: number;
  lua_machine_ms: number | null;
  slate_gt_ms: number | null;
  validity: Record<string, string>;
}

export interface LuaScopeRecord {
  labelId: number;
  frameId: string;
  beginMonotonicNs: string;
  endMonotonicNs: string;
  elapsed_ms: number;
}

export interface LuaScopeMetadata {
  status: string;
  labels: string[];
  sampleCount?: number;
  sampleLimit?: number;
  dropped?: number;
  unclosed?: number;
  unmatchedEnds?: number;
  [key: string]: unknown;
}

export interface ProcessIdentity {
  pid: number;
  startTimeUtc: string;
  parentPid?: number;
  commandLine?: string;
  role?: string;
}

export interface ProcessSample extends ProcessIdentity {
  observedAtUtc?: string;
  monotonicMs: number;
  cpuSeconds: number | null;
  residentBytes: number | null;
  privateBytes: number | null;
  status: string;
  intervalSeconds?: number | null;
  usedCores?: number | null;
  cpuPct?: number | null;
  effectiveCpuCapacity?: number | null;
}

export type CaptureState = "starting" | "capturing" | "finalizing" | "completed" | "partial" | "failed" | "cancelled";
export const isTerminal = (state: string) => ["completed", "partial", "failed", "cancelled"].includes(state);

export interface CaptureStart {
  action?: "start";
  case: string;
  seconds?: number;
  target?: { pieSessionId: string; clientId: string } | { pid: number; startTimeUtc: string; role: "dedicated_server" };
  serverPids?: number[];
}

export interface CaptureStop {
  action: "stop";
  jobId: string;
  outcome: "completed" | "failed" | "cancelled";
  reason?: string;
}

export interface Manifest {
  schemaVersion: 1;
  jobId: string;
  clientCaptureId: string;
  rpcSessionId?: string;
  nativeJobId?: string;
  case: string;
  seconds: number;
  state: CaptureState;
  createdAt: string;
  endpoint: { host: string; port: number };
  resolvedTarget: ProcessIdentity & { scope: string; [key: string]: unknown };
  metrics: Record<string, MetricInfo>;
  conditions: Record<string, unknown>;
  request: CaptureStart;
  scenarioOutcome: "unverified" | CaptureStop["outcome"];
  scenarioReason?: string;
  stopReason?: string;
  osReason?: string;
  elapsedSeconds?: number;
  frameCount?: number;
  quality?: Record<string, unknown>;
  latestObserved?: Record<string, unknown>;
  manualScopes?: LuaScopeMetadata;
}

export interface MetricSummary extends Distribution, MetricInfo {
  unit: string;
  invalidSamples?: number;
}

export interface PerformanceReport {
  schemaVersion: 1;
  jobId: string;
  state: CaptureState;
  case: string;
  scenarioOutcome: Manifest["scenarioOutcome"];
  resolvedTarget?: Manifest["resolvedTarget"];
  summaries: Record<string, MetricSummary>;
  averageFps: number | null;
  conditions: Record<string, unknown>;
  processes: unknown[];
  quality: Record<string, unknown>;
  missingMetrics: string[];
  latestObserved: Record<string, unknown>;
  worstFrames: FrameRecord[];
  artifacts: Record<string, string>;
  stopReason?: string;
  luaScopes?: (MetricSummary & { label: string; labelId: number; boundary: string; total_ms: number })[];
}
