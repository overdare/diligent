// @summary Runs one observation-led game playtest against a game-owned Luau adapter frame.
import { StudioRpcError } from "../../rpc";
import { expandWithOrigin, inputEventsSchema, MAX_EVENT_COUNT, totalWaitMs, validateBatch } from "../pie-input/events";
import {
  actionCoverageKey,
  actionEffectStatus,
  actionForChoice,
  actionStillValid,
  evaluateExpectations,
  sameIntentGuard,
} from "./action-checks";
import { createDecisionEvidenceTracker } from "./decision-evidence";
import {
  type PlaytestAction,
  type PlaytestDecisionCandidate,
  type PlaytestDecisionContext,
  type PlaytestFrame,
  type PlaytestIntent,
  safeTraceValue,
} from "./frame";
import { createFrameObserver, SessionChangedError } from "./frame-observer";
import { AdapterError, asRecord, isRecord, resolveTarget } from "./observation";
import { createProgressWatchdog } from "./progress";
import { defaultClock, makeAbortError, throwIfAborted } from "./runtime-clock";
import type {
  CallOptions,
  FrameSnapshot,
  PlaytestChoice,
  PlaytestCleanup,
  PlaytestClock,
  PlaytestEvent,
  PlaytestResult,
  PlaytestStats,
  RunPlaytestOptions,
  SessionTarget,
} from "./runtime-types";
import type { PlaytestVisual } from "./visual-observation";

export type {
  PlaytestChoice,
  PlaytestCleanup,
  PlaytestClock,
  PlaytestEvent,
  PlaytestResult,
  PlaytestStats,
  RunPlaytestOptions,
} from "./runtime-types";

const STATUS_INTERVAL_MS = 1_000;
const EFFECT_WAIT_MS = 1_500;
const MAX_TRACE_EVENTS = 4_096;
const DEFAULT_PLAYTEST_DURATION_MS = 80_000;
const MAX_PLAYTEST_DURATION_MS = 180_000;
export const DEFAULT_STUCK_TIMEOUT_MS = 15_000;
export const DEFAULT_INTENT_DECISION_INTERVAL_MS = 2_000;

class StaleVisualError extends Error {}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
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

interface DecisionTrace {
  decisionId: number;
  decisionSource: string;
}
type ActionSelection =
  | { kind: "stop" }
  | { kind: "retry" }
  | {
      kind: "selected";
      action: PlaytestAction;
      beforeInput: FrameSnapshot;
      decisionTrace: DecisionTrace;
      intentMode: boolean;
    };

/**
 * Starts one owned PIE session, watches a game-authored frame, and serially dispatches its legal inputs.
 * Existing PIE sessions are deliberately left untouched.
 */
export async function runPlaytest(options: RunPlaytestOptions): Promise<PlaytestResult> {
  return createPlaytestEpisode(options).run();
}

