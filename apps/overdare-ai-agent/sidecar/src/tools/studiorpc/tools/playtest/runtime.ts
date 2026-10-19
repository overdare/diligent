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
import { createCheckTracker } from "./checks";
import { createConcurrencyTracker } from "./concurrency";
import { type CoverageTracker, createCoverageTracker } from "./coverage";
import { createDecisionEvidenceTracker, type DecisionEvidenceTracker } from "./decision-evidence";
import { createDiagnosticsTracker } from "./diagnostics";
import {
  type PlaytestAction,
  type PlaytestDecisionCandidate,
  type PlaytestDecisionContext,
  type PlaytestFrame,
  type PlaytestIntent,
  parseMultiplayerActors,
  projectActorFrame,
  safeTraceValue,
} from "./frame";
import { createFrameObserver, SessionChangedError } from "./frame-observer";
import { type ActorBinding, assertActorBindings, bindActors, injectableClients } from "./multiplayer";
import { AdapterError, adapterFrameReady, asRecord, isRecord, resolveTarget } from "./observation";
import { createProgressWatchdog, type ProgressWatchdog } from "./progress";
import { defaultClock, makeAbortError, throwIfAborted } from "./runtime-clock";
import type {
  CallOptions,
  FrameSnapshot,
  PerActorEvidence,
  PlaytestChoice,
  PlaytestCleanup,
  PlaytestClock,
  PlaytestEvent,
  PlaytestMode,
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
  PlaytestMode,
  PlaytestResult,
  PlaytestStats,
  RunPlaytestOptions,
} from "./runtime-types";

const STATUS_INTERVAL_MS = 1_000;
const EFFECT_WAIT_MS = 1_500;
const MAX_TRACE_EVENTS = 4_096;
const DEFAULT_PLAYTEST_DURATION_MS = 80_000;
const MAX_PLAYTEST_DURATION_MS = 180_000;
const MAX_TWO_PLAYER_DURATION_MS = 900_000;
const DEFAULT_PHYSICAL_BATCH_MS = 2_000;
export const DEFAULT_STUCK_TIMEOUT_MS = 15_000;
export const DEFAULT_INTENT_DECISION_INTERVAL_MS = 2_000;
const ACTOR_OBSERVATION_SOURCE = "main_shared_authoritative_harness_actor_projection" as const;

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

interface EpisodeConfig {
  mode: PlaytestMode;
  multi: boolean;
  maxDurationMs: number;
  startupTimeoutMs: number;
  stuckTimeoutMs: number;
  intentDecisionIntervalMs: number;
  maxPhysicalBatchDurationMs: number;
  maxVisualAgeMs: number;
}

function validateOptions(options: RunPlaytestOptions): EpisodeConfig {
  const mode = options.mode ?? "autonomous";
  if (mode !== "autonomous" && mode !== "verification") throw new RangeError("mode must be autonomous or verification");
  if (typeof options.callRpc !== "function") throw new TypeError("runPlaytest requires a callRpc function");
  if (mode === "autonomous" && typeof options.choose !== "function") {
    throw new TypeError("autonomous mode requires a choose function");
  }
  if (mode === "verification" && options.captureVisual) {
    throw new Error("verification mode has no model decisions to show images to; use structured observation");
  }
  if (!options.harnessId || !options.frameName) throw new TypeError("harnessId and frameName are required");
  if (options.numberOfPlayer !== undefined && options.numberOfPlayer !== 1 && options.numberOfPlayer !== 2)
    throw new RangeError("numberOfPlayer must be 1 or 2");
  const multi = options.numberOfPlayer === 2;
  if (multi && options.captureVisual)
    throw new Error(
      "Two-player mode requires structured observations; main-targeted screenshots cannot describe peers",
    );
  const maxVisualAgeMs = options.maxVisualAgeMs ?? 2000;
  if (!Number.isFinite(maxVisualAgeMs) || maxVisualAgeMs < 250 || maxVisualAgeMs > 30000) {
    throw new RangeError("maxVisualAgeMs must be in [250, 30000]");
  }
  const maxDurationMs = options.maxDurationMs ?? DEFAULT_PLAYTEST_DURATION_MS;
  const durationLimit = multi ? MAX_TWO_PLAYER_DURATION_MS : MAX_PLAYTEST_DURATION_MS;
  if (!Number.isFinite(maxDurationMs) || maxDurationMs <= 0 || maxDurationMs > durationLimit) {
    throw new RangeError(`maxDurationMs must be in (0, ${durationLimit}]`);
  }
  const startupTimeoutMs = options.startupTimeoutMs ?? 20_000;
  if (!Number.isFinite(startupTimeoutMs) || startupTimeoutMs <= 0 || startupTimeoutMs > 60_000) {
    throw new RangeError("startupTimeoutMs must be in (0, 60000]");
  }
  const stuckTimeoutMs = options.stuckTimeoutMs ?? DEFAULT_STUCK_TIMEOUT_MS;
  if (!Number.isInteger(stuckTimeoutMs) || stuckTimeoutMs < 0 || stuckTimeoutMs > MAX_PLAYTEST_DURATION_MS) {
    throw new RangeError(`stuckTimeoutMs must be an integer in [0, ${MAX_PLAYTEST_DURATION_MS}] (0 disables it)`);
  }
  const intentDecisionIntervalMs = options.intentDecisionIntervalMs ?? DEFAULT_INTENT_DECISION_INTERVAL_MS;
  if (!Number.isInteger(intentDecisionIntervalMs) || intentDecisionIntervalMs < 250 || intentDecisionIntervalMs > 30000)
    throw new RangeError("intentDecisionIntervalMs must be in [250, 30000]");
  if (options.maxPhysicalBatchDurationMs !== undefined && !multi)
    throw new RangeError("maxPhysicalBatchDurationMs requires two-player mode");
  const maxPhysicalBatchDurationMs = options.maxPhysicalBatchDurationMs ?? DEFAULT_PHYSICAL_BATCH_MS;
  if (
    !Number.isInteger(maxPhysicalBatchDurationMs) ||
    maxPhysicalBatchDurationMs < 250 ||
    maxPhysicalBatchDurationMs > 5000
  )
    throw new RangeError("maxPhysicalBatchDurationMs must be in [250, 5000]");
  return {
    mode,
    multi,
    maxDurationMs,
    startupTimeoutMs,
    stuckTimeoutMs,
    intentDecisionIntervalMs,
    maxPhysicalBatchDurationMs,
    maxVisualAgeMs,
  };
}

