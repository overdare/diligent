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

  expect(beforeTurn("1", true)).toBeUndefined();
  hook.afterTurn?.({ turnId: "1", message, toolResults: [] });
  expect(beforeTurn("2", true)).toBeUndefined();
  hook.afterTurn?.({ turnId: "2", message, toolResults: [] });
  expect(beforeTurn("3")).toBeUndefined();
  hook.afterTurn?.({ turnId: "3", message, toolResults: [] });

  expect(beforeTurn("4", true)).toEqual([
    { source: "review-reminder", content: "<system-reminder>\nReview the changes.\n</system-reminder>" },
  ]);
  hook.afterTurn?.({ turnId: "4", message, toolResults: [] });
  expect(beforeTurn("5", true)).toBeUndefined();
});
