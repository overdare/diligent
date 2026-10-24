// @summary Keeps provenance and adverse run facts in bounded tool output while full evidence remains on disk.
import type { CoverageSummary } from "./coverage";
import type { DriverRestoration } from "./driver-state";
import type { RepeatedFailure } from "./run-history";
import type { PlaytestResult } from "./runtime-types";

export interface RunEvidence extends PlaytestResult {
  runId: string;
  harnessName: string;
  sourceHash: string;
  summaryPath: string;
  tracePath: string;
  coveragePath: string;
  decisionConfig: Record<string, unknown>;
  runConfig: Record<string, unknown>;
  coverage: CoverageSummary;
  driver?: DriverRestoration;
  warning?: string;
  repeatedFailure?: RepeatedFailure;
}

function clip(value: string | undefined, maximum = 320): string | undefined {
  return value !== undefined && value.length > maximum ? `${value.slice(0, maximum)}...` : value;
}
function compactCoverage(value: CoverageSummary) {
  return {
    scope: value.scope,
    status: value.status,
    totalTargets: value.totalTargets,
    coveredTargets: value.coveredTargets,
    percentage: value.percentage,
  };
}

export function compactRunEvidence(evidence: RunEvidence) {
  const checks = evidence.verification.checks;
  const attention = checks.filter((check) => check.status !== "pass" || check.everFailed);
  const listed = attention.slice(0, 8).map(({ id, basis, status, everFailed }) => ({ id, basis, status, everFailed }));
  const base = {
    runId: evidence.runId,
    summaryPath: evidence.summaryPath,
    tracePath: evidence.tracePath,
    coveragePath: evidence.coveragePath,
    outputMode: "compact",
    harnessName: evidence.harnessName,
    sourceHash: evidence.sourceHash,
    mode: evidence.mode,
    outcome: evidence.outcome,
    reason: clip(evidence.reason),
    terminal: evidence.terminal
      ? { outcome: evidence.terminal.outcome, reason: clip(evidence.terminal.reason) }
      : undefined,
    verification: {
      status: evidence.verification.status,
      requirement: evidence.verification.requirement,
      auxiliary: evidence.verification.auxiliary,
      checks: listed,
      omittedChecks: checks.length - listed.length,
      omittedAttentionChecks: attention.length - listed.length,
    },
    decisionEvidence: evidence.decisionEvidence,
    cleanup: {
      ...evidence.cleanup,
      reason: clip(evidence.cleanup.reason),
      sessionId: clip(evidence.cleanup.sessionId),
    },
    driver: evidence.driver ? { ...evidence.driver, error: clip(evidence.driver.error) } : undefined,
    warning: clip(evidence.warning),
    repeatedFailure: evidence.repeatedFailure,
    detail:
      "Full persisted summary, checks and actor evidence: summaryPath. Coverage targets: coveragePath. Raw events: tracePath. Game outcome is not product acceptance.",
  };
  const diagnostics = evidence.diagnostics;
  const config = (value: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item === null || ["number", "boolean", "string"].includes(typeof item))
        .map(([key, item]) => [key, typeof item === "string" ? clip(item, 240) : item]),
    );
  const compact = {
    ...base,
    stats: evidence.stats,
    decisionConfig: config(evidence.decisionConfig),
    runConfig: config(evidence.runConfig),
    coverage: compactCoverage(evidence.coverage),
    diagnostics: {
      phase: diagnostics.phase,
      framesObserved: diagnostics.framesObserved,
      actionResults: diagnostics.actionResults,
      observerError: clip(diagnostics.observerError),
      lastDispatchBlocked: clip(diagnostics.lastDispatchBlocked),
      hints: diagnostics.hints.slice(0, 5).map((hint) => clip(hint)),
      lastAction: diagnostics.lastAction
        ? {
            actionId: diagnostics.lastAction.actionId,
            actorId: diagnostics.lastAction.actorId,
            decisionSource: diagnostics.lastAction.decisionSource,
            inputStatus: diagnostics.lastAction.inputStatus,
            observed: diagnostics.lastAction.observed,
            reason: clip(diagnostics.lastAction.reason),
            failedExpectations: diagnostics.lastAction.failedExpectations.slice(0, 8).map((key) => clip(key, 128)),
          }
        : undefined,
      readinessWaits: diagnostics.readinessWaits
        .slice(0, 5)
        .map((wait) => ({ ...wait, section: clip(wait.section, 128), reason: clip(wait.reason) })),
      unmetExpectations: diagnostics.unmetExpectations
        .slice(0, 8)
        .map((expectation) => ({ ...expectation, key: clip(expectation.key, 128) })),
    },
    concurrencyEvidence: evidence.concurrencyEvidence
      ? {
          executionMode: evidence.concurrencyEvidence.executionMode,
          modelRequestsMaxInFlight: evidence.concurrencyEvidence.modelRequestsMaxInFlight,
          inputCallsMaxInFlight: evidence.concurrencyEvidence.inputCallsMaxInFlight,
          physicalRpcOverlapPairs: evidence.concurrencyEvidence.physicalRpcOverlapPairs,
          nativeInputOverlapPairs: evidence.concurrencyEvidence.nativeInputOverlapPairs,
          nativeExecutionTiming: evidence.concurrencyEvidence.nativeExecutionTiming,
          inputTimingsRecorded: evidence.concurrencyEvidence.inputTimings.length,
          inputTimingsDropped: evidence.concurrencyEvidence.inputTimingsDropped,
        }
      : undefined,
    perActorEvidence: evidence.perActorEvidence
      ? Object.fromEntries(
          Object.entries(evidence.perActorEvidence).map(([id, actor]) => [
            id,
            {
              binding: actor.binding,
              decisionEvidence: actor.decisionEvidence,
              coverage: compactCoverage(actor.coverage),
              terminal: actor.terminal
                ? { outcome: actor.terminal.outcome, reason: clip(actor.terminal.reason) }
                : undefined,
              observationSource: actor.observationSource,
              goal: clip(actor.goal),
              source: actor.source,
            },
          ]),
        )
      : undefined,
  };
  if (Buffer.byteLength(JSON.stringify(compact, null, 2)) <= 32_000) return compact;
  // Keep all aggregate adverse counts even when unusually large actor/concurrency diagnostics exceed the budget.
  return {
    ...base,
    outputMode: "minimal",
    verification: {
      ...base.verification,
      checks: [],
      omittedChecks: checks.length,
      omittedAttentionChecks: attention.length,
    },
  };
}
