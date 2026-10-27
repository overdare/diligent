// @summary Goal prompt rendering: escaped objectives, budget and run-limit lines, edits, and compaction
import { expect, test } from "bun:test";
import type { ThreadGoal } from "@diligent/protocol";
import {
  GOAL_COMPACTION_PREFIX,
  renderBudgetLimitPrompt,
  renderContinuationPrompt,
  renderUserTurnNote,
} from "../../src/goals/prompts";

const goal: ThreadGoal = {
  id: "goal-1",
  threadId: "thread-1",
  revision: 1,
  objective: "Ship <b>auth</b> & docs",
  status: "active",
  turnsUsed: 3,
  tokensUsed: 12_345,
  cacheReadTokens: 0,
  activeTimeMs: 252_000,
  accountingScope: "reported_agent_tokens",
  createdAt: 1,
  updatedAt: 2,
};
const options = { runsSinceStart: 2, objectiveEdited: false };

test("objectives are escaped user data inside objective tags", () => {
  for (const prompt of [
    renderContinuationPrompt(goal, options),
    renderBudgetLimitPrompt(goal),
    renderUserTurnNote(goal),
  ]) {
    expect(prompt).toContain("<objective>\nShip &lt;b&gt;auth&lt;/b&gt; &amp; docs\n</objective>");
    expect(prompt).not.toContain("<b>");
  }
});

test("unlimited goals report no budget, unbounded tokens, and no run limit", () => {
  const prompt = renderContinuationPrompt(goal, options);
  expect(prompt).toContain("- Goal run: 3 (no run limit)");
  expect(prompt).toContain("- Consecutive goal runs since the goal was last started, edited, or resumed: 2");
  expect(prompt).toContain("- Active time: 4m 12s");
  expect(prompt).toContain("- Tokens used: 12,345");
  expect(prompt).toContain("- Token budget: none");
  expect(prompt).toContain("- Tokens remaining: unbounded");
});

test("limits render remaining tokens, the run limit, and the final-run note", () => {
  const limited = { ...goal, tokenBudget: 20_000, maxTurns: 5 };
  const prompt = renderContinuationPrompt(limited, options);
  expect(prompt).toContain("- Goal run: 3 of 5\n");
  expect(prompt).toContain("- Token budget: 20,000");
  expect(prompt).toContain("- Tokens remaining: 7,655");
  expect(renderContinuationPrompt({ ...limited, turnsUsed: 5 }, options)).toContain(
    "- Goal run: 5 of 5 (final run under the run limit)",
  );
  expect(renderBudgetLimitPrompt(limited)).toContain("- Token budget: 20,000");
});

test("edited objectives and compaction add their notes only when requested", () => {
  const plain = renderContinuationPrompt(goal, options);
  expect(plain).not.toContain("The user edited this objective");
  expect(plain.startsWith("Continue working toward the active thread goal.")).toBe(true);
  expect(renderContinuationPrompt(goal, { ...options, objectiveEdited: true })).toContain(
    "The user edited this objective since the previous goal run.",
  );
  expect(renderContinuationPrompt(goal, { ...options, compacted: true })).toStartWith(
    `${GOAL_COMPACTION_PREFIX}\n\nContinue working`,
  );
});

test("the wrap-up prompt forbids tools and completion", () => {
  const prompt = renderBudgetLimitPrompt(goal);
  expect(prompt).toContain("Write your final reply for the user now, without tool calls");
  expect(prompt).toContain("Do not call update_goal.");
  expect(prompt).toContain("- Token budget: none");
});
