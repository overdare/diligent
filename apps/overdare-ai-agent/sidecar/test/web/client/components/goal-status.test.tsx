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

test("renders a collapsed summary with objective, lifecycle state, budget progress, and controls", () => {
  const html = renderToStaticMarkup(
    <GoalStatus goal={goal} onPause={() => {}} onResume={() => {}} onClear={() => {}} />,
  );

  expect(html).toContain("Ship goal mode");
  expect(html).toContain("In progress");
  expect(html).toContain("4.5K / 20K tokens");
  expect(html).toContain("run 6 of 15");
  expect(html).toContain("1s");
  expect(html).toContain('aria-expanded="false"');
  expect(html).not.toContain("Working through the checklist");
  expect(html).not.toContain("Focused tests passed");
  expect(html).toContain("Pause");
  expect(html).toContain("Clear");
  expect(html).not.toContain("Resume");
});

test("renders reason, retained evidence, and cache usage when expanded", () => {
  const html = renderToStaticMarkup(
    <GoalStatus goal={goal} onPause={() => {}} onResume={() => {}} onClear={() => {}} defaultExpanded />,
  );

  expect(html).toContain('aria-expanded="true"');
  expect(html).toContain("Working through the checklist");
  expect(html).toContain("Focused tests passed");
  expect(html).toContain("Active 1s across 6 runs (limit 15)");
  expect(html).toContain("4,500 / 20,000 tokens");
  expect(html).toContain("2,000 cached read tokens");
});

test("describes runtime reason codes and shows model-written reasons verbatim", () => {
  const render = (reason: string) =>
    renderToStaticMarkup(
      <GoalStatus
        goal={{ ...goal, status: "paused", reason }}
        onPause={() => {}}
        onResume={() => {}}
        onClear={() => {}}
        defaultExpanded
      />,
    );
  expect(render("user_turn")).toContain("Paused for your message");
  expect(render("user_turn")).toContain("resumes automatically when the reply finishes");
  expect(render("Need the staging API key")).toContain("Need the staging API key");
});

test("an unlimited goal shows no run limit and no progress bar", () => {
  const unlimited = { ...goal, tokenBudget: undefined, maxTurns: undefined, turnsUsed: 1 };
  const html = renderToStaticMarkup(
    <GoalStatus goal={unlimited} onPause={() => {}} onResume={() => {}} onClear={() => {}} defaultExpanded />,
  );
  expect(html).toContain("4.5K tokens");
  expect(html).not.toContain(" of ");
  expect(html).not.toContain("width:");
  expect(html).toContain("Active 1s across 1 run ·");
  expect(html).toContain("4,500 / no budget tokens");
});

test("elapsed time includes the in-flight run", () => {
  const html = renderToStaticMarkup(
    <GoalStatus
      goal={{ ...goal, activeTimeMs: 60_000, runStartedAt: Date.now() - 12_000 }}
      onPause={() => {}}
      onResume={() => {}}
      onClear={() => {}}
    />,
  );
  expect(html).toMatch(/1m 1[2-9]s/);
});

test("labels limited statuses and summarizes long active time", () => {
  const render = (patch: Partial<ThreadGoal>) =>
    renderToStaticMarkup(
      <GoalStatus goal={{ ...goal, ...patch }} onPause={() => {}} onResume={() => {}} onClear={() => {}} />,
    );
  const html = render({ status: "budget_limited", reason: "token_budget", activeTimeMs: 3_749_000 });

  expect(html).toContain("Token budget reached");
  expect(html).toContain("1h 2m");
  expect(render({ status: "budget_limited", reason: "turn_limit" })).toContain("Run limit reached");
  expect(render({ activeTimeMs: 2 * 86_400_000 + 3 * 3_600_000 })).toContain("2d 3h");
});

test("offers resume for a non-active goal", () => {
  const html = renderToStaticMarkup(
    <GoalStatus goal={{ ...goal, status: "paused" }} onPause={() => {}} onResume={() => {}} onClear={() => {}} />,
  );

  expect(html).toContain("Resume");
  expect(html).not.toContain(">Pause<");
});

test("hides the usage bar once the goal is complete", () => {
  const active = renderToStaticMarkup(
    <GoalStatus goal={goal} onPause={() => {}} onResume={() => {}} onClear={() => {}} />,
  );
  const complete = renderToStaticMarkup(
    <GoalStatus goal={{ ...goal, status: "complete" }} onPause={() => {}} onResume={() => {}} onClear={() => {}} />,
  );

  expect(active).toContain("width:40%");
  expect(complete).not.toContain("width:");
  expect(complete).toContain("Complete");
});
