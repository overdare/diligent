// @summary Shared client parser and monotonic snapshot guard for the /goal command

import type { GoalChange, ThreadGoal, ThreadGoalResponse } from "@diligent/protocol";

const GOAL_USAGE =
  "/goal [set] <objective> [--tokens N] [--turns N|unlimited] | edit <objective> [--tokens N] [--turns N|unlimited] | pause | resume | clear";

function requireCurrentGoal(goal: ThreadGoal | null | undefined): ThreadGoal {
  if (!goal) {
    throw new Error("No goal exists for this thread. Start one with /goal set <objective>.");
  }
  return goal;
}

function parsePositiveInteger(flag: "--tokens" | "--turns", value: string | undefined): number {
  if (!value || !/^\d+$/.test(value)) {
    throw new Error(`${flag} requires a positive integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} requires a positive safe integer.`);
  }
  return parsed;
}

function parseObjectiveAndLimits(tokens: string[]): {
  objective: string;
  tokenBudget?: number;
  maxTurns?: number | null;
} {
  const objectiveParts: string[] = [];
  let tokenBudget: number | undefined;
  let maxTurns: number | null | undefined;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--tokens" || token === "--turns") {
      if (token === "--tokens") {
        if (tokenBudget !== undefined) throw new Error("--tokens may only be specified once.");
        tokenBudget = parsePositiveInteger(token, tokens[index + 1]);
      } else {
        if (maxTurns !== undefined) throw new Error("--turns may only be specified once.");
        maxTurns = tokens[index + 1] === "unlimited" ? null : parsePositiveInteger(token, tokens[index + 1]);
      }
      index += 1;
      continue;
    }
    if (token.startsWith("--")) {
      throw new Error(`Unknown goal option: ${token}. Usage: ${GOAL_USAGE}`);
    }
    objectiveParts.push(token);
  }

  const objective = objectiveParts.join(" ").trim();
  if (!objective) {
    throw new Error(`A goal objective is required. Usage: ${GOAL_USAGE}`);
  }
  return {
    objective,
    ...(tokenBudget === undefined ? {} : { tokenBudget }),
    ...(maxTurns === undefined ? {} : { maxTurns }),
  };
}

export function parseGoalCommand(args: string | undefined, currentGoal?: ThreadGoal | null): GoalChange | null {
  const trimmed = args?.trim() ?? "";
  if (!trimmed) return null;

  const tokens = trimmed.split(/\s+/);
  const action = tokens[0];

  if (action === "status") {
    if (tokens.length !== 1) throw new Error("Usage: /goal status");
    return null;
  }

  if (action === "pause" || action === "resume" || action === "clear") {
    if (tokens.length !== 1) throw new Error(`Usage: /goal ${action}`);
    const goal = requireCurrentGoal(currentGoal);
    return { action, expectedGoalId: goal.id, expectedRevision: goal.revision };
  }

  if (action === "edit") {
    const goal = requireCurrentGoal(currentGoal);
    return {
      action: "edit",
      ...parseObjectiveAndLimits(tokens.slice(1)),
      expectedGoalId: goal.id,
      expectedRevision: goal.revision,
    };
  }

  const explicitSet = action === "set";
  const parsed = parseObjectiveAndLimits(explicitSet ? tokens.slice(1) : tokens);
  return {
    action: "set",
    ...parsed,
    ...(currentGoal ? { expectedRevision: currentGoal.revision } : {}),
  };
}

export function applyGoalSnapshot(current: ThreadGoalResponse, incoming: ThreadGoalResponse): ThreadGoalResponse {
  // Null is only published after a durable clear, which advances the sequence.
  // A failed initial set can publish a paused goal before the first durable write.
  if (incoming.sequence === current.sequence && current.goal && !incoming.goal) return current;
  // A storage failure has a newer in-memory revision at the same durable sequence.
  if (
    incoming.sequence === current.sequence &&
    incoming.goal &&
    current.goal &&
    incoming.goal.revision < current.goal.revision
  )
    return current;
  return incoming.sequence < current.sequence ? current : incoming;
}

const GOAL_REASONS: Record<string, string> = {
  user: "Paused at your request.",
  restart: "The server restarted. Resume to continue the existing goal.",
  shutdown: "The server shut down. Resume to continue the existing goal.",
  persistence_error: "Goal state could not be saved. Check available disk space and write access, then resume.",
  no_progress: "The agent repeatedly returned without making progress.",
  token_budget: "The goal's token budget was reached. Increase the budget before resuming.",
  turn_limit: "The goal's run limit was reached. Change the limit before resuming.",
  interrupted: "Execution was interrupted.",
  config_reload: "Configuration changed. Resume when the new configuration is ready.",
  interaction_unavailable: "The required user interaction could not be opened.",
  execution_unavailable: "The execution environment is unavailable.",
  runtime_error: "A runtime error interrupted the goal.",
  plan_mode: "Goal execution is unavailable in plan mode. Switch modes before resuming.",
  disabled: "Goal mode is disabled. Enable it before resuming.",
  deleted: "The thread was deleted.",
};

export function goalStopMessage(goal: ThreadGoal): string | undefined {
  if (goal.status === "active" || goal.status === "complete") return undefined;
  const fallback = {
    paused: "Execution is paused.",
    blocked: "Execution needs attention before it can continue.",
    budget_limited: "A goal budget was reached. Increase the budget before resuming.",
    usage_limited: "The provider's usage limit was reached. Resume after the limit resets or access is restored.",
  }[goal.status];
  const reason = goal.reason?.trim();
  return `Goal stopped: ${reason ? (GOAL_REASONS[reason] ?? reason) : fallback}`;
}
