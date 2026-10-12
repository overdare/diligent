// @summary TUI /goal status and lifecycle controls backed by goal RPC

import type { ThreadGoal } from "@diligent/protocol";
import { DILIGENT_CLIENT_REQUEST_METHODS } from "@diligent/protocol";
import { parseGoalCommand } from "@diligent/runtime/client";
import { t } from "../../theme";
import type { Command } from "../types";

function formatGoalLines(goal: ThreadGoal | null): string[] {
  if (!goal) return [`  ${t.dim}No goal is set for this thread.${t.reset}`];

  const tokenLimit = goal.tokenBudget === undefined ? "unlimited" : goal.tokenBudget.toLocaleString();
  const lines = [
    `  ${t.bold}Goal:${t.reset}     ${goal.objective}`,
    `  ${t.bold}State:${t.reset}    ${goal.status}`,
    `  ${t.bold}Usage:${t.reset}    ${goal.tokensUsed.toLocaleString()} / ${tokenLimit} tokens`,
    `  ${t.bold}Runs:${t.reset}     ${goal.turnsUsed.toLocaleString()} / ${goal.maxTurns.toLocaleString()} runs`,
    `  ${t.bold}Cached:${t.reset}   ${goal.cacheReadTokens.toLocaleString()} read tokens (not charged)`,
    `  ${t.bold}Active:${t.reset}   ${Math.floor(goal.activeTimeMs / 1000).toLocaleString()} seconds`,
  ];
  if (goal.reason) lines.push(`  ${t.bold}Reason:${t.reset}   ${goal.reason}`);
  if (goal.completionEvidence) lines.push(`  ${t.bold}Evidence:${t.reset} ${goal.completionEvidence}`);
  return lines;
}

export const goalCommand: Command = {
  name: "goal",
  description: "Show or control the thread goal",
  supportsArgs: true,
  availableDuringTask: true,
  handler: async (args, ctx) => {
    const rpc = ctx.app.getRpcClient?.();
    if (!rpc) {
      ctx.displayError("App server is not initialized.");
      return;
    }
    if (!ctx.threadId) {
      ctx.displayError("No active thread. Send a message before setting a goal.");
      return;
    }

    const current = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_GOAL_GET, {
      threadId: ctx.threadId,
    });
    try {
      const change = parseGoalCommand(args, current.goal);
      const response = change
        ? await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_GOAL_SET, {
            threadId: ctx.threadId,
            ...change,
          })
        : current;
      ctx.displayLines(["", ...formatGoalLines(response.goal), ""]);
    } catch (error) {
      ctx.displayError(error instanceof Error ? error.message : String(error));
    }
  },
};
