// @summary Shared elapsed goal time and human-readable duration formatting
import type { ThreadGoal } from "@diligent/protocol";

export function goalElapsedMs(goal: Pick<ThreadGoal, "activeTimeMs" | "runStartedAt">, now = Date.now()): number {
  return goal.activeTimeMs + (goal.runStartedAt === undefined ? 0 : Math.max(0, now - goal.runStartedAt));
}

export function formatGoalDuration(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
