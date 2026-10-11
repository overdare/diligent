// @summary Shared goal lifecycle snapshots and explicit user control contracts
import { z } from "zod";

const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const limit = counter.positive();
export const GoalObjectiveSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => [...value].length <= 4000, "Goal must be at most 4000 characters");
export const GoalStatusSchema = z.enum(["active", "paused", "blocked", "budget_limited", "usage_limited", "complete"]);
export type GoalStatus = z.infer<typeof GoalStatusSchema>;
export const ThreadGoalSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  revision: counter,
  objective: GoalObjectiveSchema,
  status: GoalStatusSchema,
  tokenBudget: limit.optional(),
  maxTurns: limit,
  turnsUsed: counter,
  tokensUsed: counter,
  cacheReadTokens: counter,
  activeTimeMs: counter,
  accountingScope: z.literal("reported_agent_tokens"),
  reason: z.string().optional(),
  completionEvidence: z.string().optional(),
  createdAt: counter,
  updatedAt: counter,
});
export type ThreadGoal = z.infer<typeof ThreadGoalSchema>;
const limits = { tokenBudget: limit.optional(), maxTurns: limit.optional() };
const identity = { expectedGoalId: z.string().min(1), expectedRevision: counter };
export const GoalChangeSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("set"),
    objective: GoalObjectiveSchema,
    ...limits,
    expectedRevision: counter.optional(),
  }),
  z.object({ action: z.literal("edit"), objective: GoalObjectiveSchema, ...limits, ...identity }),
  z.object({ action: z.literal("pause"), ...identity }),
  z.object({ action: z.literal("resume"), ...identity }),
  z.object({ action: z.literal("clear"), ...identity }),
]);
export type GoalChange = z.infer<typeof GoalChangeSchema>;
export const ThreadGoalGetParamsSchema = z.object({ threadId: z.string().min(1) });
export const ThreadGoalSetParamsSchema = z.intersection(ThreadGoalGetParamsSchema, GoalChangeSchema);
export const ThreadGoalResponseSchema = z.object({ goal: ThreadGoalSchema.nullable(), sequence: counter });
export type ThreadGoalResponse = z.infer<typeof ThreadGoalResponseSchema>;
