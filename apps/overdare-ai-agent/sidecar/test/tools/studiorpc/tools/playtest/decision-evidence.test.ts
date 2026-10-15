import { describe, expect, test } from "bun:test";
import { createDecisionEvidenceTracker } from "../../../../../src/tools/studiorpc/tools/playtest/decision-evidence";
import type { PlaytestEvent } from "../../../../../src/tools/studiorpc/tools/playtest/runtime";

function event(type: string, decisionId: number, fields: Record<string, unknown> = {}): PlaytestEvent {
  return { type, atMs: decisionId, decisionId, ...fields };
}

function successfulResult(decisionId: number, actionId: string, decisionSource: "model" | "automatic" = "model") {
  return event("action_result", decisionId, {
    actionId,
    decisionSource,
    inputStatus: "completed",
    observed: true,
    expectations: [{ passed: true, before: 1, after: 2 }],
  });
}

describe("playtest decision evidence", () => {
  test("counts a model request that fails before returning a choice", () => {
    const tracker = createDecisionEvidenceTracker();
    tracker.event(event("model_start", 1));

    expect(tracker.summary()).toEqual({
      status: "not_exercised",
      modelRequests: 1,
      modelChoices: 0,
      modelDispatches: 0,
      modelEffectsConfirmed: 0,
      automaticDispatches: 0,
    });
  });

  test("records a stale model choice without treating it as dispatched evidence", () => {
    const tracker = createDecisionEvidenceTracker();
    tracker.event(event("model_start", 7));
    tracker.event(event("model_choice", 7, { actionId: "go-to-door" }));

    expect(tracker.summary()).toEqual({
      status: "selected_not_dispatched",
      modelRequests: 1,
      modelChoices: 1,
      modelDispatches: 0,
      modelEffectsConfirmed: 0,
      automaticDispatches: 0,
    });
  });

  test("keeps automatic-only dispatches separate from model participation", () => {
    const tracker = createDecisionEvidenceTracker();
    tracker.event(event("singleton_choice", 2, { actionId: "wait", decisionSource: "automatic" }));
    tracker.event(event("action_dispatch", 2, { actionId: "wait", decisionSource: "automatic" }));
    tracker.event(successfulResult(2, "wait", "automatic"));

    expect(tracker.summary()).toEqual({
      status: "not_exercised",
      modelRequests: 0,
      modelChoices: 0,
      modelDispatches: 0,
      modelEffectsConfirmed: 0,
      automaticDispatches: 1,
    });
  });

  test("requires the dispatched action to match the prior model choice", () => {
    const tracker = createDecisionEvidenceTracker();
    tracker.event(event("model_choice", 3, { actionId: "collect-battery" }));
    tracker.event(event("action_dispatch", 3, { actionId: "open-door", decisionSource: "model" }));
    tracker.event(successfulResult(3, "open-door"));

    expect(tracker.summary()).toEqual({
      status: "selected_not_dispatched",
      modelRequests: 0,
      modelChoices: 1,
      modelDispatches: 0,
      modelEffectsConfirmed: 0,
      automaticDispatches: 0,
    });
  });

  test("preserves legacy action-ID correlation when intent and execution IDs are absent", () => {
    const tracker = createDecisionEvidenceTracker();
    tracker.event(event("model_start", 12));
    tracker.event(event("model_choice", 12, { actionId: "deposit" }));
    tracker.event(event("action_dispatch", 12, { actionId: "deposit", decisionSource: "model" }));
    tracker.event(successfulResult(12, "deposit"));

    expect(tracker.summary()).toEqual({
      status: "effects_observed",
      modelRequests: 1,
      modelChoices: 1,
      modelDispatches: 1,
      modelEffectsConfirmed: 1,
      automaticDispatches: 0,
    });
  });

  test("links changing physical step IDs to the retained policy intent", () => {
    const tracker = createDecisionEvidenceTracker();
    tracker.event(event("model_choice", 30, { actionId: "deliver-load" }));
    tracker.event(
      event("action_dispatch", 30, {
        actionId: "walk-west-step-1",
        intentId: "deliver-load",
        executionId: 101,
        decisionSource: "model",
      }),
    );
    tracker.event(
      event("action_result", 30, {
        actionId: "walk-west-step-1",
        intentId: "deliver-load",
        executionId: 101,
        decisionSource: "model",
        inputStatus: "completed",
        observed: true,
        expectations: [{ passed: true, before: 7, after: 5 }],
      }),
    );
    tracker.event(
      event("action_dispatch", 30, {
        actionId: "walk-west-step-2",
        intentId: "deliver-load",
        executionId: 102,
        decisionSource: "model",
      }),
    );
    tracker.event(
      event("action_result", 30, {
        actionId: "walk-west-step-2",
        intentId: "deliver-load",
        executionId: 102,
        decisionSource: "model",
        inputStatus: "completed",
        observed: true,
        expectations: [{ passed: true, before: 5, after: 3 }],
      }),
    );

    expect(tracker.summary()).toEqual({
      status: "effects_observed",
      modelRequests: 0,
      modelChoices: 1,
      modelDispatches: 1,
      modelEffectsConfirmed: 1,
      automaticDispatches: 0,
    });
  });

  test("allows a later physical step to confirm an intent after an earlier step fails", () => {
    const tracker = createDecisionEvidenceTracker();
    tracker.event(event("model_choice", 31, { actionId: "deliver-load" }));
    tracker.event(
      event("action_dispatch", 31, {
        actionId: "walk-west",
        intentId: "deliver-load",
        executionId: 201,
        decisionSource: "model",
      }),
    );
    tracker.event(
      event("action_result", 31, {
        actionId: "walk-west",
        intentId: "deliver-load",
        executionId: 201,
        decisionSource: "model",
        inputStatus: "completed",
        observed: true,
        expectations: [{ passed: false, before: 7, after: 7 }],
      }),
    );
    tracker.event(
      event("action_dispatch", 31, {
        actionId: "deposit-E-hold",
        intentId: "deliver-load",
        executionId: 202,
        decisionSource: "model",
      }),
    );
    tracker.event(
      event("action_result", 31, {
        actionId: "deposit-E-hold",
        intentId: "deliver-load",
        executionId: 202,
        decisionSource: "model",
        inputStatus: "completed",
        observed: true,
        expectations: [{ passed: true, before: 2, after: 0 }],
      }),
    );

    expect(tracker.summary()).toMatchObject({
      modelChoices: 1,
      modelDispatches: 1,
      modelEffectsConfirmed: 1,
      status: "effects_observed",
    });
  });

  test("deduplicates physical executions by execution ID while allowing later IDs", () => {
    const tracker = createDecisionEvidenceTracker();
    tracker.event(event("singleton_choice", 32, { actionId: "route-intent" }));
    const firstDispatch = event("action_dispatch", 32, {
      actionId: "step-1",
      intentId: "route-intent",
      executionId: 301,
      decisionSource: "automatic",
    });
    tracker.event(firstDispatch);
    tracker.event({ ...firstDispatch, atMs: firstDispatch.atMs + 1 });
    const firstResult = event("action_result", 32, {
      actionId: "step-1",
      intentId: "route-intent",
      executionId: 301,
      decisionSource: "automatic",
      inputStatus: "completed",
      observed: true,
      expectations: [{ passed: true }],
    });
    tracker.event(firstResult);
    tracker.event({ ...firstResult, atMs: firstResult.atMs + 1 });
    tracker.event(
      event("action_dispatch", 32, {
        actionId: "step-2",
        intentId: "route-intent",
        executionId: 302,
        decisionSource: "automatic",
      }),
    );

    expect(tracker.summary()).toEqual({
      status: "not_exercised",
      modelRequests: 0,
      modelChoices: 0,
      modelDispatches: 0,
      modelEffectsConfirmed: 0,
      automaticDispatches: 2,
    });
  });

  test("does not credit a physical step attached to a different parent intent", () => {
    const tracker = createDecisionEvidenceTracker();
    tracker.event(event("model_choice", 33, { actionId: "deliver-load" }));
    tracker.event(
      event("action_dispatch", 33, {
        actionId: "open-room-door",
        intentId: "explore-room-b",
        executionId: 401,
        decisionSource: "model",
      }),
    );
    tracker.event(
      event("action_dispatch", 33, {
        actionId: "walk-to-delivery",
        intentId: "deliver-load",
        executionId: 401,
        decisionSource: "model",
      }),
    );
    tracker.event(
      event("action_result", 33, {
        actionId: "open-room-door",
        intentId: "explore-room-b",
        executionId: 401,
        decisionSource: "model",
        inputStatus: "completed",
        observed: true,
        expectations: [{ passed: true }],
      }),
    );

    expect(tracker.summary()).toEqual({
      status: "selected_not_dispatched",
      modelRequests: 0,
      modelChoices: 1,
      modelDispatches: 0,
      modelEffectsConfirmed: 0,
      automaticDispatches: 0,
    });
  });

  test("invalid execution IDs or decision sources cannot earn dispatch or effect credit", () => {
    const tracker = createDecisionEvidenceTracker();
    tracker.event(event("model_choice", 34, { actionId: "deliver-load" }));
    tracker.event(
      event("action_dispatch", 34, {
        actionId: "step-invalid-source",
        intentId: "deliver-load",
        executionId: 501,
        decisionSource: "unknown",
      }),
    );
    tracker.event(
      event("action_result", 34, {
        actionId: "step-invalid-source",
        intentId: "deliver-load",
        executionId: 501,
        decisionSource: "unknown",
        inputStatus: "completed",
        observed: true,
        expectations: [{ passed: true }],
      }),
    );
    tracker.event(
      event("action_dispatch", 34, {
        actionId: "step-invalid-execution",
        intentId: "deliver-load",
        executionId: 0,
        decisionSource: "model",
      }),
    );
    tracker.event(
      event("action_result", 34, {
        actionId: "step-invalid-execution",
        intentId: "deliver-load",
        executionId: 0,
        decisionSource: "model",
        inputStatus: "completed",
        observed: true,
        expectations: [{ passed: true }],
      }),
    );

    expect(tracker.summary()).toEqual({
      status: "selected_not_dispatched",
      modelRequests: 0,
      modelChoices: 1,
      modelDispatches: 0,
      modelEffectsConfirmed: 0,
      automaticDispatches: 0,
    });
  });

  test("counts repeated action IDs as separate evidence when decision IDs differ", () => {
    const tracker = createDecisionEvidenceTracker();
    for (const decisionId of [21, 22]) {
      tracker.event(event("model_start", decisionId));
      tracker.event(event("model_choice", decisionId, { actionId: "collect" }));
      tracker.event(event("action_dispatch", decisionId, { actionId: "collect", decisionSource: "model" }));
      tracker.event(successfulResult(decisionId, "collect"));
    }

    expect(tracker.summary()).toEqual({
      status: "effects_observed",
      modelRequests: 2,
      modelChoices: 2,
      modelDispatches: 2,
      modelEffectsConfirmed: 2,
      automaticDispatches: 0,
    });
  });

  test("deduplicates repeated events by decision ID and stage", () => {
    const tracker = createDecisionEvidenceTracker();
    const stages = [
      event("model_start", 9),
      event("model_choice", 9, { actionId: "walk" }),
      event("action_dispatch", 9, { actionId: "walk", decisionSource: "model" }),
      successfulResult(9, "walk"),
    ];
    for (const stage of stages) {
      tracker.event(stage);
      tracker.event({ ...stage, atMs: stage.atMs + 100 });
    }

    expect(tracker.summary()).toEqual({
      status: "effects_observed",
      modelRequests: 1,
      modelChoices: 1,
      modelDispatches: 1,
      modelEffectsConfirmed: 1,
      automaticDispatches: 0,
    });
  });

  test("does not confirm failed, empty, unobserved, or incomplete input effects", () => {
    const tracker = createDecisionEvidenceTracker();
    const results = [
      { inputStatus: "completed", observed: true, expectations: [{ passed: false }] },
      { inputStatus: "completed", observed: true, expectations: [] },
      { inputStatus: "cancelled", observed: true, expectations: [{ passed: true }] },
      { inputStatus: "completed", observed: false, expectations: [{ passed: true }] },
    ];
    results.forEach((result, index) => {
      const decisionId = index + 1;
      const actionId = `action-${index}`;
      tracker.event(event("model_choice", decisionId, { actionId }));
      tracker.event(event("action_dispatch", decisionId, { actionId, decisionSource: "model" }));
      tracker.event(event("action_result", decisionId, { actionId, decisionSource: "model", ...result }));
    });

    expect(tracker.summary()).toEqual({
      status: "dispatched_unverified",
      modelRequests: 0,
      modelChoices: 4,
      modelDispatches: 4,
      modelEffectsConfirmed: 0,
      automaticDispatches: 0,
    });
  });

  test("ignores missing and invalid decision IDs", () => {
    const tracker = createDecisionEvidenceTracker();
    tracker.event({ type: "model_start", atMs: 0 });
    tracker.event(event("model_start", 0));
    tracker.event(event("model_start", 1.5));
    tracker.event(event("model_start", Number.MAX_SAFE_INTEGER + 1));

    expect(tracker.summary()).toEqual({
      status: "not_exercised",
      modelRequests: 0,
      modelChoices: 0,
      modelDispatches: 0,
      modelEffectsConfirmed: 0,
      automaticDispatches: 0,
    });
  });
});
