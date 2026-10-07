// @summary Runs one observation-led game playtest against a game-owned Luau adapter frame.
import { performance } from "node:perf_hooks";
import { type call, StudioRpcError } from "../../rpc";
import { expandWithOrigin, inputEventsSchema, MAX_EVENT_COUNT, totalWaitMs, validateBatch } from "../pie-input/events";
import { createDecisionEvidenceTracker } from "./decision-evidence";
import {
  type PlaytestAction,
  type PlaytestDecisionCandidate,
  type PlaytestDecisionContext,
  type PlaytestExpectation,
  type PlaytestFrame,
  type PlaytestIntent,
  parsePlaytestFrame,
  safeTraceValue,
} from "./frame";
import { createProgressWatchdog } from "./progress";
import type { PlaytestVisual, VisualObserver } from "./visual-observation";

type CallRpc = typeof call;
const OBSERVE_PARAMS = (frameName: string) => ({
  character: true,
  instances: { targets: [frameName], properties: true },
});
const OBSERVE_INTERVAL_MS = 100;
const STATUS_INTERVAL_MS = 1_000;
const FRESHNESS_LIMIT_MS = 800;
const EFFECT_WAIT_MS = 1_500;
const MAX_TRACE_EVENTS = 4_096;
const DEFAULT_PLAYTEST_DURATION_MS = 80_000;
const MAX_PLAYTEST_DURATION_MS = 180_000;
export const DEFAULT_STUCK_TIMEOUT_MS = 15_000;
export const DEFAULT_INTENT_DECISION_INTERVAL_MS = 2_000;

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

interface SessionTarget {
  pieSessionId: string;
  clientId: string;
}

interface FrameSnapshot {
  sequence: number;
  receivedAtMs: number;
  observeLatencyMs: number;
  clientReady: boolean;
  frameReady: boolean;
  frame: PlaytestFrame;
}

interface UnavailableFrameObservation {
  receivedAtMs: number;
  reason: string;
}

type FrameValueResult = { ready: true; value: string } | { ready: false; reason: string };

interface CallOptions {
  timeoutMs: number;
  signal: AbortSignal;
}

class SessionChangedError extends Error {}
class AdapterError extends Error {}
class StaleVisualError extends Error {}

function makeAbortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("Playtest cancelled", "AbortError");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw makeAbortError(signal);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const defaultClock: PlaytestClock = {
  now: () => performance.now(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(makeAbortError(signal));
        return;
      }
      const timer = setTimeout(done, Math.max(0, ms));
      function done() {
        signal?.removeEventListener("abort", abort);
        resolve();
      }
      function abort() {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        reject(makeAbortError(signal!));
      }
      signal?.addEventListener("abort", abort, { once: true });
    }),
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function unwrapData(value: unknown): Record<string, unknown> | undefined {
  const wrapper = asRecord(value);
  return asRecord(wrapper?.data) ?? wrapper;
}

function observedClientId(observation: unknown): string | undefined {
  const root = asRecord(observation);
  const character = asRecord(root?.character);
  const data = asRecord(character?.data) ?? character;
  const direct = data?.clientId;
  if (typeof direct === "string" && direct.length > 0) return direct;
  // game.observe post-processors may flatten the character payload.
  const flattened = character?.clientId;
  return typeof flattened === "string" && flattened.length > 0 ? flattened : undefined;
}

function unavailableSectionReason(observation: unknown, name: "character" | "instances"): string | undefined {
  const root = asRecord(observation);
  const rawSection = asRecord(root?.[name]);
  const message = typeof rawSection?.error === "string" ? rawSection.error : "";
  const knownUnavailable =
    /no play[-\s]*test/i.test(message) ||
    /play[-\s]*test.*client\s*state.*(?:not available|unavailable)/i.test(message);
  const failedSections = Array.isArray(root?.failedSections) ? root.failedSections : [];
  const explicitlyPartial = root?.outcome === "partial" && failedSections.includes(name);
  if (rawSection?.status === "error" && knownUnavailable) return message;
  if (!rawSection && explicitlyPartial) return `game.observe ${name} section is unavailable`;
  return undefined;
}

function frameStringValue(observation: unknown, frameName: string): FrameValueResult {
  const root = asRecord(observation);
  if (!root) throw new AdapterError("game.observe returned a malformed observation");
  const unavailable = unavailableSectionReason(observation, "instances");
  if (unavailable) return { ready: false, reason: unavailable };
  const section = unwrapData(root.instances);
  const entries = section?.instances;
  if (!Array.isArray(entries)) throw new AdapterError("game.observe omitted the frame instance list");
  const instance = entries.find((candidate) => {
    const record = asRecord(candidate);
    if (!record) return false;
    const name = record.name;
    const path = record.path;
    return name === frameName || path === frameName || (typeof path === "string" && path.endsWith(`.${frameName}`));
  });
  if (!instance) throw new AdapterError(`game.observe did not return StringValue ${frameName}`);
  const value = asRecord(asRecord(instance)?.Value);
  if (value?.Type !== "String" || typeof value.String !== "string") {
    throw new AdapterError(`${frameName}.Value is not a tagged String value`);
  }
  return { ready: true, value: value.String };
}

