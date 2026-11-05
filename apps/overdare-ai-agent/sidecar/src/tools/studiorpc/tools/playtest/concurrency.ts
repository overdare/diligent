// @summary Measures model/RPC concurrency without claiming native input execution overlap.

export interface InputTiming {
  executionId: number;
  clientId: string;
  physical: boolean;
  callStartedAtMs: number;
  callEndedAtMs: number;
  executionReplyObservedAtMs?: number;
  status?: unknown;
  nativeInputStartedAtMs: null;
  nativeInputEndedAtMs: null;
}

export interface ConcurrencySummary {
  executionMode: "concurrent";
  modelRequestsMaxInFlight: number;
  inputCallsMaxInFlight: number;
  physicalRpcOverlapPairs: number;
  nativeInputOverlapPairs: null;
  nativeExecutionTiming: "not_reported_by_transport";
  inputTimings: InputTiming[];
  inputTimingsDropped: number;
}

export interface ConcurrencyTracker {
  /** Returns an idempotent finisher for one model request. */
  modelStart(): () => void;
  /** Returns the finisher for one input RPC; reply is present only when Studio answered. */
  inputStart(
    executionId: number,
    clientId: string,
    physical: boolean,
    callStartedAtMs: number,
  ): (callEndedAtMs: number, reply?: { status?: unknown }) => void;
  summary(): ConcurrencySummary;
}

const MAX_INPUT_TIMINGS = 256;

export function createConcurrencyTracker(): ConcurrencyTracker {
  let models = 0;
  let modelRequestsMaxInFlight = 0;
  let inputCallsMaxInFlight = 0;
  let physicalRpcOverlapPairs = 0;
  const active = new Map<number, { clientId: string; physical: boolean }>();
  const inputs: InputTiming[] = [];
  let inputTimingsDropped = 0;
  return {
    modelStart() {
      modelRequestsMaxInFlight = Math.max(modelRequestsMaxInFlight, ++models);
      let finished = false;
      return () => {
        if (!finished) {
          finished = true;
          models--;
        }
      };
    },
    inputStart(executionId, clientId, physical, callStartedAtMs) {
      if (physical) {
        for (const other of active.values())
          if (other.physical && other.clientId !== clientId) physicalRpcOverlapPairs++;
      }
      active.set(executionId, { clientId, physical });
      inputCallsMaxInFlight = Math.max(inputCallsMaxInFlight, active.size);
      return (callEndedAtMs, reply) => {
        active.delete(executionId);
        if (inputs.length >= MAX_INPUT_TIMINGS) {
          inputs.shift();
          inputTimingsDropped++;
        }
        inputs.push({
          executionId,
          clientId,
          physical,
          callStartedAtMs,
          callEndedAtMs,
          ...(reply ? { executionReplyObservedAtMs: callEndedAtMs, status: reply.status } : {}),
          // Socket lifetime and requested duration cannot identify native execution intervals.
          nativeInputStartedAtMs: null,
          nativeInputEndedAtMs: null,
        });
      };
    },
    summary() {
      return {
        executionMode: "concurrent",
        modelRequestsMaxInFlight,
        inputCallsMaxInFlight,
        physicalRpcOverlapPairs,
        nativeInputOverlapPairs: null,
        nativeExecutionTiming: "not_reported_by_transport",
        inputTimings: [...inputs],
        inputTimingsDropped,
      };
    },
  };
}