/** Owns the mutable state of one episode; helpers below are its ordered lifecycle steps. */
function createPlaytestEpisode(options: RunPlaytestOptions) {
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
  const cleanupController = new AbortController();
  let activeDecisionController: AbortController | undefined;
  const decisionEvidence = createDecisionEvidenceTracker();
  const emit = (type: string, fields: Record<string, unknown> = {}) => {
    decisionEvidence.event({ type, atMs: clock.now(), ...fields });
    addEvent(stats, options.onEvent, clock, type, fields);
  };
  const finishIntent = (snapshot: FrameSnapshot, verifiedTerminal = false) => {
    if (!activeIntent || (!verifiedTerminal && observer.snapshotHealthError(snapshot))) return;
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

  const observer = createFrameObserver({
    callRpc: options.callRpc,
    clock,
    harnessId: options.harnessId,
    frameName: options.frameName,
    stats,
    emit,
    onFrame: options.onFrame,
    onHealthyFrame: (frame, receivedAtMs) => watchdog?.observe(frame.progress, receivedAtMs),
    refreshSessionIfDue,
    verifyOwnedSession,
  });

  const watchProgress = async (runDeadline: number): Promise<void> => {
    const signal = AbortSignal.any([userSignal, watchdogStop.signal]);
    try {
      while (!signal.aborted && clock.now() < runDeadline && watchdog) {
        if (observer.failure) return;
        if (observer.latest && observer.terminalFrameUsable(observer.latest)) return;
        const status = watchdog.status(clock.now());
        if (status.stuck) {
          stuck = {
            ...status,
            lastActionId,
            revision: observer.latest?.frame.revision,
            state: observer.latest ? safeTraceValue(observer.latest.frame.state) : undefined,
            progress: observer.latest?.frame.progress,
            observationHealth: observer.snapshotHealthError(observer.latest),
          };
          emit("stuck", { ...stuck });
          stuckController.abort(new DOMException("Playtest made no meaningful progress", "AbortError"));
          return;
        }
        await clock.sleep(Math.min(50, Math.max(1, runDeadline - clock.now())), signal);
      }
    } catch (error) {
      if (!signal.aborted) {
        observer.reportFailure(error);
      }
    }
  };

  const currentDecisionContext = (): PlaytestDecisionContext | undefined => {
    if (!activeIntent && recentActions.length === 0) return undefined;
    const context: PlaytestDecisionContext = {};
    if (activeIntent) {
      context.activeIntent = { id: activeIntent.definition.id, elapsedMs: clock.now() - activeIntent.startedAtMs };
    }
    if (recentActions.length > 0) context.recentActions = structuredClone(recentActions);
    return context;
  };

  // Selection owns model waiting and freshness checks; it never sends physical input.
  const selectAction = async (
    before: FrameSnapshot,
    actions: PlaytestAction[],
    candidates: PlaytestDecisionCandidate[],
    intentMode: boolean,
    runDeadline: number,
  ): Promise<ActionSelection> => {
    const retained = activeIntent && (actions.length === 1 || clock.now() - lastPolicyAt < intentDecisionIntervalMs);
    const decisionSource = actions.length === 1 ? "automatic" : "model";
    const decisionTrace = retained
      ? activeIntent!.trace
      : {
          decisionId: ++stats.decisions,
          decisionSource,
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
      const controllerContext = currentDecisionContext();
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
            const current = observer.latest;
            if (
              clock.now() - metadata.capturedAtMs > maxVisualAgeMs ||
              !current ||
              observer.snapshotHealthError(current) ||
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
        if (observer.failure) throw observer.failure;
        const observed = observer.latest;
        if (observed && observer.terminalFrameUsable(observed)) {
          decisionController.abort(new DOMException("Terminal frame observed", "AbortError"));
          break;
        }
        await refreshSessionIfDue(userSignal);
        await clock.sleep(Math.min(50, Math.max(1, runDeadline - clock.now())), userSignal);
      }
      const observedTerminal = observer.latest?.frame.terminal;
      if (observer.latest && observedTerminal && observer.terminalFrameUsable(observer.latest)) {
        decisionController.abort(new DOMException("Terminal frame observed", "AbortError"));
        await verifyOwnedSession(userSignal);
        finishIntent(observer.latest, true);
        terminal = observedTerminal;
        outcome = terminal.outcome;
        reason = terminal.reason ?? `Game adapter reported ${terminal.outcome}`;
        emit("terminal", { outcome, reason: terminal.reason, revision: observer.latest.frame.revision });
        return { kind: "stop" };
      }
      if (!choiceReady) {
        decisionController.abort(new DOMException("Playtest deadline reached", "AbortError"));
        activeDecisionController = undefined;
        outcome = "timeout";
        reason = "Model choice exceeded maxDurationMs";
        emit("model_timeout", { ...decisionTrace, sequence: before.sequence });
        return { kind: "stop" };
      }
      if (rejectedChoice instanceof StaleVisualError) {
        decisionController.abort(new DOMException("Visual observation expired", "AbortError"));
        activeDecisionController = undefined;
        stats.invalidatedChoices += 1;
        emit("choice_invalidated", { ...decisionTrace, reason: rejectedChoice.message });
        return { kind: "retry" };
      }
      if (rejectedChoice !== undefined) throw new Error(`Playtest chooser failed: ${describe(rejectedChoice)}`);
      if (!resolvedChoice) throw new Error("Playtest chooser returned no decision");
      decisionController.abort(new DOMException("Choice completed", "AbortError"));
      activeDecisionController = undefined;
      choice = resolvedChoice;
      emit("model_choice", {
        ...decisionTrace,
        actionId: choice.actionId,
        ...(!intentMode && actionCoverageKey(before.frame.actions.find((action) => action.id === choice.actionId))
          ? {
              coverageKey: actionCoverageKey(before.frame.actions.find((action) => action.id === choice.actionId)),
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
    const latestAfterChoice = observer.latest;
    if (!latestAfterChoice) throw new AdapterError("no current frame after choice");
    if (latestAfterChoice.frame.terminal && observer.terminalFrameUsable(latestAfterChoice)) {
      await verifyOwnedSession(userSignal);
      finishIntent(latestAfterChoice, true);
      terminal = latestAfterChoice.frame.terminal;
      outcome = terminal.outcome;
      reason = terminal.reason ?? `Game adapter reported ${terminal.outcome}`;
      emit("terminal", { outcome, reason: terminal.reason, revision: latestAfterChoice.frame.revision });
      return { kind: "stop" };
    }
    const latestHealth = observer.snapshotHealthError(latestAfterChoice);
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
      return { kind: "retry" };
    }

    await refreshSessionIfDue(userSignal);
    const newest = observer.latest;
    if (
      !newest ||
      (choiceVisual && clock.now() - choiceVisual.metadata.capturedAtMs > maxVisualAgeMs) ||
      newest.frame.terminal ||
      observer.snapshotHealthError(newest) ||
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
      return { kind: "retry" };
    }
    const action = actionForChoice(newest.frame, choice.actionId, intentMode);
    if (!action) return { kind: "retry" };
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
      if (!activeIntent) return { kind: "retry" };
    }

    return { kind: "selected", action, beforeInput: newest, decisionTrace, intentMode };
  };

  // One input batch is followed by a newer observed frame before another choice.
  const executeAction = async (
    selection: Extract<ActionSelection, { kind: "selected" }>,
    runDeadline: number,
  ): Promise<boolean> => {
    const { action, beforeInput, decisionTrace, intentMode } = selection;
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
      return false;
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
          pieSessionId: target!.pieSessionId,
          clientId: target!.clientId,
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
      return false;
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
      return false;
    }
    if (inputStatus !== "completed") {
      outcome = "error";
      reason = `Studio input status for ${action.id} was ${String(inputStatus ?? "missing")}`;
      return false;
    }
    const inputCompletedAt = clock.now();
    const resultFrame = await observer.waitForNextFrame({
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
      return false;
    }
    const expectations = evaluateExpectations(beforeInput.frame.state, resultFrame.frame.state, action.expectations);
    const effectStatus = actionEffectStatus(!observer.snapshotHealthError(resultFrame), expectations);
    recentActions.push({
      actionId: action.id,
      ...(action.intent ? { intentId: action.intent.id } : {}),
      result: effectStatus,
    });
    if (recentActions.length > 3) recentActions.shift();
    if (
      effectStatus === "effect_confirmed" &&
      expanded.sent.some((event) => event.type !== "wait") &&
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
    return true;
  };

  const startOwnedSession = async (): Promise<void> => {
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
  };

  const runDecisionLoop = async (runDeadline: number): Promise<void> => {
    while (clock.now() < runDeadline) {
      throwIfAborted(userSignal);
      if (observer.failure) throw observer.failure;
      const current = observer.latest;
      if (!current) throw new AdapterError("playtest observer lost its latest frame");
      if (current.frame.error) throw new AdapterError(current.frame.error.message);
      if (current.frame.terminal && observer.terminalFrameUsable(current)) {
        await verifyOwnedSession(userSignal);
        finishIntent(current, true);
        terminal = current.frame.terminal;
        outcome = terminal.outcome;
        reason = terminal.reason ?? `Game adapter reported ${terminal.outcome}`;
        emit("terminal", { outcome, reason: terminal.reason, revision: current.frame.revision });
        break;
      }
      const health = observer.snapshotHealthError(current);
      if (health) {
        emit("dispatch_blocked", { reason: health, sequence: current.sequence });
        const next = await observer.waitForNextFrame({
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
        if (!sameIntentGuard(available, activeIntent.definition)) {
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
        const next = await observer.waitForNextFrame({
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

      const selection = await selectAction(before, actions, candidates, intentMode, runDeadline);
      if (selection.kind === "stop") break;
      if (selection.kind === "retry") continue;
      if (!(await executeAction(selection, runDeadline))) break;
    }
    if (outcome === "error" && reason === "Playtest did not complete") {
      outcome = "timeout";
      reason = "maxDurationMs elapsed";
    }
  };

  const playObservedSession = async (expected: SessionTarget): Promise<void> => {
    const observerTask = observer.start(expected);
    const observerLinkAbort = () => observer.stop(userSignal.reason ?? new DOMException("Cancelled", "AbortError"));
    userSignal.addEventListener("abort", observerLinkAbort, { once: true });
    const runDeadline = clock.now() + maxDurationMs;
    try {
      const initialFrame = await observer.waitForStartupFrame(
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
        await runDecisionLoop(runDeadline);
      }
    } finally {
      watchdogStop.abort(new DOMException("Playtest watchdog stopped", "AbortError"));
      await watchdogTask;
      userSignal.removeEventListener("abort", observerLinkAbort);
      observer.stop(new DOMException("Playtest observer stopped", "AbortError"));
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
  };

  const stopOwnedSession = async (): Promise<void> => {
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
  };

  const run = async (): Promise<PlaytestResult> => {
    // Episode lifecycle: acquire ownership, observe/decide/act, then clean up even on failure.
    try {
      await startOwnedSession();
      if (target) {
        await playObservedSession(target);
      } else {
        outcome = "timeout";
        reason = "PIE did not expose an injectable client before startupTimeoutMs";
        emit("startup_timeout", { startupTimeoutMs });
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
      observer.stop(new DOMException("Playtest finished", "AbortError"));
      await stopOwnedSession();
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
  };

  return { run };
}

export type { PlaytestAction, PlaytestFrame } from "./frame";
export { parsePlaytestFrame } from "./frame";
