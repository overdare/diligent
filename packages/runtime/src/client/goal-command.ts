// @summary Shared client parser and monotonic snapshot guard for the /goal command

import type { GoalChange, ThreadGoal, ThreadGoalResponse } from "@diligent/protocol";

const GOAL_USAGE =
  "/goal [set] <objective> [--tokens N] [--turns N] | edit <objective> [--tokens N] [--turns N] | pause | resume | clear";

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
  maxTurns?: number;
} {
  const objectiveParts: string[] = [];
  let tokenBudget: number | undefined;
  let maxTurns: number | undefined;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--tokens" || token === "--turns") {
      const value = parsePositiveInteger(token, tokens[index + 1]);
      if (token === "--tokens") {
        if (tokenBudget !== undefined) throw new Error("--tokens may only be specified once.");
        tokenBudget = value;
      } else {
        if (maxTurns !== undefined) throw new Error("--turns may only be specified once.");
        maxTurns = value;
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
  return incoming.sequence < current.sequence ? current : incoming;
}
