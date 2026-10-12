// @summary Tests the shared client-side /goal grammar and monotonic snapshot selection

import { describe, expect, test } from "bun:test";
import type { ThreadGoal } from "@diligent/protocol";
import { applyGoalSnapshot, parseGoalCommand } from "../../src/client/goal-command";

const goal: ThreadGoal = {
  id: "goal-1",
  threadId: "thread-1",
  revision: 3,
  objective: "Ship goal mode",
  status: "active",
  maxTurns: 20,
  turnsUsed: 4,
  tokensUsed: 500,
  cacheReadTokens: 100,
  activeTimeMs: 1_000,
  accountingScope: "reported_agent_tokens",
  createdAt: 1,
  updatedAt: 2,
};

describe("parseGoalCommand", () => {
  test("uses a bare command for status", () => {
    expect(parseGoalCommand(undefined, goal)).toBeNull();
    expect(parseGoalCommand("status", goal)).toBeNull();
  });

  test("sets a goal from an objective with token and turn limits", () => {
    expect(parseGoalCommand("Ship the release --tokens 12000 --turns 8", goal)).toEqual({
      action: "set",
      objective: "Ship the release",
      tokenBudget: 12_000,
      maxTurns: 8,
      expectedRevision: 3,
    });
  });

  test("explicit set permits an objective beginning with a reserved action", () => {
    expect(parseGoalCommand("set pause until checks are green", null)).toEqual({
      action: "set",
      objective: "pause until checks are green",
    });
  });

  test("adds current identity to pause, resume, and clear", () => {
    expect(parseGoalCommand("pause", goal)).toEqual({
      action: "pause",
      expectedGoalId: "goal-1",
      expectedRevision: 3,
    });
    expect(parseGoalCommand("resume", goal)).toEqual({
      action: "resume",
      expectedGoalId: "goal-1",
      expectedRevision: 3,
    });
    expect(parseGoalCommand("clear", goal)).toEqual({
      action: "clear",
      expectedGoalId: "goal-1",
      expectedRevision: 3,
    });
  });

  test("edits objective and only the supplied limits", () => {
    expect(parseGoalCommand("edit Ship safely --turns 12", goal)).toEqual({
      action: "edit",
      objective: "Ship safely",
      maxTurns: 12,
      expectedGoalId: "goal-1",
      expectedRevision: 3,
    });
  });

  test("rejects malformed limits and unexpected action arguments", () => {
    expect(() => parseGoalCommand("Ship it --tokens nope", goal)).toThrow("--tokens");
    expect(() => parseGoalCommand("Ship it --turns 0", goal)).toThrow("--turns");
    expect(() => parseGoalCommand("pause later", goal)).toThrow("Usage");
    expect(() => parseGoalCommand("status later", goal)).toThrow("Usage");
    expect(() => parseGoalCommand("set --tokens 10", goal)).toThrow("objective");
  });

  test("requires an existing goal for non-set mutations", () => {
    expect(() => parseGoalCommand("pause", null)).toThrow("No goal exists");
    expect(() => parseGoalCommand("edit Try again", null)).toThrow("No goal exists");
  });
});

describe("applyGoalSnapshot", () => {
  test("does not let an older notification restore a cleared or replaced goal", () => {
    const cleared = { goal: null, sequence: 8 };
    expect(applyGoalSnapshot(cleared, { goal, sequence: 7 })).toEqual(cleared);

    const replacement = { goal: { ...goal, id: "goal-2", revision: 0 }, sequence: 10 };
    expect(applyGoalSnapshot(replacement, { goal, sequence: 9 })).toEqual(replacement);
  });

  test("accepts the newest snapshot", () => {
    const current = { goal, sequence: 4 };
    const incoming = { goal: null, sequence: 5 };
    expect(applyGoalSnapshot(current, incoming)).toEqual(incoming);
  });
});
