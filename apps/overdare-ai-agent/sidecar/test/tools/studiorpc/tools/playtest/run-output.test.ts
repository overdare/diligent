// @summary Compact results keep provenance and adverse verdicts while leaving large evidence in saved artifacts.
import { expect, test } from "bun:test";
import { compactRunEvidence, type RunEvidence } from "../../../../../src/tools/studiorpc/tools/playtest/run-output";

function evidence(): RunEvidence {
  return {
    runId: "1700000000000-aaaaaaaa",
    harnessName: "sample",
    sourceHash: "a".repeat(64),
    summaryPath: "/project/.overdare/playtests/run/summary.json",
    tracePath: "/project/.overdare/playtests/run/trace.jsonl",
    coveragePath: "/project/.overdare/playtests/run/coverage.json",
    mode: "verification",
    outcome: "success",
    reason: "Terminal reached",
    terminal: { outcome: "success" },
    verification: {
      status: "incomplete",
      requirement: { total: 32, passed: 0, failed: 0, pending: 32 },
      auxiliary: { total: 0, passed: 0, failed: 0, pending: 0 },
      checks: Array.from({ length: 32 }, (_, index) => ({
        id: `criterion-${index}`,
        basis: "requirement",
        status: "pending",
        everFailed: false,
        description: "Observed criterion",
        detail: { observations: "large saved detail".repeat(1000) },
        transitions: [],
      })),
    },
    diagnostics: {
      phase: "running",
      framesObserved: 1,
      readinessWaits: [],
      actionResults: { total: 0, withUnmetExpectations: 0, unobserved: 0 },
      unmetExpectations: [],
      hints: [],
    },
    decisionEvidence: {
      status: "not_applicable",
      modelRequests: 0,
      modelChoices: 0,
      modelDispatches: 0,
      modelEffectsConfirmed: 0,
      automaticDispatches: 0,
      scenarioDispatches: 0,
    },
    stats: {
      elapsedMs: 1,
      observations: 1,
      observationErrors: 0,
      modelCalls: 0,
      decisions: 0,
      dispatchedActions: 0,
      invalidatedChoices: 0,
      gameEventsEmitted: 0,
      duplicateGameEvents: 0,
      statusChecks: 1,
      traceEvents: 0,
      traceEventsDropped: 0,
      logCallbackErrors: 0,
      maxObserveLatencyMs: 1,
      maxObservationAgeMs: 1,
    },
    cleanup: { ownedSession: true, statusChecked: true, stopAttempted: true, stopped: true, reason: "Stopped" },
    driver: {
      guid: "driver",
      originalEnabled: false,
      temporarilyEnabled: true,
      restoration: "failed",
      error: "External PIE prevents restoration",
    },
    decisionConfig: { provider: "none", observationMode: "structured" },
    runConfig: { mode: "verification", numberOfPlayer: 1 },
    coverage: {
      scope: "declared_test_targets",
      status: "not_declared",
      totalTargets: 0,
      coveredTargets: 0,
      targets: [],
    },
  };
}

test("paths precede bounded check summaries without conflating success with acceptance or cleanup", () => {
  const input = evidence();
  input.reason = "Long diagnostic ".repeat(50_000);
  input.diagnostics.observerError = "Untrusted native error ".repeat(50_000);
  input.verification.checks[0].status = "pass";
  input.verification.checks[0].everFailed = true;
  input.verification.requirement.passed = 1;
  input.verification.requirement.pending = 31;
  const result = compactRunEvidence(input);
  const output = JSON.stringify(result, null, 2);
  expect(Buffer.byteLength(output)).toBeLessThanOrEqual(32_000);
  expect(Object.keys(result).slice(0, 4)).toEqual(["runId", "summaryPath", "tracePath", "coveragePath"]);
  expect(result.outcome).toBe("success");
  expect(result.verification.status).toBe("incomplete");
  expect(result.verification.requirement).toEqual({ total: 32, passed: 1, failed: 0, pending: 31 });
  expect(result.verification.checks[0]).toMatchObject({ id: "criterion-0", status: "pass", everFailed: true });
  expect(result.verification.omittedChecks).toBe(32 - result.verification.checks.length);
  expect(result.driver?.restoration).toBe("failed");
  expect(result.decisionEvidence.status).toBe("not_applicable");
  expect(output).not.toContain("large saved detail");
  expect(input.verification.checks[0].detail).toEqual({ observations: "large saved detail".repeat(1000) });
});

test("large concurrency timelines do not evict actor identities or turn RPC overlap into native execution proof", () => {
  const input = evidence();
  input.runConfig.numberOfPlayer = 2;
  input.concurrencyEvidence = {
    executionMode: "concurrent",
    modelRequestsMaxInFlight: 0,
    inputCallsMaxInFlight: 2,
    physicalRpcOverlapPairs: 100,
    nativeInputOverlapPairs: null,
    nativeExecutionTiming: "not_reported_by_transport",
    inputTimingsDropped: 0,
    inputTimings: Array.from({ length: 200 }, (_, index) => ({
      executionId: index + 1,
      clientId: index % 2 === 0 ? "client-A" : "client-B",
      physical: true,
      callStartedAtMs: Math.floor(index / 2) * 100,
      callEndedAtMs: Math.floor(index / 2) * 100 + 40,
      status: "completed",
      nativeInputStartedAtMs: null,
      nativeInputEndedAtMs: null,
    })),
  };
  input.perActorEvidence = Object.fromEntries(
    ["A", "B"].map((id) => [
      id,
      {
        binding: { actorId: id, userId: `user-${id}`, clientId: `client-${id}`, source: "native_user_id" as const },
        decisionEvidence: input.decisionEvidence,
        coverage: input.coverage,
        observationSource: "main_shared_authoritative_harness_actor_projection" as const,
      },
    ]),
  );
  const result = compactRunEvidence(input);
  expect(result).toMatchObject({
    outputMode: "compact",
    concurrencyEvidence: {
      physicalRpcOverlapPairs: 100,
      nativeInputOverlapPairs: null,
      nativeExecutionTiming: "not_reported_by_transport",
      inputTimingsRecorded: 200,
    },
    perActorEvidence: {
      A: { binding: { actorId: "A", clientId: "client-A" } },
      B: { binding: { actorId: "B", clientId: "client-B" } },
    },
  });
  expect(Buffer.byteLength(JSON.stringify(result, null, 2))).toBeLessThanOrEqual(32_000);
});
