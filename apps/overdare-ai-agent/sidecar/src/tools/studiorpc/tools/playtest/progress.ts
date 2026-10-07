// @summary Tracks adapter sequence progress and bounded wait allowances for one playtest.
import type { PlaytestProgress } from "./frame";

const MAX_PROGRESS_WAIT_MS = 180_000;

export interface ProgressWatchdogStatus {
  stuck: boolean;
  timeoutMs: number;
  inactiveMs: number;
  deadlineMs: number;
  source: "adapter" | "effects";
  sequence?: number;
  waitingReason?: string;
}

export interface ProgressWatchdog {
  observe(progress: PlaytestProgress | undefined, now: number): void;
  confirmEffect(now: number): void;
  status(now: number): ProgressWatchdogStatus;
}

interface ActiveWait {
  startedAtMs: number;
  deadlineMs: number;
  reason: string;
}

function assertTimestamp(now: number): void {
  if (!Number.isFinite(now)) throw new RangeError("progress watchdog clock must be finite");
}

function assertProgress(progress: PlaytestProgress): void {
  if (!Number.isSafeInteger(progress.sequence) || progress.sequence < 0) {
    throw new RangeError("adapter progress sequence must be a safe nonnegative integer");
  }
  if (progress.waiting) {
    if (!progress.waiting.reason || !Number.isInteger(progress.waiting.timeoutMs)) {
      throw new RangeError("adapter progress waiting declaration is invalid");
    }
    if (progress.waiting.timeoutMs < 1 || progress.waiting.timeoutMs > MAX_PROGRESS_WAIT_MS) {
      throw new RangeError(`adapter progress wait must be in [1, ${MAX_PROGRESS_WAIT_MS}]ms`);
    }
  }
}

/**
 * Tracks local monotonic time without progress. Adapter sequence telemetry takes precedence over
 * completed-effect fallback, and a wait declaration can pause an epoch only once.
 */
export function createProgressWatchdog(timeoutMs: number, startedAtMs: number): ProgressWatchdog {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_PROGRESS_WAIT_MS) {
    throw new RangeError(`progress timeout must be in [1, ${MAX_PROGRESS_WAIT_MS}]ms`);
  }
  assertTimestamp(startedAtMs);

  let source: ProgressWatchdogStatus["source"] = "effects";
  let sequence: number | undefined;
  let epochStartedAtMs = startedAtMs;
  let committedPauseMs = 0;
  let activeWait: ActiveWait | undefined;
  let waitUsedInEpoch = false;
  let lastNow = startedAtMs;

  const checkTime = (now: number): void => {
    assertTimestamp(now);
    if (now < lastNow) throw new RangeError("progress watchdog clock regressed");
    lastNow = now;
  };

  const settleExpiredWait = (now: number): void => {
    if (!activeWait || now < activeWait.deadlineMs) return;
    committedPauseMs += activeWait.deadlineMs - activeWait.startedAtMs;
    activeWait = undefined;
  };

  const finishWaitEarly = (now: number): void => {
    if (!activeWait) return;
    committedPauseMs += Math.max(0, now - activeWait.startedAtMs);
    activeWait = undefined;
  };

  const beginWaitIfAvailable = (progress: PlaytestProgress, now: number): void => {
    if (!progress.waiting || waitUsedInEpoch || activeWait) return;
    waitUsedInEpoch = true;
    activeWait = {
      startedAtMs: now,
      deadlineMs: now + progress.waiting.timeoutMs,
      reason: progress.waiting.reason,
    };
  };

  const observe = (progress: PlaytestProgress | undefined, now: number): void => {
    checkTime(now);
    settleExpiredWait(now);
    if (!progress) return;
    assertProgress(progress);

    if (sequence !== undefined && progress.sequence < sequence) {
      throw new Error(`adapter progress sequence regressed (${progress.sequence} < ${sequence})`);
    }

    if (sequence === undefined) {
      // The first telemetry frame identifies the source and sequence; it is not itself progress.
      source = "adapter";
      sequence = progress.sequence;
    } else if (progress.sequence > sequence) {
      sequence = progress.sequence;
      epochStartedAtMs = now;
      committedPauseMs = 0;
      activeWait = undefined;
      waitUsedInEpoch = false;
    }

    if (progress.waiting) beginWaitIfAvailable(progress, now);
    else finishWaitEarly(now);
  };

  const confirmEffect = (now: number): void => {
    checkTime(now);
    settleExpiredWait(now);
    if (source === "effects") {
      epochStartedAtMs = now;
      committedPauseMs = 0;
      activeWait = undefined;
      waitUsedInEpoch = false;
    }
  };

  const status = (now: number): ProgressWatchdogStatus => {
    checkTime(now);
    settleExpiredWait(now);
    const activePauseMs = activeWait ? Math.max(0, Math.min(now, activeWait.deadlineMs) - activeWait.startedAtMs) : 0;
    const inactiveMs = Math.max(0, now - epochStartedAtMs - committedPauseMs - activePauseMs);
    const deadlineMs =
      epochStartedAtMs +
      timeoutMs +
      committedPauseMs +
      (activeWait ? activeWait.deadlineMs - activeWait.startedAtMs : 0);
    return {
      stuck: inactiveMs >= timeoutMs,
      timeoutMs,
      inactiveMs,
      deadlineMs,
      source,
      ...(sequence === undefined ? {} : { sequence }),
      ...(activeWait ? { waitingReason: activeWait.reason } : {}),
    };
  };

  return { observe, confirmEffect, status };
}
