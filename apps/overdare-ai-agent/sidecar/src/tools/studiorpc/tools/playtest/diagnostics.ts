// @summary Condenses an episode trace into the facts needed to diagnose a failed, stuck or suspicious run.
import type { VerificationSummary } from "./checks";
import type { PlaytestEvent, PlaytestResult, PlaytestStats } from "./runtime-types";

export interface ReadinessWaitSummary {
  /** Episode phase when the wait was observed: startup until the first healthy frame, then running. */
  phase: PlaytestDiagnostics["phase"];
  section: string;
  reason: string;
  count: number;
}

export interface UnmetExpectationSummary {
  key: string;
  op: string;
  count: number;
}

export interface LastActionSummary {
  actionId: string;
  actorId?: string;
  decisionSource?: string;
  inputStatus?: string;
  observed?: boolean;
  failedExpectations: string[];
  reason?: string;
}

export interface PlaytestDiagnostics {
  /** startup: no healthy initial frame was accepted; running: the decision loop started. */
  phase: "startup" | "running";
  framesObserved: number;
  readinessWaits: ReadinessWaitSummary[];
  lastDispatchBlocked?: string;
  observerError?: string;
  lastAction?: LastActionSummary;
  actionResults: { total: number; withUnmetExpectations: number; unobserved: number };
  unmetExpectations: UnmetExpectationSummary[];
  /** Plain-language next checks derived from the facts above; never a verdict. */
  hints: string[];
}

export interface DiagnosticsInput {
  outcome: PlaytestResult["outcome"];
  stats: PlaytestStats;
  verification: VerificationSummary;
  stuck?: PlaytestResult["stuck"];
}

export interface DiagnosticsTracker {
  event(event: PlaytestEvent): void;
  summary(input: DiagnosticsInput): PlaytestDiagnostics;
}

const MAX_READINESS_ROWS = 5;
const MAX_UNMET_ROWS = 8;

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function failedExpectationLabels(expectations: unknown): Array<{ key: string; op: string }> {
  if (!Array.isArray(expectations)) return [];
  const failed: Array<{ key: string; op: string }> = [];
  for (const expectation of expectations) {
    if (typeof expectation !== "object" || expectation === null) continue;
    const record = expectation as Record<string, unknown>;
    if (record.passed === true) continue;
    failed.push({ key: String(record.key ?? "?"), op: String(record.op ?? "?") });
  }
  return failed;
}