function resolveTarget(status: unknown): SessionTarget | undefined {
  const record = asRecord(status);
  if (record?.running !== true || typeof record.pieSessionId !== "string" || !record.pieSessionId) return undefined;
  const clients = Array.isArray(record.clients)
    ? record.clients.map(asRecord).filter((x): x is Record<string, unknown> => !!x)
    : [];
  const injectable = clients.filter((client) => client.injectable === true && typeof client.clientId === "string");
  const selected = injectable.find((client) => client.targeted === true) ?? injectable[0];
  if (!selected || typeof selected.clientId !== "string") return undefined;
  return { pieSessionId: record.pieSessionId, clientId: selected.clientId };
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function getPath(root: Record<string, unknown>, path: string): { present: boolean; value: unknown } {
  let current: unknown = root;
  for (const part of path.split(".")) {
    if (!isRecord(current) || !Object.hasOwn(current, part)) return { present: false, value: undefined };
    current = current[part];
  }
  return { present: true, value: current };
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === undefined || right === undefined) return false;
  try {
    return stableStringify(left) === stableStringify(right);
  } catch {
    return false;
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function evaluateExpectations(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  expectations: PlaytestExpectation[] | undefined,
): Array<Record<string, unknown>> {
  return (expectations ?? []).map((expectation) => {
    const oldValue = getPath(before, expectation.key);
    const newValue = getPath(after, expectation.key);
    let passed = false;
    switch (expectation.op) {
      case "change":
        passed = oldValue.present && newValue.present && !jsonEqual(oldValue.value, newValue.value);
        break;
      case "increase":
        passed =
          oldValue.present &&
          newValue.present &&
          typeof oldValue.value === "number" &&
          typeof newValue.value === "number" &&
          newValue.value > oldValue.value;
        break;
      case "decrease":
        passed =
          oldValue.present &&
          newValue.present &&
          typeof oldValue.value === "number" &&
          typeof newValue.value === "number" &&
          newValue.value < oldValue.value;
        break;
      case "equals":
        passed = newValue.present && jsonEqual(newValue.value, expectation.value);
        break;
    }
    return {
      key: expectation.key,
      op: expectation.op,
      before: { present: oldValue.present, value: safeTraceValue(oldValue.value) },
      after: { present: newValue.present, value: safeTraceValue(newValue.value) },
      ...(expectation.op === "equals" ? { expected: expectation.value } : {}),
      passed,
    };
  });
}

function actionForChoice(frame: PlaytestFrame, id: string, intentMode: boolean) {
  return frame.actions.find((action) => (intentMode ? action.intent?.id === id : action.id === id));
}
function actionStillValid(before: PlaytestFrame, latest: PlaytestFrame, actionId: string, intentMode = false): boolean {
  if (latest.error || latest.terminal || before.harnessId !== latest.harnessId) return false;
  const prior = actionForChoice(before, actionId, intentMode);
  const current = actionForChoice(latest, actionId, intentMode);
  if (!prior || !current) return false;
  if (Boolean(prior.intent) !== Boolean(current.intent)) return false;
  if (intentMode) {
    if (
      !prior.intent ||
      !current.intent ||
      prior.intent.validityKey !== current.intent.validityKey ||
      !jsonEqual(prior.intent.completeWhen, current.intent.completeWhen)
    )
      return false;
  } else if (prior.validityKey !== current.validityKey) return false;
  if (current.expiresAtGameTime !== undefined && latest.gameTimeSeconds >= current.expiresAtGameTime) return false;
  return true;
}

function actionCoverageKey(action: PlaytestAction | undefined): string | undefined {
  const key = (action as (PlaytestAction & { coverageKey?: unknown }) | undefined)?.coverageKey;
  return typeof key === "string" && key.length > 0 ? key : undefined;
}

function adapterFrameReady(frame: PlaytestFrame): boolean {
  return (frame as PlaytestFrame & { ready?: boolean }).ready !== false;
}

function isUserInterruptedInput(error: unknown): error is StudioRpcError {
  return (
    error instanceof StudioRpcError &&
    error.code === -32108 &&
    isRecord(error.data) &&
    error.data.reason === "interruptedByUser"
  );
}

function addEvent(
  stats: PlaytestStats,
  onEvent: RunPlaytestOptions["onEvent"],
  clock: PlaytestClock,
  type: string,
  fields: Record<string, unknown> = {},
): void {
  if (!onEvent) return;
  if (stats.traceEvents >= MAX_TRACE_EVENTS) {
    stats.traceEventsDropped += 1;
    return;
  }
  const event = safeTraceValue({ type, atMs: clock.now(), ...fields }) as PlaytestEvent;
  stats.traceEvents += 1;
  try {
    onEvent(event);
  } catch {
    stats.logCallbackErrors += 1;
  }
}

function validateOptions(options: RunPlaytestOptions): {
  maxDurationMs: number;
  startupTimeoutMs: number;
  stuckTimeoutMs: number;
  intentDecisionIntervalMs: number;
} {
  if (typeof options.callRpc !== "function" || typeof options.choose !== "function") {
    throw new TypeError("runPlaytest requires callRpc and choose functions");
  }
  if (!options.harnessId || !options.frameName) throw new TypeError("harnessId and frameName are required");
  const maxDurationMs = options.maxDurationMs ?? DEFAULT_PLAYTEST_DURATION_MS;
  const startupTimeoutMs = options.startupTimeoutMs ?? 20_000;
  const stuckTimeoutMs = options.stuckTimeoutMs ?? DEFAULT_STUCK_TIMEOUT_MS;
  if (!Number.isFinite(maxDurationMs) || maxDurationMs <= 0 || maxDurationMs > MAX_PLAYTEST_DURATION_MS) {
    throw new RangeError(`maxDurationMs must be in (0, ${MAX_PLAYTEST_DURATION_MS}]`);
  }
  if (!Number.isFinite(startupTimeoutMs) || startupTimeoutMs <= 0 || startupTimeoutMs > 60_000) {
    throw new RangeError("startupTimeoutMs must be in (0, 60000]");
  }
  if (!Number.isInteger(stuckTimeoutMs) || stuckTimeoutMs < 0 || stuckTimeoutMs > MAX_PLAYTEST_DURATION_MS) {
    throw new RangeError(`stuckTimeoutMs must be an integer in [0, ${MAX_PLAYTEST_DURATION_MS}] (0 disables it)`);
  }
  const intentDecisionIntervalMs = options.intentDecisionIntervalMs ?? DEFAULT_INTENT_DECISION_INTERVAL_MS;
  if (!Number.isInteger(intentDecisionIntervalMs) || intentDecisionIntervalMs < 250 || intentDecisionIntervalMs > 30000)
    throw new RangeError("intentDecisionIntervalMs must be in [250, 30000]");
  return { maxDurationMs, startupTimeoutMs, stuckTimeoutMs, intentDecisionIntervalMs };
}

/**
 * Starts one owned PIE session, watches a game-authored frame, and serially dispatches its legal inputs.
 * Existing PIE sessions are deliberately left untouched.
 */
export async function runPlaytest(options: RunPlaytestOptions): Promise<PlaytestResult> {
  const maxVisualAgeMs = options.maxVisualAgeMs ?? 2000;
  if (!Number.isFinite(maxVisualAgeMs) || maxVisualAgeMs < 250 || maxVisualAgeMs > 30000) {
    throw new RangeError("maxVisualAgeMs must be in [250, 30000]");
  }
  const { maxDurationMs, startupTimeoutMs, stuckTimeoutMs, intentDecisionIntervalMs } = validateOptions(options);
  const clock = options.clock ?? defaultClock;
  const callerSignal = options.signal ?? new AbortController().signal;
  const stuckController = new AbortController();
  const userSignal = AbortSignal.any([callerSignal, stuckController.signal]);
  const watchdogStop = new AbortController();
  let watchdog: ReturnType<typeof createProgressWatchdog> | undefined;
  let watchdogTask: Promise<void> | undefined;
  let stuck: PlaytestResult["stuck"];
  let lastActionId: string | undefined;
  const recentActions: NonNullable<PlaytestDecisionContext["recentActions"]> = [];
  let activeIntent:
    | {
        definition: PlaytestIntent;
        baseline: Record<string, unknown>;
        startedAtMs: number;
        trace: { decisionId: number; decisionSource: string };
      }
    | undefined;
  let lastPolicyAt = Number.NEGATIVE_INFINITY;
  const stats: PlaytestStats = {
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
  const cleanup: PlaytestCleanup = {
    ownedSession: false,
    statusChecked: false,
    stopAttempted: false,
    stopped: false,
    reason: "PIE session was not started by this playtest",
  };
  const startedAt = clock.now();
  let outcome: PlaytestResult["outcome"] = "error";
  let reason = "Playtest did not complete";
  let terminal: PlaytestFrame["terminal"];
  let target: SessionTarget | undefined;
  let startCommandAccepted = false;
  let lastStatusAt = Number.NEGATIVE_INFINITY;
  let lastStatus: unknown;
  let latest: FrameSnapshot | undefined;
  let unavailableFrameObservation: UnavailableFrameObservation | undefined;
  let observerFailure: Error | undefined;
  let observerSequence = 0;
  let lastRevision: number | undefined;
  let lastGameTime: number | undefined;
  let lastGameTimeAdvanceAt: number | undefined;
  let previousObservationAt: number | undefined;
  let resolvePublication: (() => void) | undefined;
  let publication = new Promise<void>((resolve) => {
    resolvePublication = resolve;
  });
  const observerController = new AbortController();
  const cleanupController = new AbortController();
  let activeDecisionController: AbortController | undefined;
  const seenGameEventIds = new Set<string>();
  const gameEventOrder: string[] = [];

  const decisionEvidence = createDecisionEvidenceTracker();
  const emit = (type: string, fields: Record<string, unknown> = {}) => {
    decisionEvidence.event({ type, atMs: clock.now(), ...fields });
    addEvent(stats, options.onEvent, clock, type, fields);
  };
  const finishIntent = (snapshot: FrameSnapshot, verifiedTerminal = false) => {
    if (!activeIntent || (!verifiedTerminal && snapshotHealthError(snapshot))) return;
    const checks = evaluateExpectations(
      activeIntent.baseline,
      snapshot.frame.state,
      activeIntent.definition.completeWhen,
    );
    if (checks.length && checks.every((check) => check.passed)) {
      emit("intent_completed", { ...activeIntent.trace, intentId: activeIntent.definition.id, expectations: checks });
      activeIntent = undefined;
    }
  };
  const publish = () => {
    resolvePublication?.();
    publication = new Promise<void>((resolve) => {
      resolvePublication = resolve;
    });
  };
  const call = (method: string, params: Record<string, unknown> | undefined, callOptions: CallOptions) =>
    options.callRpc(method, params, callOptions);

  const statusTarget = async (signal: AbortSignal, cleanupCall = false): Promise<SessionTarget | undefined> => {
    const status = await call("game.pie.status", {}, { signal, timeoutMs: 5_000 });
    lastStatusAt = clock.now();
    lastStatus = status;
    stats.statusChecks += 1;
    if (cleanupCall) cleanup.statusChecked = true;
    emit("session_status", { running: asRecord(status)?.running === true, cleanup: cleanupCall });
    return resolveTarget(status);
  };

  const refreshSessionIfDue = async (signal: AbortSignal): Promise<void> => {
    if (!target || clock.now() - lastStatusAt < STATUS_INTERVAL_MS) return;
    const current = await statusTarget(signal);
    if (!current || current.pieSessionId !== target.pieSessionId || current.clientId !== target.clientId) {
      throw new SessionChangedError("PIE session or injectable client changed during playtest");
    }
  };

  const verifyOwnedSession = async (signal: AbortSignal): Promise<void> => {
    await refreshSessionIfDue(signal);
    const status = asRecord(lastStatus);
    const activeTarget = resolveTarget(lastStatus);
    if (
      !target ||
      status?.running !== true ||
      status.pieSessionId !== target.pieSessionId ||
      activeTarget?.clientId !== target.clientId
    ) {
      throw new SessionChangedError("PIE session or injectable client changed during playtest");
    }
  };

  const terminalFrameUsable = (snapshot: FrameSnapshot, now = clock.now()): boolean => {
    if (!snapshot.frame.terminal || !snapshot.frameReady) return false;
    if (unavailableFrameObservation && unavailableFrameObservation.receivedAtMs >= snapshot.receivedAtMs) return false;
    return now - snapshot.receivedAtMs <= FRESHNESS_LIMIT_MS;
  };

  const snapshotHealthError = (snapshot: FrameSnapshot | undefined, now = clock.now()): string | undefined => {
    if (observerFailure) return observerFailure.message;
    if (
      unavailableFrameObservation &&
      (!snapshot || unavailableFrameObservation.receivedAtMs >= snapshot.receivedAtMs)
    ) {
      return `adapter frame unavailable (${unavailableFrameObservation.reason})`;
    }
    if (!snapshot) return "no game adapter frame has been observed";
    if (!snapshot.frameReady) return "game adapter frame is not ready";
    if (!snapshot.clientReady) return "game.observe character clientId is unavailable";
    const age = now - snapshot.receivedAtMs;
    stats.maxObservationAgeMs = Math.max(stats.maxObservationAgeMs, age);
    if (age > FRESHNESS_LIMIT_MS) return `adapter frame is stale (${Math.round(age)}ms)`;
    if (lastGameTimeAdvanceAt === undefined || now - lastGameTimeAdvanceAt > FRESHNESS_LIMIT_MS) {
      return `gameTimeSeconds has not advanced for ${Math.round(now - (lastGameTimeAdvanceAt ?? now))}ms`;
    }
    return undefined;
  };

  const observerLoop = async (expected: SessionTarget): Promise<void> => {
    try {
      while (!observerController.signal.aborted) {
        throwIfAborted(observerController.signal);
        const observeStartedAt = clock.now();
        const observation = await call("game.observe", OBSERVE_PARAMS(options.frameName), {
          signal: observerController.signal,
          timeoutMs: 5_000,
        });
        const receivedAtMs = clock.now();
        const clientId = observedClientId(observation);
        if (clientId && clientId !== expected.clientId) {
          throw new SessionChangedError(
            `game.observe clientId mismatch: expected ${expected.clientId}, got ${clientId}`,
          );
        }
        const frameValue = frameStringValue(observation, options.frameName);
        if (!frameValue.ready) {
          unavailableFrameObservation = { receivedAtMs, reason: frameValue.reason };
          emit("readiness_wait", {
            phase: latest ? "running" : "startup",
            section: "instances",
            reason: frameValue.reason,
          });
          publish();
          const remainingPollDelayMs = Math.max(0, OBSERVE_INTERVAL_MS - (clock.now() - observeStartedAt));
          await clock.sleep(remainingPollDelayMs, observerController.signal);
          continue;
        }
        unavailableFrameObservation = undefined;
        const frame = parsePlaytestFrame(frameValue.value);
        if (frame.harnessId !== options.harnessId) {
          throw new AdapterError(`frame harnessId mismatch: expected ${options.harnessId}, got ${frame.harnessId}`);
        }
        if (frame.error) throw new AdapterError(frame.error.message);
        if (lastRevision !== undefined && frame.revision < lastRevision) {
          throw new AdapterError(`adapter revision regressed (${frame.revision} < ${lastRevision})`);
        }
        if (lastGameTime !== undefined && frame.gameTimeSeconds < lastGameTime) {
          throw new AdapterError(`gameTimeSeconds regressed (${frame.gameTimeSeconds} < ${lastGameTime})`);
        }
        if (lastGameTime === undefined || frame.gameTimeSeconds > lastGameTime + 1e-6) {
          lastGameTimeAdvanceAt = receivedAtMs;
        }
        const clientReady = clientId === expected.clientId;
        const frameReady = adapterFrameReady(frame);
        if (!frameReady) {
          emit("readiness_wait", {
            phase: latest ? "running" : "startup",
            section: "adapter",
            reason: "game adapter frame is not ready",
          });
        }
        if (!clientReady) {
          const characterReason = unavailableSectionReason(observation, "character");
          emit("readiness_wait", {
            phase: latest ? "running" : "startup",
            section: "character",
            reason: characterReason ?? "game.observe did not include the expected clientId",
          });
        }
        lastRevision = frame.revision;
        lastGameTime = frame.gameTimeSeconds;
        observerSequence += 1;
        const observeLatencyMs = receivedAtMs - observeStartedAt;
        const cadenceMs = previousObservationAt === undefined ? undefined : receivedAtMs - previousObservationAt;
        previousObservationAt = receivedAtMs;
        latest = { sequence: observerSequence, receivedAtMs, observeLatencyMs, clientReady, frameReady, frame };
        if (watchdog && !frame.terminal && !snapshotHealthError(latest)) {
          watchdog.observe(frame.progress, receivedAtMs);
        }
        stats.observations += 1;
        stats.maxObserveLatencyMs = Math.max(stats.maxObserveLatencyMs, observeLatencyMs);
        stats.lastRevision = frame.revision;
        stats.lastGameTimeSeconds = frame.gameTimeSeconds;
        const pollDelayMs = Math.max(0, OBSERVE_INTERVAL_MS - (clock.now() - observeStartedAt));
        emit("observation", {
          sequence: observerSequence,
          revision: frame.revision,
          gameTimeSeconds: frame.gameTimeSeconds,
          observeLatencyMs,
          cadenceMs,
          pollDelayMs,
          state: safeTraceValue(frame.state),
          progress: frame.progress,
          actionIds: frame.actions.map((action) => action.id),
          terminal: frame.terminal?.outcome,
        });
        try {
          options.onFrame?.(structuredClone(frame));
        } catch {
          stats.logCallbackErrors += 1;
        }
        for (const gameEvent of frame.events ?? []) {
          if (seenGameEventIds.has(gameEvent.id)) {
            stats.duplicateGameEvents += 1;
            continue;
          }
          seenGameEventIds.add(gameEvent.id);
          gameEventOrder.push(gameEvent.id);
          if (gameEventOrder.length > 8_192) {
            const expired = gameEventOrder.shift();
            if (expired) seenGameEventIds.delete(expired);
          }
          stats.gameEventsEmitted += 1;
          emit("game_event", {
            id: gameEvent.id,
            level: gameEvent.level ?? "info",
            message: gameEvent.message,
            ...(gameEvent.data ? { data: gameEvent.data } : {}),
          });
        }
        publish();
        const remainingPollDelayMs = Math.max(0, OBSERVE_INTERVAL_MS - (clock.now() - observeStartedAt));
        await clock.sleep(remainingPollDelayMs, observerController.signal);
      }
    } catch (error) {
      if (!observerController.signal.aborted) {
        observerFailure = error instanceof Error ? error : new Error(String(error));
        stats.observationErrors += 1;
        emit("observer_error", { error: describe(error) });
      }
      publish();
    }
  };

  const watchProgress = async (runDeadline: number): Promise<void> => {
    const signal = AbortSignal.any([userSignal, watchdogStop.signal]);
    try {
      while (!signal.aborted && clock.now() < runDeadline && watchdog) {
        if (observerFailure) return;
        if (latest && terminalFrameUsable(latest)) return;
        const status = watchdog.status(clock.now());
        if (status.stuck) {
          stuck = {
            ...status,
            lastActionId,
            revision: latest?.frame.revision,
            state: latest ? safeTraceValue(latest.frame.state) : undefined,
            progress: latest?.frame.progress,
            observationHealth: snapshotHealthError(latest),
          };
          emit("stuck", { ...stuck });
          stuckController.abort(new DOMException("Playtest made no meaningful progress", "AbortError"));
          return;
        }
        await clock.sleep(Math.min(50, Math.max(1, runDeadline - clock.now())), signal);
      }
    } catch (error) {
      if (!signal.aborted) {
        observerFailure = error instanceof Error ? error : new Error(String(error));
        publish();
      }
    }
  };

  const waitForNextFrame = async (options: {
    afterSequence: number;
    afterTimeMs?: number;
    afterRevision?: number;
    deadlineMs: number;
    signal: AbortSignal;
  }): Promise<FrameSnapshot | undefined> => {
    while (clock.now() < options.deadlineMs) {
      throwIfAborted(options.signal);
      if (observerFailure) throw observerFailure;
      const candidate = latest;
      if (
        candidate &&
        candidate.sequence > options.afterSequence &&
        (options.afterTimeMs === undefined || candidate.receivedAtMs >= options.afterTimeMs) &&
        (options.afterRevision === undefined || candidate.frame.revision > options.afterRevision)
      ) {
        return candidate;
      }
      await refreshSessionIfDue(options.signal);
      const remaining = options.deadlineMs - clock.now();
      if (remaining <= 0) break;
      const observedPublication = publication;
      await Promise.race([observedPublication, clock.sleep(Math.min(50, remaining), options.signal)]);
    }
    return undefined;
  };

  const waitForStartupFrame = async (deadlineMs: number, signal: AbortSignal): Promise<FrameSnapshot | undefined> => {
    let afterSequence = 0;
    while (clock.now() < deadlineMs) {
      const candidate = await waitForNextFrame({
        afterSequence,
        deadlineMs,
        signal,
      });
      if (!candidate) return undefined;
      afterSequence = candidate.sequence;
      if (candidate.clientReady && candidate.frameReady) return candidate;
      if (terminalFrameUsable(candidate)) {
        await verifyOwnedSession(signal);
        return candidate;
      }
    }
    return undefined;
  };

  try {
    if (userSignal.aborted) throw makeAbortError(userSignal);
    const initialStatus = await call("game.pie.status", {}, { signal: userSignal, timeoutMs: 5_000 });
    lastStatus = initialStatus;
    lastStatusAt = clock.now();
    stats.statusChecks += 1;
    emit("session_status", { running: asRecord(initialStatus)?.running === true, startup: true });
    if (asRecord(initialStatus)?.running === true) {
      throw new Error("PIE is already running; runPlaytest will not take over an existing session");
    }

    await call("game.play", { numberOfPlayer: 1 }, { signal: userSignal, timeoutMs: 15_000 });
    startCommandAccepted = true;
    emit("pie_start_requested", { numberOfPlayer: 1 });
    const startupEnd = clock.now() + startupTimeoutMs;
    while (clock.now() < startupEnd) {
      throwIfAborted(userSignal);
      if (clock.now() - lastStatusAt >= STATUS_INTERVAL_MS) {
        const observedTarget = await statusTarget(userSignal);
        const rawStatus = asRecord(lastStatus);
        const statusSession = rawStatus?.pieSessionId;
        if (typeof statusSession === "string" && statusSession) {
          if (cleanup.sessionId && cleanup.sessionId !== statusSession) {
            throw new SessionChangedError("PIE session changed during startup");
          }
          cleanup.sessionId = statusSession;
          cleanup.ownedSession = true;
        }
        if (observedTarget) {
          target = observedTarget;
          if (cleanup.sessionId && target.pieSessionId !== cleanup.sessionId) {
            throw new SessionChangedError("injectable target belongs to a replacement PIE session");
          }
          cleanup.sessionId = target.pieSessionId;
          cleanup.ownedSession = startCommandAccepted;
          break;
        }
      }
      await clock.sleep(Math.min(100, Math.max(0, startupEnd - clock.now())), userSignal);
    }
    if (!target) {
      outcome = "timeout";
      reason = "PIE did not expose an injectable client before startupTimeoutMs";
      emit("startup_timeout", { startupTimeoutMs });
    } else {
      const observerTask = observerLoop(target);
      const observerLinkAbort = () =>
        observerController.abort(userSignal.reason ?? new DOMException("Cancelled", "AbortError"));
      userSignal.addEventListener("abort", observerLinkAbort, { once: true });
      const runDeadline = clock.now() + maxDurationMs;
      try {
        const initialFrame = await waitForStartupFrame(
          Math.min(runDeadline, clock.now() + startupTimeoutMs),
          userSignal,
        );
        if (!initialFrame) {
          outcome = "timeout";
          reason = "game-owned playtest frame did not arrive before startupTimeoutMs";
        } else {
          if (stuckTimeoutMs > 0) {
            watchdog = createProgressWatchdog(stuckTimeoutMs, clock.now());
            watchdog.observe(initialFrame.frame.progress, clock.now());
            emit("progress_watchdog_started", { ...watchdog.status(clock.now()) });
            watchdogTask = watchProgress(runDeadline);
          }
          while (clock.now() < runDeadline) {
            throwIfAborted(userSignal);
            if (observerFailure) throw observerFailure;
            const current = latest;
            if (!current) throw new AdapterError("playtest observer lost its latest frame");
            if (current.frame.error) throw new AdapterError(current.frame.error.message);
            if (current.frame.terminal && terminalFrameUsable(current)) {
              await verifyOwnedSession(userSignal);
              finishIntent(current, true);
              terminal = current.frame.terminal;
              outcome = terminal.outcome;
              reason = terminal.reason ?? `Game adapter reported ${terminal.outcome}`;
              emit("terminal", { outcome, reason: terminal.reason, revision: current.frame.revision });
              break;
            }
            const health = snapshotHealthError(current);
            if (health) {
              emit("dispatch_blocked", { reason: health, sequence: current.sequence });
              const next = await waitForNextFrame({
                afterSequence: current.sequence,
                deadlineMs: runDeadline,
                signal: userSignal,
              });
              if (!next) {
                outcome = "timeout";
                reason = `No healthy adapter frame before maxDurationMs (${health})`;
                break;
              }
              continue;
            }
            await refreshSessionIfDue(userSignal);
            const before = current;
            finishIntent(before);
            const intentMode = before.frame.actions.some((action) => action.intent);
            const actions = before.frame.actions.filter(
              (action) =>
                !action.intent ||
                !evaluateExpectations(before.frame.state, before.frame.state, action.intent.completeWhen).every(
                  (check) => check.passed,
                ),
            );
            if (activeIntent) {
              const available = actions.find((action) => action.intent?.id === activeIntent!.definition.id)?.intent;
              if (
                !available ||
                available.validityKey !== activeIntent.definition.validityKey ||
                !jsonEqual(available.completeWhen, activeIntent.definition.completeWhen)
              ) {
                emit("intent_invalidated", {
                  ...activeIntent.trace,
                  intentId: activeIntent.definition.id,
                  reason: "Intent unavailable or context changed",
                });
                activeIntent = undefined;
              }
            }
            const candidates = actions.map((action) =>
              action.intent ? { id: action.intent.id, description: action.intent.description } : action,
            );
            if (actions.length === 0) {
              const next = await waitForNextFrame({
                afterSequence: before.sequence,
                deadlineMs: runDeadline,
                signal: userSignal,
              });
              if (!next) {
                outcome = "timeout";
                reason = "No legal adapter action arrived before maxDurationMs";
                break;
              }
              continue;
            }

            const retained =
              activeIntent && (actions.length === 1 || clock.now() - lastPolicyAt < intentDecisionIntervalMs);
            const decisionTrace = retained
              ? activeIntent!.trace
              : {
                  decisionId: ++stats.decisions,
                  decisionSource: actions.length === 1 ? "automatic" : "model",
                };
            let choice: PlaytestChoice;
            let choiceVisual: PlaytestVisual | undefined;
            if (retained) {
              choice = { actionId: activeIntent!.definition.id };
            } else if (actions.length === 1) {
              choice = {
                actionId: candidates[0].id,
                diagnostics: { decision: "deterministic_singleton" },
                latencyMs: 0,
              };
              emit("singleton_choice", {
                ...decisionTrace,
                actionId: choice.actionId,
                ...(!intentMode && actionCoverageKey(actions[0]) ? { coverageKey: actionCoverageKey(actions[0]) } : {}),
                sequence: before.sequence,
              });
            } else {
              const controllerContext: PlaytestDecisionContext | undefined =
                activeIntent || recentActions.length > 0
                  ? {
                      ...(activeIntent
                        ? {
                            activeIntent: {
                              id: activeIntent.definition.id,
                              elapsedMs: clock.now() - activeIntent.startedAtMs,
                            },
                          }
                        : {}),
                      ...(recentActions.length > 0 ? { recentActions: structuredClone(recentActions) } : {}),
                    }
                  : undefined;
              const markModelStart = () => {
                stats.modelCalls += 1;
                emit("model_start", {
                  ...decisionTrace,
                  sequence: before.sequence,
                  revision: before.frame.revision,
                  gameTimeSeconds: before.frame.gameTimeSeconds,
                  candidateIds: candidates.map((action) => action.id),
                  candidates: candidates.map(({ id, description }) => ({ id, description })),
                  ...(before.frame.decisionState ? { decisionState: safeTraceValue(before.frame.decisionState) } : {}),
                  ...(controllerContext ? { controllerContext: safeTraceValue(controllerContext) } : {}),
                });
              };
              let modelPromise: Promise<PlaytestChoice>;
              const decisionStartedAt = clock.now();
              const decisionController = new AbortController();
              activeDecisionController = decisionController;
              const decisionSignal = AbortSignal.any([userSignal, decisionController.signal]);
              try {
                modelPromise = (async () => {
                  if (options.captureVisual) {
                    choiceVisual = await options.captureVisual(structuredClone(before.frame), decisionSignal, {
                      ...target!,
                    });
                    decisionSignal.throwIfAborted();
                    const metadata = choiceVisual.metadata;
                    if (
                      metadata.clientId !== target!.clientId ||
                      metadata.pieSessionId !== target!.pieSessionId ||
                      metadata.stateRevision !== before.frame.revision
                    ) {
                      throw new Error("Visual observation does not match the owned session/client/state");
                    }
                    if (
                      !Number.isFinite(metadata.capturedAtMs) ||
                      metadata.capturedAtMs < decisionStartedAt ||
                      metadata.capturedAtMs > clock.now()
                    ) {
                      throw new Error("Visual observation has an invalid capture timestamp");
                    }
                    emit("visual_observation", {
                      ...decisionTrace,
                      ...(safeTraceValue(metadata) as Record<string, unknown>),
                    });
                    const current = latest;
                    if (
                      clock.now() - metadata.capturedAtMs > maxVisualAgeMs ||
                      !current ||
                      snapshotHealthError(current) ||
                      !candidates.every((c) => actionStillValid(before.frame, current.frame, c.id, intentMode))
                    ) {
                      throw new StaleVisualError("Visual evidence or candidate context expired during capture");
                    }
                  }
                  markModelStart();
                  return options.choose(
                    structuredClone(before.frame),
                    structuredClone(candidates),
                    decisionSignal,
                    controllerContext,
                    choiceVisual,
                  );
                })();
              } catch (error) {
                decisionController.abort(new DOMException("Choice failed", "AbortError"));
                throw new Error(`Playtest chooser failed to start: ${describe(error)}`);
              }
              let choiceReady = false;
              let resolvedChoice: PlaytestChoice | undefined;
              let rejectedChoice: unknown;
              void modelPromise.then(
                (value) => {
                  resolvedChoice = value;
                  choiceReady = true;
                },
                (error) => {
                  rejectedChoice = error;
                  choiceReady = true;
                },
              );
              while (!choiceReady && clock.now() < runDeadline) {
                throwIfAborted(userSignal);
                if (observerFailure) throw observerFailure;
                const observed = latest;
                if (observed && terminalFrameUsable(observed)) {
                  decisionController.abort(new DOMException("Terminal frame observed", "AbortError"));
                  break;
                }
                await refreshSessionIfDue(userSignal);
                await clock.sleep(Math.min(50, Math.max(1, runDeadline - clock.now())), userSignal);
              }
              const observedTerminal = latest?.frame.terminal;
              if (latest && observedTerminal && terminalFrameUsable(latest)) {
                decisionController.abort(new DOMException("Terminal frame observed", "AbortError"));
                await verifyOwnedSession(userSignal);
                finishIntent(latest, true);
                terminal = observedTerminal;
                outcome = terminal.outcome;
                reason = terminal.reason ?? `Game adapter reported ${terminal.outcome}`;
                emit("terminal", { outcome, reason: terminal.reason, revision: latest.frame.revision });
                break;
              }
              if (!choiceReady) {
                decisionController.abort(new DOMException("Playtest deadline reached", "AbortError"));
                activeDecisionController = undefined;
                outcome = "timeout";
                reason = "Model choice exceeded maxDurationMs";
                emit("model_timeout", { ...decisionTrace, sequence: before.sequence });
                break;
              }
              if (rejectedChoice instanceof StaleVisualError) {
                decisionController.abort(new DOMException("Visual observation expired", "AbortError"));
                activeDecisionController = undefined;
                stats.invalidatedChoices += 1;
                emit("choice_invalidated", { ...decisionTrace, reason: rejectedChoice.message });
                continue;
              }
              if (rejectedChoice !== undefined) throw new Error(`Playtest chooser failed: ${describe(rejectedChoice)}`);
              if (!resolvedChoice) throw new Error("Playtest chooser returned no decision");
              decisionController.abort(new DOMException("Choice completed", "AbortError"));
              activeDecisionController = undefined;
              choice = resolvedChoice;
              emit("model_choice", {
                ...decisionTrace,
                actionId: choice.actionId,
                ...(!intentMode &&
                actionCoverageKey(before.frame.actions.find((action) => action.id === choice.actionId))
                  ? {
                      coverageKey: actionCoverageKey(
                        before.frame.actions.find((action) => action.id === choice.actionId),
                      ),
                    }
                  : {}),
                diagnostics: choice.diagnostics ?? {},
                latencyMs: choice.latencyMs ?? clock.now() - decisionStartedAt,
                sequence: before.sequence,
              });
            }

            if (typeof choice.actionId !== "string" || !candidates.some((action) => action.id === choice.actionId)) {
              throw new Error("Playtest chooser returned an action id absent from its frame");
            }
            const latestAfterChoice = latest;
            if (!latestAfterChoice) throw new AdapterError("no current frame after choice");
            if (latestAfterChoice.frame.terminal && terminalFrameUsable(latestAfterChoice)) {
              await verifyOwnedSession(userSignal);
              finishIntent(latestAfterChoice, true);
              terminal = latestAfterChoice.frame.terminal;
              outcome = terminal.outcome;
              reason = terminal.reason ?? `Game adapter reported ${terminal.outcome}`;
              emit("terminal", { outcome, reason: terminal.reason, revision: latestAfterChoice.frame.revision });
              break;
            }
            const latestHealth = snapshotHealthError(latestAfterChoice);
            const visualExpired = choiceVisual && clock.now() - choiceVisual.metadata.capturedAtMs > maxVisualAgeMs;
            if (
              visualExpired ||
              latestHealth ||
              !actionStillValid(before.frame, latestAfterChoice.frame, choice.actionId, intentMode)
            ) {
              stats.invalidatedChoices += 1;
              emit("choice_invalidated", {
                ...decisionTrace,
                actionId: choice.actionId,
                reason: visualExpired
                  ? "Visual observation expired before dispatch"
                  : (latestHealth ?? "action id, validityKey, expiry, or terminal state changed"),
                beforeRevision: before.frame.revision,
                latestRevision: latestAfterChoice.frame.revision,
                decisionAgeMs: clock.now() - before.receivedAtMs,
              });
              continue;
            }

            await refreshSessionIfDue(userSignal);
            const newest = latest;
            if (
              !newest ||
              (choiceVisual && clock.now() - choiceVisual.metadata.capturedAtMs > maxVisualAgeMs) ||
              newest.frame.terminal ||
              snapshotHealthError(newest) ||
              !actionStillValid(before.frame, newest.frame, choice.actionId, intentMode)
            ) {
              stats.invalidatedChoices += 1;
              emit("choice_invalidated", {
                ...decisionTrace,
                actionId: choice.actionId,
                reason: "action failed immediate pre-dispatch revalidation",
                beforeRevision: before.frame.revision,
                latestRevision: newest?.frame.revision,
              });
              continue;
            }
            const action = actionForChoice(newest.frame, choice.actionId, intentMode);
            if (!action) continue;
            if (action.intent) {
              if (!activeIntent || activeIntent.definition.id !== action.intent.id) {
                activeIntent = {
                  definition: structuredClone(action.intent),
                  baseline: structuredClone(before.frame.state),
                  startedAtMs: clock.now(),
                  trace: decisionTrace,
                };
                emit("intent_selected", { ...decisionTrace, intentId: action.intent.id });
              } else activeIntent.trace = decisionTrace;
              if (!retained) lastPolicyAt = clock.now();
              finishIntent(newest);
              if (!activeIntent) continue;
            }
            const parsedEvents = inputEventsSchema.parse(action.events);
            const expanded = expandWithOrigin(parsedEvents);
            const batchError = validateBatch(expanded.sent, expanded.origin);
            if (expanded.sent.length > MAX_EVENT_COUNT || batchError) {
              throw new Error(
                `Refusing invalid playtest input for ${action.id}: ${batchError ?? "expanded event count exceeds limit"}`,
              );
            }
            const remainingMs = runDeadline - clock.now();
            const inputDurationMs = totalWaitMs(expanded.sent);
            if (inputDurationMs >= remainingMs) {
              outcome = "timeout";
              reason = `Action ${action.id} exceeds remaining playtest time`;
              break;
            }
            const executionId = ++stats.dispatchedActions;
            const executionTrace = {
              ...decisionTrace,
              executionId,
              ...(action.intent ? { intentId: action.intent.id } : {}),
            };
            if (intentMode)
              emit("intent_step", {
                ...executionTrace,
                actionId: action.id,
                ...(action.coverageKey ? { coverageKey: action.coverageKey } : {}),
              });
            lastActionId = action.id;
            const beforeInput = newest;
            emit("action_dispatch", {
              ...executionTrace,
              actionId: action.id,
              ...(actionCoverageKey(action) ? { coverageKey: actionCoverageKey(action) } : {}),
              description: action.description,
              sequence: beforeInput.sequence,
              revision: beforeInput.frame.revision,
              observationToDispatchMs: clock.now() - beforeInput.receivedAtMs,
              eventCount: expanded.sent.length,
              events: expanded.sent,
            });
            let inputReply: unknown;
            try {
              inputReply = await call(
                "game.input.inject",
                {
                  pieSessionId: target.pieSessionId,
                  clientId: target.clientId,
                  events: expanded.sent,
                },
                {
                  signal: userSignal,
                  timeoutMs: Math.max(1_000, Math.min(inputDurationMs + 15_000, remainingMs)),
                },
              );
            } catch (error) {
              if (!isUserInterruptedInput(error)) throw error;
              outcome = "input_cancelled";
              reason = `Studio input for ${action.id} was interrupted by the user`;
              emit("input_reply", {
                ...executionTrace,
                actionId: action.id,
                ...(actionCoverageKey(action) ? { coverageKey: actionCoverageKey(action) } : {}),
                status: "cancelled",
                error: { code: error.code, reason: "interruptedByUser" },
              });
              break;
            }
            const inputStatus = asRecord(inputReply)?.status;
            emit("input_reply", {
              ...executionTrace,
              actionId: action.id,
              ...(actionCoverageKey(action) ? { coverageKey: actionCoverageKey(action) } : {}),
              status: inputStatus,
              reply: inputReply,
            });
            if (inputStatus === "cancelled") {
              outcome = "input_cancelled";
              reason = `Studio cancelled input for ${action.id}`;
              break;
            }
            if (inputStatus !== "completed") {
              outcome = "error";
              reason = `Studio input status for ${action.id} was ${String(inputStatus ?? "missing")}`;
              break;
            }
            const inputCompletedAt = clock.now();
            const resultFrame = await waitForNextFrame({
              afterSequence: beforeInput.sequence,
              afterTimeMs: inputCompletedAt,
              afterRevision: beforeInput.frame.revision,
              deadlineMs: Math.min(runDeadline, inputCompletedAt + EFFECT_WAIT_MS),
              signal: userSignal,
            });
            if (!resultFrame) {
              const episodeExpired = clock.now() >= runDeadline;
              outcome = episodeExpired ? "timeout" : "error";
              reason = episodeExpired
                ? `maxDurationMs elapsed while awaiting the effect of ${action.id}`
                : `No newer game adapter frame after ${action.id} within ${EFFECT_WAIT_MS}ms`;
              emit("action_result", { ...executionTrace, actionId: action.id, observed: false, reason });
              break;
            }
            const expectations = evaluateExpectations(
              beforeInput.frame.state,
              resultFrame.frame.state,
              action.expectations,
            );
            recentActions.push({
              actionId: action.id,
              ...(action.intent ? { intentId: action.intent.id } : {}),
              result:
                snapshotHealthError(resultFrame) || expectations.length === 0
                  ? "not_checked"
                  : expectations.every((check) => check.passed)
                    ? "effect_confirmed"
                    : "effect_unconfirmed",
            });
            if (recentActions.length > 3) recentActions.shift();
            if (
              !snapshotHealthError(resultFrame) &&
              expanded.sent.some((event) => event.type !== "wait") &&
              expectations.length > 0 &&
              expectations.every((check) => check.passed) &&
              expectations.some((check) => JSON.stringify(check.before) !== JSON.stringify(check.after))
            ) {
              watchdog?.confirmEffect(clock.now());
            }
            emit("action_result", {
              ...executionTrace,
              actionId: action.id,
              ...(actionCoverageKey(action) ? { coverageKey: actionCoverageKey(action) } : {}),
              observed: true,
              inputStatus,
              beforeRevision: beforeInput.frame.revision,
              afterRevision: resultFrame.frame.revision,
              observationAfterInputMs: resultFrame.receivedAtMs - inputCompletedAt,
              expectations,
              terminal: resultFrame.frame.terminal?.outcome,
            });
            finishIntent(resultFrame);
          }
          if (outcome === "error" && reason === "Playtest did not complete") {
            outcome = "timeout";
            reason = "maxDurationMs elapsed";
          }
        }
      } finally {
        watchdogStop.abort(new DOMException("Playtest watchdog stopped", "AbortError"));
        await watchdogTask;
        userSignal.removeEventListener("abort", observerLinkAbort);
        observerController.abort(new DOMException("Playtest observer stopped", "AbortError"));
        const observerStopDeadline = clock.now() + 2_000;
        while (clock.now() < observerStopDeadline) {
          const done = await Promise.race([
            observerTask.then(
              () => true,
              () => true,
            ),
            clock.sleep(Math.min(50, observerStopDeadline - clock.now()), cleanupController.signal).then(() => false),
          ]);
          if (done) break;
        }
      }
    }
  } catch (error) {
    if (callerSignal.aborted) {
      outcome = "cancelled";
      reason = "Playtest cancelled by caller";
    } else if (stuckController.signal.aborted && stuck) {
      outcome = "stuck";
      reason = `No meaningful progress for ${Math.round(stuck.inactiveMs)}ms (limit ${stuck.timeoutMs}ms)`;
    } else if (error instanceof SessionChangedError) {
      outcome = "session_changed";
      reason = error.message;
    } else {
      outcome = "error";
      reason = describe(error);
    }
    emit("playtest_error", { outcome, reason });
  } finally {
    watchdogStop.abort(new DOMException("Playtest finished", "AbortError"));
    activeDecisionController?.abort(new DOMException("Playtest ended", "AbortError"));
    activeDecisionController = undefined;
    observerController.abort(new DOMException("Playtest finished", "AbortError"));
    if (cleanup.ownedSession && cleanup.sessionId) {
      try {
        const sinceStatus = clock.now() - lastStatusAt;
        if (sinceStatus < STATUS_INTERVAL_MS)
          await clock.sleep(STATUS_INTERVAL_MS - sinceStatus, cleanupController.signal);
        await statusTarget(cleanupController.signal, true);
        const finalStatus = asRecord(lastStatus);
        if (finalStatus?.running === true && finalStatus.pieSessionId === cleanup.sessionId) {
          cleanup.stopAttempted = true;
          await call("game.stop", {}, { signal: cleanupController.signal, timeoutMs: 10_000 });
          cleanup.stopped = true;
          cleanup.reason = "stopped the same PIE session started by this playtest";
        } else {
          cleanup.reason = "PIE session was already stopped or replaced; left it untouched";
        }
      } catch (error) {
        cleanup.reason = `could not verify/stop owned PIE session: ${describe(error)}`;
        emit("cleanup_error", { reason: cleanup.reason });
      }
    }
    stats.elapsedMs = Math.max(0, clock.now() - startedAt);
    emit("cleanup", {
      ownedSession: cleanup.ownedSession,
      stopAttempted: cleanup.stopAttempted,
      stopped: cleanup.stopped,
      reason: cleanup.reason,
    });
  }

  return {
    outcome,
    reason,
    ...(terminal ? { terminal } : {}),
    ...(stuck ? { stuck } : {}),
    stats,
    decisionEvidence: decisionEvidence.summary(),
    cleanup,
  };
}

export type { PlaytestAction, PlaytestFrame } from "./frame";
export { parsePlaytestFrame } from "./frame";
