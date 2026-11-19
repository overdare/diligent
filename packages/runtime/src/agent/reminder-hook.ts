// @summary Shared cadence and model-context injection for runtime reminder policies

import type {
  AgentLoopHook,
  AgentLoopHookBeforeTurnContext,
  AgentLoopHookToolResultContext,
} from "@diligent/core/agent";

export interface ReminderPolicy extends Pick<AgentLoopHook, "id" | "restore" | "onPromptStart"> {
  shouldRemindImmediately?(context: AgentLoopHookBeforeTurnContext): boolean;
  /** Return reminder body lines, or undefined if the reminder does not apply. */
  buildReminder(context: AgentLoopHookBeforeTurnContext, elapsedTurns: number): readonly string[] | undefined;
  /** Record use-case state and return true if the result resets the cadence. */
  recordToolResult?(context: AgentLoopHookToolResultContext): boolean;
}

export function createReminderHook({
  intervalTurns,
  policy,
}: {
  intervalTurns: number;
  policy: ReminderPolicy;
}): AgentLoopHook {
  let elapsedTurns = 0;
  let progressedThisTurn = false;

  return {
    id: policy.id,
    restore(context) {
      elapsedTurns = 0;
      progressedThisTurn = false;
      policy.restore?.(context);
    },
    onPromptStart(context) {
      policy.onPromptStart?.(context);
    },
    beforeTurn(context) {
      if (intervalTurns <= 0 || (elapsedTurns < intervalTurns && !policy.shouldRemindImmediately?.(context))) return;
      const lines = policy.buildReminder(context, elapsedTurns);
      if (!lines) return;
      elapsedTurns = 0;
      return [{ source: policy.id, content: ["<system-reminder>", ...lines, "</system-reminder>"].join("\n") }];
    },
    onToolResult(context) {
      if (policy.recordToolResult?.(context)) progressedThisTurn = true;
    },
    afterTurn() {
      elapsedTurns = progressedThisTurn ? 0 : elapsedTurns + 1;
      progressedThisTurn = false;
    },
  };
}
