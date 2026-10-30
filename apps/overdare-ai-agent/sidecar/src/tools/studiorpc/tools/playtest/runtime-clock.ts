// @summary Monotonic episode clock and abort-aware sleeps.
import { performance } from "node:perf_hooks";
import type { PlaytestClock } from "./runtime-types";

export function makeAbortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("Playtest cancelled", "AbortError");
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw makeAbortError(signal);
}

export const defaultClock: PlaytestClock = {
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
