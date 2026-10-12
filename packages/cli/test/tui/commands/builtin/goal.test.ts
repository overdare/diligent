// @summary Tests /goal TUI dispatch, display, and busy-time availability

import { describe, expect, mock, test } from "bun:test";
import type { ThreadGoal, ThreadGoalResponse } from "@diligent/protocol";
import { goalCommand } from "../../../../src/tui/commands/builtin/goal";
import type { CommandContext } from "../../../../src/tui/commands/types";
import type { AppServerRpcClient } from "../../../../src/tui/rpc-client";

const goal: ThreadGoal = {
  id: "goal-1",
  threadId: "thread-1",
  revision: 2,
  objective: "Ship the release",
  status: "active",
  tokenBudget: 10_000,
  maxTurns: 12,
  turnsUsed: 3,
  tokensUsed: 2_500,
  cacheReadTokens: 800,
  activeTimeMs: 1_000,
  accountingScope: "reported_agent_tokens",
  reason: "continuing",
  completionEvidence: "All checks passed",
  createdAt: 1,
  updatedAt: 2,
};

function createContext(responses: ThreadGoalResponse[]) {
  const requests: Array<{ method: string; params: unknown }> = [];
  const lines: string[] = [];
  const errors: string[] = [];
  const runAgent = mock(async () => {});
  let responseIndex = 0;
  const rpc = {
    request: async (method: string, params: unknown) => {
      requests.push({ method, params });
      return responses[Math.min(responseIndex++, responses.length - 1)];
    },
  } as unknown as AppServerRpcClient;
  const ctx = {
    app: {
      confirm: async () => true,
      pick: async () => null,
      prompt: async () => null,
      stop: () => {},
      getRpcClient: () => rpc,
    },
    threadId: "thread-1",
    displayLines: (next: string[]) => lines.push(...next),
    displayError: (message: string) => errors.push(message),
    runAgent,
  } as unknown as CommandContext;
  return { ctx, requests, lines, errors, runAgent };
}

describe("/goal", () => {
  test("shows the current goal without sending an ordinary chat message", async () => {
    const fixture = createContext([{ goal, sequence: 4 }]);

    await goalCommand.handler(undefined, fixture.ctx);

    expect(fixture.requests).toEqual([{ method: "thread/goal/get", params: { threadId: "thread-1" } }]);
    const output = fixture.lines.join("\n");
    expect(output).toContain("Ship the release");
    expect(output).toContain("active");
    expect(output).toContain("2,500 / 10,000 tokens");
    expect(output).toContain("3 / 12 runs");
    expect(output).toContain("All checks passed");
    expect(fixture.runAgent).not.toHaveBeenCalled();
  });

  test("sets a parsed goal through goal RPC", async () => {
    const fixture = createContext([
      { goal: null, sequence: 0 },
      { goal, sequence: 1 },
    ]);

    await goalCommand.handler("Ship the release --tokens 10000 --turns 12", fixture.ctx);

    expect(fixture.requests[1]).toEqual({
      method: "thread/goal/set",
      params: {
        threadId: "thread-1",
        action: "set",
        objective: "Ship the release",
        tokenBudget: 10_000,
        maxTurns: 12,
      },
    });
    expect(fixture.runAgent).not.toHaveBeenCalled();
  });

  test("uses goal identity for pause and remains available during a running task", async () => {
    const fixture = createContext([
      { goal, sequence: 2 },
      { goal: { ...goal, status: "paused", revision: 3 }, sequence: 3 },
    ]);

    await goalCommand.handler("pause", fixture.ctx);

    expect(goalCommand.availableDuringTask).toBe(true);
    expect(fixture.requests[1]).toEqual({
      method: "thread/goal/set",
      params: {
        threadId: "thread-1",
        action: "pause",
        expectedGoalId: "goal-1",
        expectedRevision: 2,
      },
    });
  });

  test("reports a useful error when the thread has no goal to mutate", async () => {
    const fixture = createContext([{ goal: null, sequence: 0 }]);

    await goalCommand.handler("clear", fixture.ctx);

    expect(fixture.errors).toEqual(["No goal exists for this thread. Start one with /goal set <objective>."]);
    expect(fixture.requests).toHaveLength(1);
  });

  for (const [args, expected] of [
    ["resume", { action: "resume", expectedGoalId: "goal-1", expectedRevision: 2 }],
    ["clear", { action: "clear", expectedGoalId: "goal-1", expectedRevision: 2 }],
    [
      "edit Ship safely --tokens 9000 --turns 7",
      {
        action: "edit",
        objective: "Ship safely",
        tokenBudget: 9000,
        maxTurns: 7,
        expectedGoalId: "goal-1",
        expectedRevision: 2,
      },
    ],
    ["set pause after release", { action: "set", objective: "pause after release", expectedRevision: 2 }],
  ] as const) {
    test(`dispatches ${args} without ordinary chat`, async () => {
      const fixture = createContext([
        { goal, sequence: 2 },
        { goal, sequence: 3 },
      ]);

      await goalCommand.handler(args, fixture.ctx);

      expect(fixture.requests[1]).toEqual({
        method: "thread/goal/set",
        params: { threadId: "thread-1", ...expected },
      });
      expect(fixture.runAgent).not.toHaveBeenCalled();
    });
  }
});
