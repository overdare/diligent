// @summary Separates task efficiency targets from the runaway hard limits that terminate an eval execution

import type { EvalDiagnostic, EvalLimits } from "../task";

/**
 * Task budgets are efficiency targets: exceeding one is a non-gating diagnostic. The hard limit exists only to stop a
 * runaway execution, so it leaves generous headroom above the target instead of judging quality.
 */
export const EVAL_RUNAWAY_POLICY = {
  multiplier: 2,
  minHeadroom: { turns: 4, toolCalls: 4 },
} as const;

export type EvalBudgetKind = "turns" | "toolCalls";

export function resolveEvalHardLimits(
  targets: Pick<EvalLimits, "maxTurns" | "maxToolCalls">,
): Pick<EvalLimits, "maxTurns" | "maxToolCalls"> {
  return {
    maxTurns: runawayLimit(targets.maxTurns, EVAL_RUNAWAY_POLICY.minHeadroom.turns),
    maxToolCalls: runawayLimit(targets.maxToolCalls, EVAL_RUNAWAY_POLICY.minHeadroom.toolCalls),
  };
}

export function describeHardLimitExceeded(kind: EvalBudgetKind, hardLimit: number, target: number): string {
  const subject = kind === "turns" ? "Provider-turn count" : "Tool-call count";
  return `${subject} exceeded runaway limit ${hardLimit} (target ${target}).`;
}

export function createBudgetGraceDiagnostics(
  targets: Pick<EvalLimits, "maxTurns" | "maxToolCalls">,
  actual: { turns: number; toolCalls: number },
): EvalDiagnostic[] {
  const diagnostics: EvalDiagnostic[] = [];
  if (actual.turns > targets.maxTurns) {
    diagnostics.push({
      dimension: "efficiency",
      code: "budget_grace.turns",
      message: `Used ${actual.turns} provider turns against target ${targets.maxTurns}.`,
    });
  }
  if (actual.toolCalls > targets.maxToolCalls) {
    diagnostics.push({
      dimension: "efficiency",
      code: "budget_grace.tool_calls",
      message: `Used ${actual.toolCalls} tool calls against target ${targets.maxToolCalls}.`,
    });
  }
  return diagnostics;
}

function runawayLimit(target: number, minHeadroom: number): number {
  return Math.max(target * EVAL_RUNAWAY_POLICY.multiplier, target + minHeadroom);
}
