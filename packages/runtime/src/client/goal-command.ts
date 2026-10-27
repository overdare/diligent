// @summary Shared client parser and monotonic snapshot guard for the /goal command

import type { GoalChange, ThreadGoal, ThreadGoalResponse } from "@diligent/protocol";

const GOAL_USAGE =
  "/goal [set] <objective> [--tokens N] [--runs N] | edit [<objective>] [--tokens N|off] [--runs N|off] | pause | resume | clear | status";
const GOAL_EDIT_USAGE = "Usage: /goal edit [<objective>] [--tokens N|off] [--runs N|off]";

type LimitFlag = "--tokens" | "--runs";

function requireCurrentGoal(goal: ThreadGoal | null | undefined): ThreadGoal {
  if (!goal) {
    throw new Error("No goal exists for this thread. Start one with /goal set <objective>.");
  }
  return goal;
}

function parseLimit(flag: LimitFlag, value: string | undefined, allowOff: boolean): number | null {
  if (value === "off") {
    if (!allowOff) throw new Error(`${flag} off is only valid with /goal edit`);
    return null;
  }
  if (!value || !/^\d+$/.test(value)) {
    throw new Error(`${flag} requires a positive integer${allowOff ? " or off" : ""}.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} requires a positive safe integer.`);
  }
  return parsed;
}

function parseObjectiveAndLimits(
  tokens: string[],
  allowOff: boolean,
): { objective: string; tokenBudget?: number | null; maxTurns?: number | null } {
  const objectiveParts: string[] = [];
  const limits: { tokenBudget?: number | null; maxTurns?: number | null } = {};

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--tokens" || token === "--runs") {
      const key = token === "--tokens" ? "tokenBudget" : "maxTurns";
      if (key in limits) throw new Error(`${token} may only be specified once.`);
      limits[key] = parseLimit(token, tokens[index + 1], allowOff);
      index += 1;
      continue;
    }
    if (token.startsWith("--")) {
      throw new Error(`Unknown goal option: ${token}. Usage: ${GOAL_USAGE}`);
    }
    objectiveParts.push(token);
  }

  return { objective: objectiveParts.join(" ").trim(), ...limits };
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
    const { objective, ...limits } = parseObjectiveAndLimits(tokens.slice(1), true);
    if (!objective && Object.keys(limits).length === 0) throw new Error(GOAL_EDIT_USAGE);
    return {
      action: "edit",
      ...(objective ? { objective } : {}),
      ...limits,
      expectedGoalId: goal.id,
      expectedRevision: goal.revision,
    };
  }

  const explicitSet = action === "set";
  const { objective, tokenBudget, maxTurns } = parseObjectiveAndLimits(explicitSet ? tokens.slice(1) : tokens, false);
  if (!objective) {
    throw new Error(`A goal objective is required. Usage: ${GOAL_USAGE}`);
  }
  return {
    action: "set",
    objective,
    ...(tokenBudget == null ? {} : { tokenBudget }),
    ...(maxTurns == null ? {} : { maxTurns }),
    ...(currentGoal ? { expectedRevision: currentGoal.revision } : {}),
  };
}

export function applyGoalSnapshot(current: ThreadGoalResponse, incoming: ThreadGoalResponse): ThreadGoalResponse {
  return incoming.sequence < current.sequence ? current : incoming;
}
