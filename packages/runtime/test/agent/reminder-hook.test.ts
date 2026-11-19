// @summary Reminder lifecycle behavior with an independent policy

import { expect, test } from "bun:test";
import type { AssistantMessage } from "@diligent/core/message-contract";
import { createReminderHook } from "../../src/agent/reminder-hook";

test("a due reminder that is not applicable can fire on the next turn", () => {
  const hook = createReminderHook({
    intervalTurns: 2,
    policy: {
      id: "review-reminder",
      buildReminder: ({ messages }) => (messages.at(-1)?.role === "user" ? ["Review the changes."] : undefined),
    },
  });
  const message: AssistantMessage = {
    role: "assistant",
    content: [{ type: "text", text: "Working." }],
    model: "test-model",
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    stopReason: "end_turn",
    timestamp: 0,
  };
  const beforeTurn = (turnId: string, ready = false) =>
    hook.beforeTurn?.({
      turnId,
      messages: ready ? [{ role: "user", content: "Ready for review", timestamp: 0 }] : [message],
      compactedThisTurn: false,
    });
  const afterTurn = (turnId: string) => hook.afterTurn?.({ turnId, message, toolResults: [] });

  expect(beforeTurn("1", true)).toBeUndefined();
  afterTurn("1");
  expect(beforeTurn("2", true)).toBeUndefined();
  afterTurn("2");
  expect(beforeTurn("3")).toBeUndefined();
  afterTurn("3");

  expect(beforeTurn("4", true)).toEqual([
    { source: "review-reminder", content: "<system-reminder>\nReview the changes.\n</system-reminder>" },
  ]);
  afterTurn("4");
  expect(beforeTurn("5", true)).toBeUndefined();
});
