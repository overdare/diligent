// @summary Counts model-choice participation separately from confirmed action effects.
import type { PlaytestEvent, PlaytestMode } from "./runtime-types";

export type DecisionEvidenceStatus =
  | "not_applicable"
  | "not_exercised"
  | "selected_not_dispatched"
  | "dispatched_unverified"
  | "effects_observed";

export interface DecisionEvidenceSummary {
  /** not_applicable: verification mode never consults a decision provider. */
  status: DecisionEvidenceStatus;
  modelRequests: number;
  modelChoices: number;
  modelDispatches: number;
  modelEffectsConfirmed: number;
  automaticDispatches: number;
  scenarioDispatches: number;
}

export interface DecisionEvidenceTracker {
  event(event: PlaytestEvent): void;
  summary(): DecisionEvidenceSummary;
}

type DecisionSource = "model" | "automatic" | "scenario";

const CHOICE_SOURCE_BY_EVENT: Record<string, DecisionSource> = {
  model_choice: "model",
  singleton_choice: "automatic",
  scenario_choice: "scenario",
};

interface DecisionRecord {
  modelRequestSeen?: true;
  choiceSeen?: true;
  choiceSource?: DecisionSource;
  choiceActionId?: string;
  modelDispatchSeen?: true;
  modelEffectSeen?: true;
  dispatchStages: Set<string>;
  executions: Map<string, PhysicalExecution>;
}

interface PhysicalExecution {
  dispatchSeen: true;
  dispatchSource?: DecisionSource;
  actionId?: string;
  intentId?: string;
  dispatchMatchesChoice: boolean;
  resultSeen?: true;
}

function isDecisionSource(value: unknown): value is DecisionSource {
  return value === "model" || value === "automatic" || value === "scenario";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decisionIdOf(event: PlaytestEvent): number | undefined {
  const decisionId = event.decisionId;
  return typeof decisionId === "number" && Number.isSafeInteger(decisionId) && decisionId > 0 ? decisionId : undefined;
}

function actionIdOf(event: PlaytestEvent): string | undefined {
  return typeof event.actionId === "string" && event.actionId.length > 0 ? event.actionId : undefined;
}

function intentIdOf(event: PlaytestEvent): { present: boolean; id?: string } | undefined {
  if (!Object.hasOwn(event, "intentId")) return { present: false };
  return typeof event.intentId === "string" && event.intentId.length > 0
    ? { present: true, id: event.intentId }
    : undefined;
}

function executionKeyOf(event: PlaytestEvent): string | undefined {
  if (!Object.hasOwn(event, "executionId")) return "legacy";
  const executionId = event.executionId;
  return typeof executionId === "number" && Number.isSafeInteger(executionId) && executionId > 0
    ? `execution:${executionId}`
    : undefined;
}

function expectationsPassed(event: PlaytestEvent): boolean {
  const expectations = event.expectations;
  return (
    Array.isArray(expectations) &&
    expectations.length > 0 &&
    expectations.every((expectation) => isRecord(expectation) && expectation.passed === true)
  );
}

export function createDecisionEvidenceTracker(options: { mode?: PlaytestMode } = {}): DecisionEvidenceTracker {
  const decisions = new Map<number, DecisionRecord>();
  let modelRequests = 0;
  let modelChoices = 0;
  let modelDispatches = 0;
  let modelEffectsConfirmed = 0;
  let automaticDispatches = 0;
  let scenarioDispatches = 0;

  const decisionStatus = (): DecisionEvidenceStatus => {
    if (options.mode === "verification") return "not_applicable";
    if (modelChoices === 0) return "not_exercised";
    if (modelDispatches === 0) return "selected_not_dispatched";
    if (modelEffectsConfirmed === 0) return "dispatched_unverified";
    return "effects_observed";
  };

  const getDecision = (decisionId: number): DecisionRecord => {
    let decision = decisions.get(decisionId);
    if (!decision) {
      decision = { dispatchStages: new Set(), executions: new Map() };
      decisions.set(decisionId, decision);
    }
    return decision;
  };

  return {
    event(event: PlaytestEvent) {
      const decisionId = decisionIdOf(event);
      if (decisionId === undefined) return;
      const decision = getDecision(decisionId);

      if (event.type === "model_start") {
        if (decision.modelRequestSeen) return;
        decision.modelRequestSeen = true;
        modelRequests += 1;
        return;
      }

      const choiceSource = CHOICE_SOURCE_BY_EVENT[event.type];
      if (choiceSource) {
        if (decision.choiceSeen) return;
        const actionId = actionIdOf(event);
        if (!actionId) return;
        decision.choiceSeen = true;
        decision.choiceSource = choiceSource;
        decision.choiceActionId = actionId;
        if (choiceSource === "model") modelChoices += 1;
        return;
      }

      if (event.type === "action_dispatch") {
        const executionKey = executionKeyOf(event);
        if (!executionKey || decision.dispatchStages.has(executionKey)) return;
        decision.dispatchStages.add(executionKey);
        const actionId = actionIdOf(event);
        const decisionSource = isDecisionSource(event.decisionSource) ? event.decisionSource : undefined;
        const intent = intentIdOf(event);
        const validCorrelation =
          actionId !== undefined &&
          intent !== undefined &&
          decisionSource !== undefined &&
          !(intent.present && executionKey === "legacy");
        const dispatchMatchesChoice =
          validCorrelation &&
          decision.choiceSeen === true &&
          decision.choiceSource === decisionSource &&
          decision.choiceActionId === (intent.present ? intent.id : actionId);
        decision.executions.set(executionKey, {
          dispatchSeen: true,
          ...(decisionSource ? { dispatchSource: decisionSource } : {}),
          ...(actionId ? { actionId } : {}),
          ...(intent?.present && intent.id ? { intentId: intent.id } : {}),
          dispatchMatchesChoice,
        });
        if (!dispatchMatchesChoice) return;
        if (decisionSource === "model") {
          if (!decision.modelDispatchSeen) {
            decision.modelDispatchSeen = true;
            modelDispatches += 1;
          }
        } else if (decisionSource === "scenario") {
          scenarioDispatches += 1;
        } else {
          automaticDispatches += 1;
        }
        return;
      }

      if (event.type !== "action_result") return;
      const executionKey = executionKeyOf(event);
      if (!executionKey) return;
      const execution = decision.executions.get(executionKey);
      if (!execution || execution.resultSeen) return;
      execution.resultSeen = true;
      const actionId = actionIdOf(event);
      const decisionSource = event.decisionSource;
      const intent = intentIdOf(event);
      if (!actionId || !intent || (intent.present && executionKey === "legacy")) return;
      if (
        !execution.dispatchMatchesChoice ||
        execution.dispatchSource !== decisionSource ||
        execution.actionId !== actionId ||
        execution.intentId !== intent.id
      ) {
        return;
      }
      if (
        execution.dispatchSource === "model" &&
        !decision.modelEffectSeen &&
        event.inputStatus === "completed" &&
        event.observed === true &&
        expectationsPassed(event)
      ) {
        decision.modelEffectSeen = true;
        modelEffectsConfirmed += 1;
      }
    },

    summary() {
      return {
        status: decisionStatus(),
        modelRequests,
        modelChoices,
        modelDispatches,
        modelEffectsConfirmed,
        automaticDispatches,
        scenarioDispatches,
      };
    },
  };
}
