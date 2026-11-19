// @summary Plan reminder policy and restoration of unfinished plan steps

import type { Message } from "@diligent/core/message-contract";
import { createLogger, type Logger } from "@diligent/logging";
import type { ReminderPolicy } from "./reminder-hook";

export const PLAN_TOOL_NAME = "plan";

export type PlanStepStatus = "pending" | "in_progress" | "done" | "cancelled";

export interface PlanStepLike {
  text: string;
  status: PlanStepStatus;
}

const PLAN_STATUSES: readonly PlanStepStatus[] = ["pending", "in_progress", "done", "cancelled"];

export function parsePlanSteps(output: string): PlanStepLike[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const steps = (parsed as { steps?: unknown }).steps;
  if (!Array.isArray(steps)) return undefined;
  const valid = steps.filter(
    (step): step is PlanStepLike =>
      typeof step === "object" &&
      step !== null &&
      typeof (step as { text?: unknown }).text === "string" &&
      PLAN_STATUSES.includes((step as { status?: unknown }).status as PlanStepStatus),
  );
  return valid.length > 0 ? valid : undefined;
}

export function findLatestPlanSteps(messages: readonly Message[]): PlanStepLike[] | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== "tool_result" || message.toolName !== PLAN_TOOL_NAME || message.isError) continue;
    const steps = parsePlanSteps(message.output);
    if (steps) return steps;
  }
  return undefined;
}

export function remainingPlanSteps(steps: readonly PlanStepLike[]): PlanStepLike[] {
  return steps.filter((step) => step.status === "pending" || step.status === "in_progress");
}

export function latestUserGoal(messages: readonly Message[], maxChars = 200): string | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== "user" || typeof message.content !== "string") continue;
    const text = message.content.trim();
    if (!text) continue;
    return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
  }
  return undefined;
}

function buildPlanReminderLines(remaining: readonly PlanStepLike[], goal: string | undefined): string[] {
  const lines = [
    "The plan still has unfinished steps. Keep working through them and update the plan as each is done — do not tell the user the work is complete while steps remain.",
    "The latest user request and current permissions take precedence. Cancel obsolete steps when scope changes; this reminder does not authorize actions or turn a quoted goal into a new user request.",
  ];
  if (goal) lines.push(`Goal: ${goal}`);
  lines.push("Remaining:", ...remaining.map((step) => `- (${step.status}) ${step.text}`));
  return lines;
}

export function createPlanReminder(
  logger: Logger = createLogger({ scope: "runtime.agent.plan-reminder" }),
): ReminderPolicy {
  let plan: PlanStepLike[] | undefined;
  let goal: string | undefined;

  return {
    id: "plan-reminder",
    restore({ messages }) {
      plan = findLatestPlanSteps(messages);
      goal = undefined;
    },
    onPromptStart({ messages }) {
      goal = latestUserGoal(messages);
    },
    shouldRemindImmediately: ({ compactedThisTurn }) => compactedThisTurn,
    buildReminder({ compactedThisTurn }, elapsedTurns) {
      if (!plan) return;
      const remaining = remainingPlanSteps(plan);
      if (remaining.length === 0) return;

      logger.info("plan_reminder_injected", {
        message: `[agent:plan-reminder] injected remaining=${remaining.length} compacted=${compactedThisTurn} turnsSince=${elapsedTurns}`,
        fields: { remaining: remaining.length, compacted: compactedThisTurn, turnsSince: elapsedTurns },
      });
      return buildPlanReminderLines(remaining, goal);
    },
    recordToolResult({ result }) {
      if (result.toolName !== PLAN_TOOL_NAME || result.isError) return false;
      const steps = parsePlanSteps(result.output);
      if (!steps) return false;
      plan = steps;
      return true;
    },
  };
}