interface DecisionTrace {
  decisionId: number;
  decisionSource: "model" | "automatic" | "scenario";
}

interface ActiveIntent {
  definition: PlaytestIntent;
  baseline: Record<string, unknown>;
  startedAtMs: number;
  trace: DecisionTrace;
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
      retained: boolean;
    };

/** Two-player bookkeeping owned by one bound actor; never shared between actor loops. */
interface ActorController {
  watchdog?: ProgressWatchdog;
  evidence: DecisionEvidenceTracker;
  coverage: CoverageTracker;
  terminal?: PlaytestFrame["terminal"];
  lastActionId?: string;
}

/**
 * Starts one owned PIE session, watches a game-authored frame and dispatches legal inputs:
 * one decision/input loop in single-player mode, one independent loop per bound client in two-player mode.
 * Existing PIE sessions are deliberately left untouched.
 */
export async function runPlaytest(options: RunPlaytestOptions): Promise<PlaytestResult> {
  return createPlaytestEpisode(options).run();
}

/** Owns the mutable state of one episode; helpers below are its ordered lifecycle steps. */
function createPlaytestEpisode(options: RunPlaytestOptions) {
  const config = validateOptions(options);
  const { mode, multi } = config;
  const clock = options.clock ?? defaultClock;
  const callerSignal = options.signal ?? new AbortController().signal;
  const stuckController = new AbortController();
  const userSignal = AbortSignal.any([callerSignal, stuckController.signal]);
  const watchdogStop = new AbortController();
  const cleanupController = new AbortController();
  let watchdog: ProgressWatchdog | undefined;
  let watchdogTask: Promise<void> | undefined;
  let stuck: PlaytestResult["stuck"];
  let lastActionId: string | undefined;
  let bindings: ActorBinding[] = [];
  const actorControllers = new Map<string, ActorController>();
  const decisionControllers = new Set<AbortController>();
  const pendingDecisions = new Set<Promise<PlaytestChoice>>();
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
  const decisionEvidence = createDecisionEvidenceTracker({ mode });
  const concurrency = createConcurrencyTracker();
  const checks = createCheckTracker();
  const diagnostics = createDiagnosticsTracker();
  const emit = (type: string, fields: Record<string, unknown> = {}) => {
    const event = { type, atMs: clock.now(), ...fields };
    decisionEvidence.event(event);
    diagnostics.event(event);
    addEvent(stats, options.onEvent, clock, type, fields);
  };
  const call = (method: string, params: Record<string, unknown> | undefined, callOptions: CallOptions) =>
    options.callRpc(method, params, callOptions);

  /** Root terminal wins; in two-player mode both actor terminals aggregate when the root has none. */
  const episodeTerminal = (frame: PlaytestFrame): PlaytestFrame["terminal"] => {
    if (!multi) return frame.terminal;
    if (frame.ready === false) return undefined;
    if (frame.terminal) return frame.terminal;
    const actors = parseMultiplayerActors(frame);
    if (!actors.every((actor) => actor.terminal)) return undefined;
    return {
      outcome: actors.every((actor) => actor.terminal?.outcome === "success") ? "success" : "failure",
      reason: actors
        .map((actor) => `${actor.actorId}: ${actor.terminal?.reason ?? actor.terminal?.outcome}`)
        .join("; "),
    };
  };

  /** Unready shared frames hide every actor's facts; ready frames expose only the actor-local slice. */
  const projectSnapshot = (snapshot: FrameSnapshot | undefined, actor?: ActorBinding): FrameSnapshot | undefined => {
    if (!snapshot || !actor) return snapshot;
    if (!snapshot.frameReady) {
      return {
        ...snapshot,
        frame: {
          ...snapshot.frame,
          state: {},
          actions: [],
          decisionState: undefined,
          progress: undefined,
          terminal: undefined,
          coverage: undefined,
          events: undefined,
          checks: undefined,
        },
      };
    }
    return { ...snapshot, frame: projectActorFrame(snapshot.frame, actor.actorId) };
  };

  const statusTarget = async (signal: AbortSignal, cleanupCall = false): Promise<SessionTarget | undefined> => {
    const status = await call("game.pie.status", {}, { signal, timeoutMs: 5_000 });
    lastStatusAt = clock.now();
    lastStatus = status;
    stats.statusChecks += 1;
    if (cleanupCall) cleanup.statusChecked = true;
    emit("session_status", { running: asRecord(status)?.running === true, cleanup: cleanupCall });
    if (multi && bindings.length && !cleanupCall) {
      const clients = injectableClients(status);
      const bindingMissing = bindings.some(
        (binding) =>
          !clients.some(
            (client) =>
              client.clientId === binding.clientId &&
              (client.userId === undefined || String(client.userId) === binding.userId),
          ),
      );
      if (clients.length !== 2 || bindingMissing)
        throw new SessionChangedError("Owned two-player injectable clients or native identities changed");
    }
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
    // Terminal/startup verification must not trust the periodic status cache.
    await statusTarget(signal);
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

  const inspectFrame = (frame: PlaytestFrame, receivedAtMs: number): void => {
    if (!adapterFrameReady(frame)) return;
    for (const check of checks.observe(frame, receivedAtMs)) {
      emit("check", {
        checkId: check.id,
        basis: check.basis,
        status: check.status,
        revision: frame.revision,
        ...(check.detail ? { detail: check.detail } : {}),
      });
    }
    if (!multi) return;
    if (frame.actions.length) throw new AdapterError("Two-player shared main frame actions must be empty");
    const actors = parseMultiplayerActors(frame);
    assertActorBindings(bindings, actors);
    for (const actor of actors) {
      const controller = actorControllers.get(actor.actorId);
      if (!controller) continue;
      controller.terminal = actor.terminal;
      controller.coverage.observe(projectActorFrame(frame, actor.actorId));
    }
  };

  const onHealthyFrame = (frame: PlaytestFrame, receivedAtMs: number): void => {
    if (!multi) {
      if (!frame.terminal) watchdog?.observe(frame.progress, receivedAtMs);
      return;
    }
    for (const actor of parseMultiplayerActors(frame)) {
      if (!actor.terminal) actorControllers.get(actor.actorId)?.watchdog?.observe(actor.progress, receivedAtMs);
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
    episodeTerminal,
    inspectFrame,
    onHealthyFrame,
    refreshSessionIfDue,
    verifyOwnedSession,
  });

  const recordTerminal = (frame: PlaytestFrame, revision: number): void => {
    terminal = episodeTerminal(frame)!;
    outcome = terminal.outcome;
    reason = terminal.reason ?? `Game adapter reported ${terminal.outcome}`;
    emit("terminal", { outcome, reason: terminal.reason, revision });
  };

  const watchProgress = async (runDeadline: number): Promise<void> => {
    const signal = AbortSignal.any([userSignal, watchdogStop.signal]);
    try {
      while (!signal.aborted && clock.now() < runDeadline) {
        if (observer.failure) return;
        const latest = observer.latest;
        if (latest && observer.terminalFrameUsable(latest)) return;
        if (multi && observer.snapshotHealthError(latest)) {
          await clock.sleep(Math.min(50, Math.max(1, runDeadline - clock.now())), signal);
          continue;
        }
        const blockedActor = multi
          ? [...actorControllers.entries()].find(
              ([, controller]) => !controller.terminal && controller.watchdog?.status(clock.now()).stuck,
            )
          : undefined;
        const status = blockedActor ? blockedActor[1].watchdog?.status(clock.now()) : watchdog?.status(clock.now());
        if (status?.stuck) {
          const slice = latest && blockedActor ? projectActorFrame(latest.frame, blockedActor[0]) : latest?.frame;
          stuck = {
            ...status,
            lastActionId: blockedActor?.[1].lastActionId ?? lastActionId,
            ...(blockedActor ? { actorId: blockedActor[0] } : {}),
            revision: latest?.frame.revision,
            state: slice ? safeTraceValue(slice.state) : undefined,
            progress: slice?.progress,
            observationHealth: observer.snapshotHealthError(latest),
          };
          emit("stuck", { ...stuck });
          stuckController.abort(new DOMException("Playtest made no meaningful progress", "AbortError"));
          return;
        }
        await clock.sleep(Math.min(50, Math.max(1, runDeadline - clock.now())), signal);
      }
    } catch (error) {
      if (!signal.aborted) observer.reportFailure(error);
    }
  };

  /** One decision/input loop. Its intent, history and policy clock are local and never swapped across awaits. */
  const createActorLoop = (loopSignal: AbortSignal, actor?: ActorBinding) => {
    let recentActions: NonNullable<PlaytestDecisionContext["recentActions"]> = [];
    let activeIntent: ActiveIntent | undefined;
    let lastPolicyAt = Number.NEGATIVE_INFINITY;
    const controller = actor ? actorControllers.get(actor.actorId)! : undefined;
    const progressWatchdog = controller?.watchdog ?? (multi ? undefined : watchdog);
    const actorEmit = (type: string, fields: Record<string, unknown> = {}) => {
      if (actor && controller) {
        fields = { actorId: actor.actorId, userId: actor.userId, clientId: actor.clientId, ...fields };
        const event = { type, atMs: clock.now(), ...fields };
        controller.evidence.event(event);
        controller.coverage.event(event);
      }
      emit(type, fields);
    };
    const forActor = (snapshot: FrameSnapshot | undefined) => projectSnapshot(snapshot, actor);
    const recordLastAction = (actionId: string) => {
      if (controller) controller.lastActionId = actionId;
      else lastActionId = actionId;
    };

    const finishIntent = (snapshot: FrameSnapshot, verifiedTerminal = false) => {
      if (!activeIntent || (!verifiedTerminal && observer.snapshotHealthError(snapshot))) return;
      const completion = evaluateExpectations(
        activeIntent.baseline,
        snapshot.frame.state,
        activeIntent.definition.completeWhen,
      );
      if (completion.length && completion.every((check) => check.passed)) {
        actorEmit("intent_completed", {
          ...activeIntent.trace,
          intentId: activeIntent.definition.id,
          expectations: completion,
        });
        activeIntent = undefined;
      }
    };

    const usableTerminal = (): FrameSnapshot | undefined => {
      const latest = observer.latest;
      return latest && episodeTerminal(latest.frame) && observer.terminalFrameUsable(latest) ? latest : undefined;
    };

    const finishWithTerminal = async (latest: FrameSnapshot): Promise<void> => {
      await verifyOwnedSession(loopSignal);
      const current = forActor(latest);
      if (current) finishIntent(current, true);
      recordTerminal(latest.frame, latest.frame.revision);
    };

    const currentDecisionContext = (): PlaytestDecisionContext | undefined => {
      if (!actor && !activeIntent && recentActions.length === 0) return undefined;
      const context: PlaytestDecisionContext = {};
      if (actor) {
        context.actorId = actor.actorId;
        context.userId = actor.userId;
        const goal = options.actorGoals?.[actor.actorId] ?? options.goal;
        if (goal) context.goal = goal;
      }
      if (activeIntent) {
        context.activeIntent = { id: activeIntent.definition.id, elapsedMs: clock.now() - activeIntent.startedAtMs };
      }
      if (recentActions.length > 0) context.recentActions = structuredClone(recentActions);
      return context;
    };

    const coverageFields = (action: PlaytestAction | undefined, intentMode: boolean) => {
      const key = intentMode ? undefined : actionCoverageKey(action);
      return key ? { coverageKey: key } : {};
    };

    // Model waiting keeps watching for terminal frames and session changes; it never sends input.
    const chooseWithModel = async (
      before: FrameSnapshot,
      candidates: PlaytestDecisionCandidate[],
      intentMode: boolean,
      decisionTrace: DecisionTrace,
      runDeadline: number,
    ): Promise<
      { kind: "stop" } | { kind: "retry" } | { kind: "chosen"; choice: PlaytestChoice; visual?: PlaytestVisual }
    > => {
      const controllerContext = currentDecisionContext();
      let choiceVisual: PlaytestVisual | undefined;
      const decisionStartedAt = clock.now();
      const decisionController = new AbortController();
      decisionControllers.add(decisionController);
      const decisionSignal = AbortSignal.any([loopSignal, decisionController.signal]);
      const settle = (why: string) => {
        decisionController.abort(new DOMException(why, "AbortError"));
        decisionControllers.delete(decisionController);
      };
      let finishModelRequest: (() => void) | undefined;
      let modelPromise: Promise<PlaytestChoice>;
      try {
        modelPromise = (async () => {
          if (options.captureVisual) {
            choiceVisual = await options.captureVisual(structuredClone(before.frame), decisionSignal, { ...target! });
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
            actorEmit("visual_observation", {
              ...decisionTrace,
              ...(safeTraceValue(metadata) as Record<string, unknown>),
            });
            const current = observer.latest;
            if (
              clock.now() - metadata.capturedAtMs > config.maxVisualAgeMs ||
              !current ||
              observer.snapshotHealthError(current) ||
              !candidates.every((candidate) => actionStillValid(before.frame, current.frame, candidate.id, intentMode))
            ) {
              throw new StaleVisualError("Visual evidence or candidate context expired during capture");
            }
          }
          stats.modelCalls += 1;
          actorEmit("model_start", {
            ...decisionTrace,
            sequence: before.sequence,
            revision: before.frame.revision,
            gameTimeSeconds: before.frame.gameTimeSeconds,
            candidateIds: candidates.map((candidate) => candidate.id),
            candidates: candidates.map(({ id, description }) => ({ id, description })),
            ...(before.frame.decisionState ? { decisionState: safeTraceValue(before.frame.decisionState) } : {}),
            ...(controllerContext ? { controllerContext: safeTraceValue(controllerContext) } : {}),
          });
          finishModelRequest = concurrency.modelStart();
          return options.choose!(
            structuredClone(before.frame),
            structuredClone(candidates),
            decisionSignal,
            controllerContext,
            choiceVisual,
          );
        })();
      } catch (error) {
        settle("Choice failed");
        throw new Error(`Playtest chooser failed to start: ${describe(error)}`);
      }
      pendingDecisions.add(modelPromise);
      let choiceReady = false;
      let resolvedChoice: PlaytestChoice | undefined;
      let rejectedChoice: unknown;
      void modelPromise.then(
        (value) => {
          pendingDecisions.delete(modelPromise);
          finishModelRequest?.();
          resolvedChoice = value;
          choiceReady = true;
        },
        (error) => {
          pendingDecisions.delete(modelPromise);
          finishModelRequest?.();
          rejectedChoice = error;
          choiceReady = true;
        },
      );
      while (!choiceReady && clock.now() < runDeadline) {
        throwIfAborted(loopSignal);
        if (observer.failure) throw observer.failure;
        const observed = observer.latest;
        if (observed && observer.terminalFrameUsable(observed)) break;
        await refreshSessionIfDue(loopSignal);
        await clock.sleep(Math.min(50, Math.max(1, runDeadline - clock.now())), loopSignal);
      }
      throwIfAborted(loopSignal);
      const terminalSnapshot = usableTerminal();
      if (terminalSnapshot) {
        settle("Terminal frame observed");
        await finishWithTerminal(terminalSnapshot);
        return { kind: "stop" };
      }
      if (!choiceReady) {
        settle("Playtest deadline reached");
        outcome = "timeout";
        reason = "Model choice exceeded maxDurationMs";
        actorEmit("model_timeout", { ...decisionTrace, sequence: before.sequence });
        return { kind: "stop" };
      }
      if (rejectedChoice instanceof StaleVisualError) {
        settle("Visual observation expired");
        stats.invalidatedChoices += 1;
        actorEmit("choice_invalidated", { ...decisionTrace, reason: rejectedChoice.message });
        return { kind: "retry" };
      }
      if (rejectedChoice !== undefined) throw new Error(`Playtest chooser failed: ${describe(rejectedChoice)}`);
      if (!resolvedChoice) throw new Error("Playtest chooser returned no decision");
      settle("Choice completed");
      const choice = resolvedChoice;
      actorEmit("model_choice", {
        ...decisionTrace,
        actionId: choice.actionId,
        ...coverageFields(
          before.frame.actions.find((action) => action.id === choice.actionId),
          intentMode,
        ),
        diagnostics: choice.diagnostics ?? {},
        latencyMs: choice.latencyMs ?? clock.now() - decisionStartedAt,
        sequence: before.sequence,
      });
      return { kind: "chosen", choice, visual: choiceVisual };
    };

    const selectAction = async (
      before: FrameSnapshot,
      actions: PlaytestAction[],
      candidates: PlaytestDecisionCandidate[],
      intentMode: boolean,
      runDeadline: number,
    ): Promise<ActionSelection> => {
      const retained =
        activeIntent !== undefined &&
        (actions.length === 1 || clock.now() - lastPolicyAt < config.intentDecisionIntervalMs);
      if (multi && mode === "autonomous" && actions.length === 1 && !retained) {
        actorEmit("dispatch_blocked", {
          reason: "No model-selected intent and fewer than two alternatives; waiting for a meaningful model choice",
        });
        await observer.waitForNextFrame({
          afterSequence: before.sequence,
          deadlineMs: Math.min(runDeadline, clock.now() + 150),
          signal: loopSignal,
        });
        return { kind: "retry" };
      }
      let decisionSource: DecisionTrace["decisionSource"] = "model";
      if (actions.length === 1) decisionSource = "automatic";
      else if (mode === "verification") decisionSource = "scenario";
      const decisionTrace = retained ? activeIntent!.trace : { decisionId: ++stats.decisions, decisionSource };
      let choice: PlaytestChoice;
      let choiceVisual: PlaytestVisual | undefined;
      if (retained) {
        choice = { actionId: activeIntent!.definition.id };
      } else if (decisionSource !== "model") {
        // Singletons and verification scenarios run the adapter's first offered candidate.
        choice = {
          actionId: candidates[0].id,
          diagnostics: { decision: decisionSource === "automatic" ? "deterministic_singleton" : "scenario_order" },
          latencyMs: 0,
        };
        actorEmit(decisionSource === "automatic" ? "singleton_choice" : "scenario_choice", {
          ...decisionTrace,
          actionId: choice.actionId,
          ...coverageFields(actions[0], intentMode),
          ...(decisionSource === "scenario" ? { alternatives: candidates.length - 1 } : {}),
          sequence: before.sequence,
        });
      } else {
        const modelChoice = await chooseWithModel(before, candidates, intentMode, decisionTrace, runDeadline);
        if (modelChoice.kind !== "chosen") return modelChoice;
        choice = modelChoice.choice;
        choiceVisual = modelChoice.visual;
      }

      if (typeof choice.actionId !== "string" || !candidates.some((candidate) => candidate.id === choice.actionId)) {
        throw new Error("Playtest chooser returned an action id absent from its frame");
      }
      const terminalAfterChoice = usableTerminal();
      if (terminalAfterChoice) {
        await finishWithTerminal(terminalAfterChoice);
        return { kind: "stop" };
      }
      const latestAfterChoice = forActor(observer.latest);
      if (!latestAfterChoice) throw new AdapterError("no current frame after choice");
      const visualExpired = choiceVisual && clock.now() - choiceVisual.metadata.capturedAtMs > config.maxVisualAgeMs;
      const latestHealth = observer.snapshotHealthError(latestAfterChoice);
      if (
        visualExpired ||
        latestHealth ||
        !actionStillValid(before.frame, latestAfterChoice.frame, choice.actionId, intentMode)
      ) {
        stats.invalidatedChoices += 1;
        actorEmit("choice_invalidated", {
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

      await refreshSessionIfDue(loopSignal);
      const newest = forActor(observer.latest);
      if (
        !newest ||
        (choiceVisual && clock.now() - choiceVisual.metadata.capturedAtMs > config.maxVisualAgeMs) ||
        newest.frame.terminal ||
        observer.snapshotHealthError(newest) ||
        !actionStillValid(before.frame, newest.frame, choice.actionId, intentMode)
      ) {
        stats.invalidatedChoices += 1;
        actorEmit("choice_invalidated", {
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
          actorEmit("intent_selected", { ...decisionTrace, intentId: action.intent.id });
        } else activeIntent.trace = decisionTrace;
        if (!retained) lastPolicyAt = clock.now();
        finishIntent(newest);
        if (!activeIntent) return { kind: "retry" };
      }
      return { kind: "selected", action, beforeInput: newest, decisionTrace, intentMode, retained };
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
      if (multi && inputDurationMs > config.maxPhysicalBatchDurationMs) {
        throw new AdapterError(
          `Multiplayer physical step ${action.id} exceeds ${config.maxPhysicalBatchDurationMs} ms; split long approaches into retained intent steps`,
        );
      }
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
      if (intentMode) {
        actorEmit("intent_step", {
          ...executionTrace,
          actionId: action.id,
          ...(action.coverageKey ? { coverageKey: action.coverageKey } : {}),
        });
      }
      recordLastAction(action.id);
      actorEmit("action_dispatch", {
        ...executionTrace,
        actionId: action.id,
        ...coverageFields(action, false),
        description: action.description,
        sequence: beforeInput.sequence,
        revision: beforeInput.frame.revision,
        observationToDispatchMs: clock.now() - beforeInput.receivedAtMs,
        eventCount: expanded.sent.length,
        events: expanded.sent,
      });
      const inputClientId = actor?.clientId ?? target!.clientId;
      const inputCallStartedAtMs = clock.now();
      const finishInputCall = concurrency.inputStart(
        executionId,
        inputClientId,
        expanded.sent.some((event) => event.type !== "wait"),
        inputCallStartedAtMs,
      );
      actorEmit("input_start", {
        ...executionTrace,
        actionId: action.id,
        clientId: inputClientId,
        inputCallStartedAtMs,
        nativeInputStartedAtMs: null,
      });
      let inputReply: unknown;
      try {
        inputReply = await call(
          "game.input.inject",
          { pieSessionId: target!.pieSessionId, clientId: inputClientId, events: expanded.sent },
          { signal: loopSignal, timeoutMs: Math.max(1_000, Math.min(inputDurationMs + 15_000, remainingMs)) },
        );
        finishInputCall(clock.now(), asRecord(inputReply));
      } catch (error) {
        finishInputCall(clock.now());
        actorEmit("input_end", {
          ...executionTrace,
          actionId: action.id,
          clientId: inputClientId,
          inputCallStartedAtMs,
          inputCallEndedAtMs: clock.now(),
          nativeInputEndedAtMs: null,
          error: describe(error),
        });
        if (!isUserInterruptedInput(error)) throw error;
        outcome = "input_cancelled";
        reason = `Studio input for ${action.id} was interrupted by the user`;
        actorEmit("input_reply", {
          ...executionTrace,
          actionId: action.id,
          ...coverageFields(action, false),
          status: "cancelled",
          error: { code: error.code, reason: "interruptedByUser" },
        });
        return false;
      }
      const inputStatus = asRecord(inputReply)?.status;
      const executionReplyObservedAtMs = clock.now();
      actorEmit("input_end", {
        ...executionTrace,
        actionId: action.id,
        clientId: inputClientId,
        inputCallStartedAtMs,
        inputCallEndedAtMs: executionReplyObservedAtMs,
        executionReplyObservedAtMs,
        nativeInputEndedAtMs: null,
        status: inputStatus,
      });
      actorEmit("input_reply", {
        ...executionTrace,
        actionId: action.id,
        ...coverageFields(action, false),
        status: inputStatus,
        inputCallStartedAtMs,
        executionReplyObservedAtMs,
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
      const resultFrame = forActor(
        await observer.waitForNextFrame({
          afterSequence: beforeInput.sequence,
          afterTimeMs: inputCompletedAt,
          afterRevision: beforeInput.frame.revision,
          deadlineMs: Math.min(runDeadline, inputCompletedAt + EFFECT_WAIT_MS),
          signal: loopSignal,
        }),
      );
      if (!resultFrame) {
        const episodeExpired = clock.now() >= runDeadline;
        outcome = episodeExpired ? "timeout" : "error";
        reason = episodeExpired
          ? `maxDurationMs elapsed while awaiting the effect of ${action.id}`
          : `No newer game adapter frame after ${action.id} within ${EFFECT_WAIT_MS}ms`;
        actorEmit("action_result", { ...executionTrace, actionId: action.id, observed: false, reason });
        return false;
      }
      const healthy = !observer.snapshotHealthError(resultFrame);
      const expectations = healthy
        ? evaluateExpectations(beforeInput.frame.state, resultFrame.frame.state, action.expectations)
        : [];
      const effectStatus = actionEffectStatus(healthy, expectations);
      recentActions.push({
        actionId: action.id,
        ...(action.intent ? { intentId: action.intent.id } : {}),
        result: effectStatus,
      });
      if (recentActions.length > 3) recentActions = recentActions.slice(-3);
      if (
        effectStatus === "effect_confirmed" &&
        expanded.sent.some((event) => event.type !== "wait") &&
        expectations.some((check) => JSON.stringify(check.before) !== JSON.stringify(check.after))
      ) {
        progressWatchdog?.confirmEffect(clock.now());
      }
      actorEmit("action_result", {
        ...executionTrace,
        actionId: action.id,
        ...coverageFields(action, false),
        observed: !multi || healthy,
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

    const run = async (runDeadline: number): Promise<void> => {
      while (clock.now() < runDeadline) {
        throwIfAborted(loopSignal);
        if (observer.failure) throw observer.failure;
        const current = forActor(observer.latest);
        if (!current) throw new AdapterError("playtest observer lost its latest frame");
        if (current.frame.error) throw new AdapterError(current.frame.error.message);
        const terminalSnapshot = usableTerminal();
        if (terminalSnapshot) {
          await finishWithTerminal(terminalSnapshot);
          break;
        }
        if (multi && current.frame.terminal) {
          // This actor finished; keep its loop idle until the shared episode terminal arrives.
          await clock.sleep(Math.min(50, Math.max(1, runDeadline - clock.now())), loopSignal);
          continue;
        }
        const health = observer.snapshotHealthError(current);
        if (health) {
          actorEmit("dispatch_blocked", { reason: health, sequence: current.sequence });
          const next = await observer.waitForNextFrame({
            afterSequence: current.sequence,
            deadlineMs: runDeadline,
            signal: loopSignal,
          });
          if (!next) {
            outcome = "timeout";
            reason = `No healthy adapter frame before maxDurationMs (${health})`;
            break;
          }
          continue;
        }
        await refreshSessionIfDue(loopSignal);
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
            actorEmit("intent_invalidated", {
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
            signal: loopSignal,
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
    };

    return { run };
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

    const numberOfPlayer = options.numberOfPlayer ?? 1;
    await call("game.play", { numberOfPlayer }, { signal: userSignal, timeoutMs: 15_000 });
    startCommandAccepted = true;
    emit("pie_start_requested", { numberOfPlayer });
    const startupEnd = clock.now() + config.startupTimeoutMs;
    while (clock.now() < startupEnd) {
      throwIfAborted(userSignal);
      if (clock.now() - lastStatusAt >= STATUS_INTERVAL_MS) {
        const observedTarget = await statusTarget(userSignal);
        const statusSession = asRecord(lastStatus)?.pieSessionId;
        if (typeof statusSession === "string" && statusSession) {
          if (cleanup.sessionId && cleanup.sessionId !== statusSession) {
            throw new SessionChangedError("PIE session changed during startup");
          }
          cleanup.sessionId = statusSession;
          cleanup.ownedSession = true;
        }
        const clientsReady = !multi || injectableClients(lastStatus).length === 2;
        if (observedTarget && clientsReady) {
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

  /** Binds both real clients to authoritative actors once, from initial character positions or native user ids. */
  const bindActorLoops = async (initialFrame: FrameSnapshot): Promise<void> => {
    const initialActors = parseMultiplayerActors(initialFrame.frame);
    const reads = new Map<string, unknown>();
    for (const client of injectableClients(lastStatus)) {
      const clientId = client.clientId as string;
      reads.set(
        clientId,
        await call(
          "game.character.read",
          { pieSessionId: target!.pieSessionId, clientId },
          { signal: userSignal, timeoutMs: 5000 },
        ),
      );
    }
    bindings = bindActors(initialActors, lastStatus, reads);
    await verifyOwnedSession(userSignal);
    const latest = observer.latest;
    if (!latest || observer.snapshotHealthError(latest))
      throw new AdapterError("Initial actor binding requires a fresh healthy authoritative frame");
    assertActorBindings(bindings, parseMultiplayerActors(latest.frame));
    if (Object.keys(options.actorGoals ?? {}).some((id) => !bindings.some((binding) => binding.actorId === id)))
      throw new AdapterError("actorGoals contains an unknown actorId");
    for (const binding of bindings) {
      const projected = projectActorFrame(initialFrame.frame, binding.actorId);
      const actorWatchdog =
        config.stuckTimeoutMs > 0 ? createProgressWatchdog(config.stuckTimeoutMs, clock.now()) : undefined;
      actorWatchdog?.observe(projected.progress, clock.now());
      const coverage = createCoverageTracker();
      coverage.observe(projected);
      actorControllers.set(binding.actorId, {
        watchdog: actorWatchdog,
        coverage,
        evidence: createDecisionEvidenceTracker({ mode }),
        terminal: projected.terminal,
      });
    }
    emit("actor_bindings", { bindings, source: ACTOR_OBSERVATION_SOURCE });
  };

  const runActorLoops = async (runDeadline: number): Promise<void> => {
    const loopsStop = new AbortController();
    const loopSignal = AbortSignal.any([userSignal, loopsStop.signal]);
    let loopFailure: unknown;
    const tasks = (multi ? bindings : [undefined]).map(async (binding) => {
      try {
        await createActorLoop(loopSignal, binding).run(runDeadline);
      } catch (error) {
        if (error !== loopsStop.signal.reason && loopFailure === undefined) loopFailure = error;
      } finally {
        // One owner ends the episode; peers are cancelled, never replaced with a scripted policy.
        loopsStop.abort(new DOMException("Owned actor loops finished", "AbortError"));
        for (const controller of decisionControllers) controller.abort(loopsStop.signal.reason);
      }
    });
    await Promise.allSettled(tasks);
    await Promise.allSettled([...pendingDecisions]);
    if (loopFailure !== undefined) throw loopFailure;
    if (outcome === "error" && reason === "Playtest did not complete") {
      outcome = "timeout";
      reason = "maxDurationMs elapsed";
    }
  };

  const playObservedSession = async (expected: SessionTarget): Promise<void> => {
    const observerTask = observer.start(expected);
    const observerLinkAbort = () => observer.stop(userSignal.reason ?? new DOMException("Cancelled", "AbortError"));
    userSignal.addEventListener("abort", observerLinkAbort, { once: true });
    const runDeadline = clock.now() + config.maxDurationMs;
    try {
      const initialFrame = await observer.waitForStartupFrame(
        Math.min(runDeadline, clock.now() + config.startupTimeoutMs),
        userSignal,
      );
      if (!initialFrame) {
        outcome = "timeout";
        reason = "game-owned playtest frame did not arrive before startupTimeoutMs";
        return;
      }
      emit("startup_frame", { sequence: initialFrame.sequence, revision: initialFrame.frame.revision });
      if (multi) await bindActorLoops(initialFrame);
      if (config.stuckTimeoutMs > 0) {
        if (!multi) {
          watchdog = createProgressWatchdog(config.stuckTimeoutMs, clock.now());
          watchdog.observe(initialFrame.frame.progress, clock.now());
          emit("progress_watchdog_started", { ...watchdog.status(clock.now()) });
        }
        watchdogTask = watchProgress(runDeadline);
      }
      await runActorLoops(runDeadline);
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
    if (!cleanup.ownedSession || !cleanup.sessionId) return;
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
  };

  const perActorEvidence = (): Record<string, PerActorEvidence> =>
    Object.fromEntries(
      bindings
        .filter((binding) => actorControllers.has(binding.actorId))
        .map((binding) => {
          const controller = actorControllers.get(binding.actorId)!;
          const goal = options.actorGoals?.[binding.actorId] ?? options.goal;
          return [
            binding.actorId,
            {
              binding,
              decisionEvidence: controller.evidence.summary(),
              coverage: controller.coverage.summary(),
              ...(controller.terminal ? { terminal: controller.terminal } : {}),
              ...(goal ? { goal } : {}),
              observationSource: ACTOR_OBSERVATION_SOURCE,
            },
          ];
        }),
    );

  const run = async (): Promise<PlaytestResult> => {
    // Episode lifecycle: acquire ownership, observe/decide/act, then clean up even on failure.
    try {
      await startOwnedSession();
      if (target) {
        await playObservedSession(target);
      } else {
        outcome = "timeout";
        reason = multi
          ? "PIE did not expose two injectable clients before startupTimeoutMs"
          : "PIE did not expose an injectable client before startupTimeoutMs";
        emit("startup_timeout", { startupTimeoutMs: config.startupTimeoutMs });
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
      for (const controller of decisionControllers) controller.abort(new DOMException("Playtest ended", "AbortError"));
      await Promise.allSettled([...pendingDecisions]);
      decisionControllers.clear();
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

    const verification = checks.summary();
    return {
      outcome,
      reason,
      mode,
      ...(terminal ? { terminal } : {}),
      ...(stuck ? { stuck } : {}),
      verification,
      diagnostics: diagnostics.summary({ outcome, stats, verification, stuck }),
      stats,
      decisionEvidence: decisionEvidence.summary(),
      ...(multi ? { perActorEvidence: perActorEvidence(), concurrencyEvidence: concurrency.summary() } : {}),
      cleanup,
    };
  };

  return { run };
}

export type { PlaytestAction, PlaytestFrame } from "./frame";
export { parsePlaytestFrame } from "./frame";
