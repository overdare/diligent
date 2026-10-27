// @summary Browser-safe goal labels, reason text, and elapsed-time formatting shared by TUI, Web, and prompts

import type { ThreadGoal } from "@diligent/protocol";

/** Active time including the in-flight run, so clients can tick elapsed time live. */
export function goalElapsedMs(goal: Pick<ThreadGoal, "activeTimeMs" | "runStartedAt">, now = Date.now()): number {
  return goal.activeTimeMs + (goal.runStartedAt !== undefined ? Math.max(0, now - goal.runStartedAt) : 0);
}

export function formatGoalDuration(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function goalStatusLabel(goal: Pick<ThreadGoal, "status" | "reason">): string {
  switch (goal.status) {
    case "active":
      return "In progress";
    case "paused":
      if (goal.reason === "user_turn") return "Paused for your message";
      if (goal.reason === "config_reload") return "Paused for reload";
      return "Paused";
    case "blocked":
      return "Blocked";
    case "budget_limited":
      return goal.reason === "turn_limit" ? "Run limit reached" : "Token budget reached";
    case "usage_limited":
      return "Usage limit reached";
    case "complete":
      return "Complete";
  }
}

const REASON_TEXT: Record<string, string> = {
  user: "Paused by you.",
  user_request: "Paused at your request.",
  user_turn: "Paused while your message is handled; resumes automatically when the reply finishes.",
  config_reload: "Paused for a configuration reload; resumes automatically when the reload succeeds.",
  interrupted: "The last goal run was interrupted.",
  disconnected: "Paused because no app window was connected.",
  execution_unavailable: "Paused because goal runs are unavailable (goals disabled or plan mode).",
  interaction_unavailable: "Paused because an approval or question needed you while no app window was connected.",
  plan_mode: "Paused because plan mode is on. Resume after leaving plan mode.",
  restart: "Paused because the app restarted.",
  shutdown: "Paused because the app shut down.",
  runtime_error: "Paused after an internal error.",
  persistence_error: "Paused because goal state could not be saved.",
  disabled: "Paused because goals are disabled in settings.",
  no_progress: "Stopped: three goal runs in a row made no tool calls.",
  token_budget: "Token budget reached. Raise it with /goal edit --tokens N (or off), then resume.",
  turn_limit: "Run limit reached. Raise it with /goal edit --runs N (or off), then resume.",
};

/** Human text for runtime reason codes; model- or provider-written reasons are returned verbatim. */
export function describeGoalReason(reason: string): string {
  return Object.hasOwn(REASON_TEXT, reason) ? REASON_TEXT[reason] : reason;
}
