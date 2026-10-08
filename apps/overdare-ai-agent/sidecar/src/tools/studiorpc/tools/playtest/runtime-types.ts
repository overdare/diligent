// @summary Episode contracts shared by the runner, decision providers and observers.
import type { call } from "../../rpc";
import type { createDecisionEvidenceTracker } from "./decision-evidence";
import type { PlaytestDecisionCandidate, PlaytestDecisionContext, PlaytestFrame } from "./frame";
import type { createProgressWatchdog } from "./progress";
import type { PlaytestVisual, VisualObserver } from "./visual-observation";

type CallRpc = typeof call;

export interface PlaytestClock {
  /** Monotonic milliseconds. */
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export interface PlaytestChoice {
  actionId: string;
  diagnostics?: Record<string, unknown>;
  latencyMs?: number;
}

export interface PlaytestEvent {
  type: string;
  atMs: number;
  [key: string]: unknown;
}

export interface PlaytestStats {
  elapsedMs: number;
  observations: number;
  observationErrors: number;
  modelCalls: number;
  decisions: number;
  dispatchedActions: number;
  invalidatedChoices: number;
  gameEventsEmitted: number;
  duplicateGameEvents: number;
  statusChecks: number;
  traceEvents: number;
  traceEventsDropped: number;
  logCallbackErrors: number;
  lastRevision?: number;
  lastGameTimeSeconds?: number;
  maxObserveLatencyMs: number;
  maxObservationAgeMs: number;
}

export interface PlaytestCleanup {
  ownedSession: boolean;
  sessionId?: string;
  statusChecked: boolean;
  stopAttempted: boolean;
  stopped: boolean;
  reason: string;
}

export interface PlaytestResult {
  outcome: "success" | "failure" | "timeout" | "stuck" | "cancelled" | "input_cancelled" | "session_changed" | "error";
  reason: string;
  terminal?: PlaytestFrame["terminal"];
  stuck?: ReturnType<ReturnType<typeof createProgressWatchdog>["status"]> & {
    lastActionId?: string;
    revision?: number;
    state?: unknown;
    progress?: PlaytestFrame["progress"];
    observationHealth?: string;
  };
  stats: PlaytestStats;
  decisionEvidence: ReturnType<ReturnType<typeof createDecisionEvidenceTracker>["summary"]>;
  cleanup: PlaytestCleanup;
}

export interface RunPlaytestOptions {
  callRpc: CallRpc;
  choose: (
    frame: PlaytestFrame,
    actions: PlaytestDecisionCandidate[],
    signal: AbortSignal,
    context?: PlaytestDecisionContext,
    visual?: PlaytestVisual,
  ) => Promise<PlaytestChoice>;
  captureVisual?: VisualObserver;
  maxVisualAgeMs?: number;
  onFrame?: (frame: PlaytestFrame) => void;
  clock?: PlaytestClock;
  onEvent?: (event: PlaytestEvent) => void;
  signal?: AbortSignal;
  harnessId: string;
  frameName: string;
  maxDurationMs?: number;
  startupTimeoutMs?: number;
  stuckTimeoutMs?: number;
  intentDecisionIntervalMs?: number;
}

export interface SessionTarget {
  pieSessionId: string;
  clientId: string;
}

export interface FrameSnapshot {
  sequence: number;
  receivedAtMs: number;
  observeLatencyMs: number;
  clientReady: boolean;
  frameReady: boolean;
  frame: PlaytestFrame;
}

export interface UnavailableFrameObservation {
  receivedAtMs: number;
  reason: string;
}

export interface CallOptions {
  timeoutMs: number;
  signal: AbortSignal;
}