export function createDiagnosticsTracker(): DiagnosticsTracker {
  let phase: PlaytestDiagnostics["phase"] = "startup";
  let framesObserved = 0;
  const readiness = new Map<string, ReadinessWaitSummary>();
  let lastDispatchBlocked: string | undefined;
  let observerError: string | undefined;
  let lastAction: LastActionSummary | undefined;
  const actionResults = { total: 0, withUnmetExpectations: 0, unobserved: 0 };
  const unmet = new Map<string, UnmetExpectationSummary>();

  return {
    event(event) {
      switch (event.type) {
        case "observation":
          framesObserved += 1;
          return;
        case "startup_frame":
          phase = "running";
          return;
        case "readiness_wait": {
          const row = {
            phase,
            section: text(event.section) ?? "unknown",
            reason: text(event.reason) ?? "unknown",
          };
          const key = `${row.phase}\u0000${row.section}\u0000${row.reason}`;
          const existing = readiness.get(key);
          if (existing) existing.count += 1;
          else readiness.set(key, { ...row, count: 1 });
          return;
        }
        case "dispatch_blocked":
          lastDispatchBlocked = text(event.reason);
          return;
        case "observer_error":
          observerError = text(event.error);
          return;
        case "action_dispatch":
          lastAction = {
            actionId: text(event.actionId) ?? "?",
            ...(text(event.actorId) ? { actorId: text(event.actorId) } : {}),
            ...(text(event.decisionSource) ? { decisionSource: text(event.decisionSource) } : {}),
            failedExpectations: [],
          };
          return;
        case "input_reply":
          if (lastAction && event.actionId === lastAction.actionId && text(event.status)) {
            lastAction.inputStatus = text(event.status);
          }
          return;
        case "action_result": {
          actionResults.total += 1;
          if (event.observed !== true) actionResults.unobserved += 1;
          const failed = failedExpectationLabels(event.expectations);
          if (failed.length > 0) actionResults.withUnmetExpectations += 1;
          for (const { key, op } of failed) {
            const id = `${key}\u0000${op}`;
            const existing = unmet.get(id);
            if (existing) existing.count += 1;
            else unmet.set(id, { key, op, count: 1 });
          }
          if (lastAction && event.actionId === lastAction.actionId) {
            lastAction.observed = event.observed === true;
            lastAction.failedExpectations = failed.map(({ key, op }) => `${key} ${op}`);
            if (text(event.reason)) lastAction.reason = text(event.reason);
          }
          return;
        }
      }
    },

    summary({ outcome, stats, verification, stuck }) {
      const readinessWaits = [...readiness.values()].sort((a, b) => b.count - a.count).slice(0, MAX_READINESS_ROWS);
      const unmetExpectations = [...unmet.values()].sort((a, b) => b.count - a.count).slice(0, MAX_UNMET_ROWS);
      const hints: string[] = [];
      const topWait = readinessWaits[0];
      const topWaitText = topWait
        ? ` Most frequent wait: ${topWait.section}: ${topWait.reason} (x${topWait.count}).`
        : "";

      if (phase === "startup" && outcome === "timeout") {
        if (framesObserved === 0) {
          hints.push(
            `No adapter frame was read. Check that the managed driver LocalScript is installed and running and that game.observe can see the frame StringValue.${topWaitText}`,
          );
        } else {
          hints.push(
            `Frames arrived but never became ready (adapter ready=false or missing client identity). Check what start()/observe() wait for; instances created by server scripts may not have replicated to the client yet.${topWaitText}`,
          );
        }
      }
      if (lastAction && lastAction.observed === false && lastAction.reason) {
        hints.push(
          `No fresh frame followed ${lastAction.actionId} (max observe latency ${Math.round(stats.maxObserveLatencyMs)} ms). Look for observe() errors or yields while that input ran.`,
        );
      }
      if (actionResults.withUnmetExpectations > 0) {
        const top = unmetExpectations
          .slice(0, 3)
          .map((row) => `${row.key} ${row.op} x${row.count}`)
          .join(", ");
        hints.push(
          `${actionResults.withUnmetExpectations}/${actionResults.total} action results had unmet expectations (${top}). Separate expected waits from failed effects before reporting the run as verified.`,
        );
      }
      if (outcome === "success" && (verification.status === "failed" || verification.status === "incomplete")) {
        hints.push(
          `The game terminal reported success but requirement checks are ${verification.status}; report the requirement verdict, not only the terminal.`,
        );
      }
      if ((outcome === "failure" || outcome === "stuck") && verification.status === "not_declared") {
        hints.push(
          "Declare requirement checks in the adapter so a failure names the unmet requirement instead of a harness step.",
        );
      }
      if (outcome === "stuck" && stuck) {
        const after = stuck.lastActionId ? ` after ${stuck.lastActionId}` : "";
        hints.push(
          `progress.sequence did not advance for ${Math.round(stuck.inactiveMs)} ms${after}. Confirm whether that action changed state before adjusting timeouts.`,
        );
      }

      return {
        phase,
        framesObserved,
        readinessWaits,
        ...(lastDispatchBlocked ? { lastDispatchBlocked } : {}),
        ...(observerError ? { observerError } : {}),
        ...(lastAction ? { lastAction: structuredClone(lastAction) } : {}),
        actionResults: { ...actionResults },
        unmetExpectations,
        hints,
      };
    },
  };
}
