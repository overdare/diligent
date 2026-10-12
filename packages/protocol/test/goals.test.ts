// @summary Goal RPC schema boundaries and backwards-compatible event validation
import { expect, test } from "bun:test";
import { AgentEventSchema, DiligentClientRequestSchema, DiligentServerNotificationSchema } from "../src";
import { GoalChangeSchema, GoalObjectiveSchema } from "../src/goals";

test("goal objectives count Unicode code points and reject blank or oversized input", () => {
  expect(GoalObjectiveSchema.parse("  Fix auth  ")).toBe("Fix auth");
  expect(GoalObjectiveSchema.safeParse("😀".repeat(4000)).success).toBe(true);
  for (const objective of [" ", "", "x".repeat(4001)]) {
    expect(GoalObjectiveSchema.safeParse(objective).success).toBe(false);
  }
});

test("goal mutations validate limits and require identity for existing controls", () => {
  expect(GoalChangeSchema.safeParse({ action: "set", objective: "Fix auth", tokenBudget: -1 }).success).toBe(false);
  expect(GoalChangeSchema.safeParse({ action: "set", objective: "Fix auth", maxTurns: 1.5 }).success).toBe(false);
  expect(GoalChangeSchema.safeParse({ action: "pause" }).success).toBe(false);
  expect(GoalChangeSchema.safeParse({ action: "pause", expectedGoalId: "g", expectedRevision: 1 }).success).toBe(true);
  expect(
    GoalChangeSchema.safeParse({ action: "set", objective: "Fix auth", tokenBudget: Number.MAX_SAFE_INTEGER + 1 })
      .success,
  ).toBe(false);
});

test("goal requests and clear notifications use the shared protocol", () => {
  expect(
    DiligentClientRequestSchema.parse({
      method: "thread/goal/set",
      params: { threadId: "t", action: "set", objective: "Fix auth" },
    }).method,
  ).toBe("thread/goal/set");
  expect(
    DiligentServerNotificationSchema.parse({
      method: "thread/goal/updated",
      params: { threadId: "t", sequence: 4, goal: null },
    }).params,
  ).toEqual({ threadId: "t", sequence: 4, goal: null });
});

test("agent end preserves an optional execution stop reason without breaking old events", () => {
  expect(AgentEventSchema.parse({ type: "agent_end", messages: [], stopReason: "interrupted" })).toHaveProperty(
    "stopReason",
    "interrupted",
  );
  expect(AgentEventSchema.safeParse({ type: "agent_end", messages: [] }).success).toBe(true);
});
