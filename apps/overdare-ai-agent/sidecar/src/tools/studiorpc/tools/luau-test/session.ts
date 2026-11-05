// @summary Starts one owned PIE session, collects runner reports for the requested contexts, and stops only that session.
import type { call } from "../../rpc";
import { resultNameFor, type TestContext } from "./framework";

type Rpc = typeof call;

export interface ContextReport {
  context: TestContext;
  runId?: string;
  done: boolean;
  modules?: string[];
  counts?: { ran: number; passed: number; failed: number; skipped: number };
  results?: Array<{
    suite?: string;
    name: string;
    status: "pass" | "fail" | "skip";
    failures: Array<Record<string, unknown>>;
  }>;
  omittedResults?: number;
  loadErrors?: Array<{ module: string; suite?: string; message: string }>;
  runError?: string;
}

export interface SessionCleanup {
  pieSessionId?: string;
  stopAttempted: boolean;
  stopped: boolean;
  reason: string;
}

export interface OwnedSessionResult {
  reports: Partial<Record<TestContext, ContextReport>>;
  timedOut: boolean;
  error?: string;
  cleanup: SessionCleanup;
}

const POLL_INTERVAL_MS = 500;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Extracts a runner report for this run from a game.observe reply; anything else means "not yet". */
export function reportFromObservation(observation: unknown, context: TestContext, runId: string) {
  const section = record(record(observation)?.instances);
  const data = record(section?.data) ?? section;
  const entries = Array.isArray(data?.instances) ? data.instances : [];
  const name = resultNameFor(context);
  for (const entry of entries) {
    const instance = record(entry);
    if (instance?.name !== name && instance?.path !== name) continue;
    const value = record(instance?.Value);
    if (value?.Type !== "String" || typeof value.String !== "string") return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(value.String);
    } catch {
      return undefined;
    }
    const report = record(parsed) as ContextReport | undefined;
    if (!report?.done || report.runId !== runId) return undefined;
    return { ...report, context };
  }
  return undefined;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const timer = setTimeout(resolve, ms);
  signal.addEventListener(
    "abort",
    () => {
      clearTimeout(timer);
      reject(signal.reason);
    },
    { once: true },
  );
  return promise;
}

export async function runOwnedTestSession(options: {
  callRpc: Rpc;
  runId: string;
  contexts: TestContext[];
  timeoutMs: number;
  signal: AbortSignal;
  /** Test seam; production polls every 500 ms. */
  pollIntervalMs?: number;
}): Promise<OwnedSessionResult> {
  const { callRpc, runId, contexts, timeoutMs, signal, pollIntervalMs = POLL_INTERVAL_MS } = options;
  const reports: Partial<Record<TestContext, ContextReport>> = {};
  const cleanup: SessionCleanup = { stopAttempted: false, stopped: false, reason: "PIE was not started" };
  const status = record(await callRpc("game.pie.status", {}, { signal, timeoutMs: 5_000 }));
  if (status?.running === true)
    throw new Error("Stop PIE before running Luau tests; an existing session is never reused");

  let timedOut = false;
  let error: string | undefined;
  let started = false;
  try {
    await callRpc("game.play", { numberOfPlayer: 1 }, { signal, timeoutMs: 15_000 });
    started = true;
    const deadline = Date.now() + timeoutMs;
    while (contexts.some((context) => !reports[context])) {
      if (Date.now() >= deadline) {
        timedOut = true;
        break;
      }
      await sleep(pollIntervalMs, signal);
      const current = record(await callRpc("game.pie.status", {}, { signal, timeoutMs: 5_000 }));
      const sessionId = typeof current?.pieSessionId === "string" ? current.pieSessionId : undefined;
      if (current?.running !== true || !sessionId) continue;
      if (cleanup.pieSessionId && cleanup.pieSessionId !== sessionId)
        throw new Error("PIE session changed while tests were running");
      cleanup.pieSessionId = sessionId;
      // game.observe answers only once a play-test client exists, even for the authority world.
      const clients = Array.isArray(current.clients) ? current.clients : [];
      if (!clients.some((client) => record(client)?.injectable === true)) continue;
      for (const context of contexts) {
        if (reports[context]) continue;
        const observation = await callRpc(
          "game.observe",
          {
            instances: {
              targets: [resultNameFor(context)],
              properties: true,
              world: context === "server" ? "authority" : "client",
            },
          },
          { signal, timeoutMs: 5_000 },
        );
        const report = reportFromObservation(observation, context, runId);
        if (report) reports[context] = report;
      }
    }
  } catch (caught) {
    if (signal.aborted) throw caught;
    error = caught instanceof Error ? caught.message : String(caught);
  } finally {
    if (started) await stopOwnedSession(callRpc, cleanup);
  }
  return { reports, timedOut, ...(error ? { error } : {}), cleanup };
}

async function stopOwnedSession(callRpc: Rpc, cleanup: SessionCleanup): Promise<void> {
  // Cleanup runs even after cancellation, with its own bounded deadline.
  const cleanupSignal = AbortSignal.timeout(15_000);
  try {
    const status = record(await callRpc("game.pie.status", {}, { signal: cleanupSignal, timeoutMs: 5_000 }));
    const sessionId = typeof status?.pieSessionId === "string" ? status.pieSessionId : undefined;
    if (status?.running !== true) {
      cleanup.reason = "PIE had already stopped";
      return;
    }
    if (cleanup.pieSessionId && sessionId !== cleanup.pieSessionId) {
      cleanup.reason = "PIE session was replaced; left it untouched";
      return;
    }
    cleanup.pieSessionId ??= sessionId;
    cleanup.stopAttempted = true;
    await callRpc("game.stop", {}, { signal: cleanupSignal, timeoutMs: 10_000 });
    cleanup.stopped = true;
    cleanup.reason = "stopped the PIE session started by this test run";
  } catch (error) {
    cleanup.reason = `could not verify/stop the owned PIE session: ${error instanceof Error ? error.message : String(error)}`;
  }
}
