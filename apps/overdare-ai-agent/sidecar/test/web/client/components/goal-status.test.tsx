// @summary Static rendering tests for the persistent web goal status card

import { expect, test } from "bun:test";
import type { ThreadGoal } from "@diligent/protocol";
import { renderToStaticMarkup } from "react-dom/server";
import { GoalStatus } from "../../../../src/web/client/components/GoalStatus";

const goal: ThreadGoal = {
  id: "goal-1",
  threadId: "thread-1",
  revision: 4,
  objective: "Ship goal mode",
  status: "active",
  tokenBudget: 20_000,
  maxTurns: 15,
  turnsUsed: 6,
  tokensUsed: 4_500,
  cacheReadTokens: 2_000,
  activeTimeMs: 1_000,
  accountingScope: "reported_agent_tokens",
  reason: "Working through the checklist",
  completionEvidence: "Focused tests passed",
  createdAt: 1,
  updatedAt: 2,
};

test("renders objective, lifecycle state, budget progress, reason, and retained evidence", () => {
  const html = renderToStaticMarkup(
    <GoalStatus goal={goal} onPause={() => {}} onResume={() => {}} onClear={() => {}} />,
  );

  expect(html).toContain("Ship goal mode");
  expect(html).toContain("active");
  expect(html).toContain("4,500 / 20,000 tokens");
  expect(html).toContain("6 / 15 runs");
  expect(html).toContain("Working through the checklist");
  expect(html).toContain("Focused tests passed");
  expect(html).toContain("Pause");
  expect(html).toContain("Clear");
  expect(html).not.toContain("Resume");
});

test("offers resume for a non-active goal", () => {
  const html = renderToStaticMarkup(
    <GoalStatus goal={{ ...goal, status: "paused" }} onPause={() => {}} onResume={() => {}} onClear={() => {}} />,
  );

  expect(html).toContain("Resume");
  expect(html).not.toContain(">Pause<");
});
