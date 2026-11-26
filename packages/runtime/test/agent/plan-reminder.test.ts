// @summary Runtime plan-reminder parsing, cadence, restore, and injection tests

import { describe, expect, test } from "bun:test";
import type { Message, ToolCallBlock, ToolResultMessage } from "@diligent/core/message-contract";
import {
  createPlanReminder,
  findLatestPlanSteps,
  latestUserGoal,
  parsePlanSteps,
  remainingPlanSteps,
} from "../../src/agent/plan-reminder";
import { createReminderHook } from "../../src/agent/reminder-hook";

const planOutput = (status: "pending" | "in_progress" | "done" | "cancelled" = "pending") =>
  JSON.stringify({ steps: [{ text: "step A", status }] });
const toolCall: ToolCallBlock = { type: "tool_call", id: "tc", name: "plan", input: {} };
const result = (output = planOutput(), isError = false): ToolResultMessage => ({
  role: "tool_result",
  toolCallId: "tc",
  toolName: "plan",
  output,
  isError,
  timestamp: Date.now(),
});

describe("plan reminder helpers", () => {
  test("parses valid steps and rejects malformed output", () => {
    expect(parsePlanSteps(planOutput())).toEqual([{ text: "step A", status: "pending" }]);
    expect(parsePlanSteps("not-json")).toBeUndefined();
    expect(parsePlanSteps(JSON.stringify({ steps: [] }))).toBeUndefined();
  });

  test("finds the latest successful plan and filters resolved steps", () => {
    const messages: Message[] = [result(planOutput("pending")), result("[Aborted by user]", true)];
    expect(findLatestPlanSteps(messages)).toEqual([{ text: "step A", status: "pending" }]);
    expect(
      remainingPlanSteps([
        { text: "A", status: "done" },
        { text: "B", status: "in_progress" },
      ]),
    ).toEqual([{ text: "B", status: "in_progress" }]);
  });

  test("captures the latest user goal", () => {
    expect(
      latestUserGoal([
        { role: "user", content: "earlier", timestamp: Date.now() },
        { role: "user", content: "real goal", timestamp: Date.now() },
      ]),
    ).toBe("real goal");
  });
});

describe("plan reminder", () => {
  test("restores plan state and fires after the configured cadence", () => {
    const hook = createReminderHook({ intervalTurns: 2, policy: createPlanReminder() });
    hook.restore?.({ messages: [result()] });
    hook.onPromptStart?.({ messages: [{ role: "user", content: "ship it", timestamp: Date.now() }] });

    expect(hook.beforeTurn?.({ messages: [], turnId: "t1", compactedThisTurn: false })).toBeUndefined();
    hook.afterTurn?.({ turnId: "t1", message: {} as never, toolResults: [] });
    expect(hook.beforeTurn?.({ messages: [], turnId: "t2", compactedThisTurn: false })).toBeUndefined();
    hook.afterTurn?.({ turnId: "t2", message: {} as never, toolResults: [] });
    const injections = hook.beforeTurn?.({ messages: [], turnId: "t3", compactedThisTurn: false });
    expect(injections?.[0]?.source).toBe("plan-reminder");
    expect(injections?.[0]?.content).toContain("Goal: ship it");
    expect(injections?.[0]?.content).toContain("- (pending) step A");
  });

  test("fires immediately after compaction and resets cadence on plan updates", () => {
    const hook = createReminderHook({ intervalTurns: 2, policy: createPlanReminder() });
    hook.restore?.({ messages: [result()] });
    expect(hook.beforeTurn?.({ messages: [], turnId: "t1", compactedThisTurn: true })).toHaveLength(1);
    hook.onToolResult?.({ turnId: "t1", toolCall, result: result(planOutput("in_progress")) });
    hook.afterTurn?.({ turnId: "t1", message: {} as never, toolResults: [] });
    expect(hook.beforeTurn?.({ messages: [], turnId: "t2", compactedThisTurn: false })).toBeUndefined();
    hook.afterTurn?.({ turnId: "t2", message: {} as never, toolResults: [] });
    expect(hook.beforeTurn?.({ messages: [], turnId: "t3", compactedThisTurn: false })).toBeUndefined();
    hook.afterTurn?.({ turnId: "t3", message: {} as never, toolResults: [] });
    const injections = hook.beforeTurn?.({ messages: [], turnId: "t4", compactedThisTurn: false });
    expect(injections?.[0]?.content).toContain("- (in_progress) step A");
  });

  test("does not inject when disabled, absent, or resolved", () => {
    const disabled = createReminderHook({ intervalTurns: 0, policy: createPlanReminder() });
    disabled.restore?.({ messages: [result()] });
    expect(disabled.beforeTurn?.({ messages: [], turnId: "t", compactedThisTurn: true })).toBeUndefined();

    const resolved = createReminderHook({ intervalTurns: 1, policy: createPlanReminder() });
    resolved.restore?.({ messages: [result(planOutput("done"))] });
    expect(resolved.beforeTurn?.({ messages: [], turnId: "t", compactedThisTurn: true })).toBeUndefined();
  });
});
