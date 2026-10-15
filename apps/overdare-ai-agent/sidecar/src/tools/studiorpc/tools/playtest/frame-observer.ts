// @summary Continuously reads adapter frames and exposes freshness-aware waits to the episode runner.
import type { call } from "../../rpc";
import { type PlaytestFrame, parsePlaytestFrame, safeTraceValue } from "./frame";
import {
  AdapterError,
  adapterFrameReady,
  frameStringValue,
  observedClientId,
  unavailableSectionReason,
} from "./observation";
import { throwIfAborted } from "./runtime-clock";
import type {
  FrameSnapshot,
  PlaytestClock,
  PlaytestStats,
  RunPlaytestOptions,
  SessionTarget,
  UnavailableFrameObservation,
} from "./runtime-types";

export class SessionChangedError extends Error {}

interface FrameObserverOptions {
  callRpc: typeof call;
  clock: PlaytestClock;
  harnessId: string;
  frameName: string;
  stats: PlaytestStats;
  emit: (type: string, fields?: Record<string, unknown>) => void;
  onFrame?: RunPlaytestOptions["onFrame"];
  onHealthyFrame: (frame: PlaytestFrame, receivedAtMs: number) => void;
  refreshSessionIfDue: (signal: AbortSignal) => Promise<void>;
  verifyOwnedSession: (signal: AbortSignal) => Promise<void>;
}

const OBSERVE_PARAMS = (frameName: string) => ({
  character: true,
  instances: { targets: [frameName], properties: true },
});
const OBSERVE_INTERVAL_MS = 100;
const FRESHNESS_LIMIT_MS = 800;

export function createFrameObserver(options: FrameObserverOptions) {
  const { clock, stats, emit, refreshSessionIfDue, verifyOwnedSession } = options;
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
  const seenGameEventIds = new Set<string>();
  const gameEventOrder: string[] = [];

  const publish = () => {
    resolvePublication?.();
    publication = new Promise<void>((resolve) => {
      resolvePublication = resolve;
    });
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
        const observation = await options.callRpc("game.observe", OBSERVE_PARAMS(options.frameName), {
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
        if (!frame.terminal && !snapshotHealthError(latest)) {
          options.onHealthyFrame(frame, receivedAtMs);
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
        emit("observer_error", { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
      }
      publish();
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

  return {
    get latest() {
      return latest;
    },
    get failure() {
      return observerFailure;
    },
    signal: observerController.signal,
    start: observerLoop,
    stop(reason: Error) {
      observerController.abort(reason);
    },
    reportFailure(error: unknown) {
      observerFailure = error instanceof Error ? error : new Error(String(error));
      publish();
    },
    snapshotHealthError,
    terminalFrameUsable,
    waitForNextFrame,
    waitForStartupFrame,
  };
}
