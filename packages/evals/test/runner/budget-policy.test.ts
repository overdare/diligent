// @summary Tests that task budgets stay efficiency targets while hard limits only stop runaway executions

import { describe, expect, test } from "bun:test";
import {
  createBudgetGraceDiagnostics,
  EVAL_RUNAWAY_POLICY,
  resolveEvalHardLimits,
} from "../../src/runner/budget-policy";

describe("eval budget policy", () => {
  test("hard limits scale with the target so a moderately longer path is never terminated", () => {
    const targets = { maxTurns: 20, maxToolCalls: 30 };
    const hard = resolveEvalHardLimits(targets);
    expect(hard.maxTurns).toBe(targets.maxTurns * EVAL_RUNAWAY_POLICY.multiplier);
    expect(hard.maxToolCalls).toBe(targets.maxToolCalls * EVAL_RUNAWAY_POLICY.multiplier);
  });

  test("small targets keep a minimum headroom before termination", () => {
    const hard = resolveEvalHardLimits({ maxTurns: 1, maxToolCalls: 0 });
    expect(hard.maxTurns).toBe(1 + EVAL_RUNAWAY_POLICY.minHeadroom.turns);
    expect(hard.maxToolCalls).toBe(EVAL_RUNAWAY_POLICY.minHeadroom.toolCalls);
  });

  test("reports target overruns as non-gating efficiency diagnostics", () => {
    expect(
      createBudgetGraceDiagnostics({ maxTurns: 5, maxToolCalls: 4 }, { turns: 6, toolCalls: 5 }).map(
        (diagnostic) => diagnostic.code,
      ),
    ).toEqual(["budget_grace.turns", "budget_grace.tool_calls"]);
    expect(createBudgetGraceDiagnostics({ maxTurns: 5, maxToolCalls: 4 }, { turns: 5, toolCalls: 4 })).toEqual([]);
  });
});
