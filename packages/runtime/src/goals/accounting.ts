// @summary Goal attribution and charge calculation for normalized provider usage
export interface GoalRunIdentity {
  goalId: string;
  epoch: number;
  outerRunId: string;
}
export interface GoalUsageSample {
  /** Distinguishes a resumed child's new run when its core turn counter restarts. */
  executionId?: string;
  identity: GoalRunIdentity;
  sessionId: string;
  coreTurnId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}
export function chargeableGoalTokens(
  usage: Pick<GoalUsageSample, "inputTokens" | "outputTokens" | "cacheWriteTokens">,
): number {
  return Math.max(0, usage.inputTokens) + Math.max(0, usage.cacheWriteTokens) + Math.max(0, usage.outputTokens);
}
export function goalSampleKey(sample: GoalUsageSample): string {
  return JSON.stringify([
    sample.identity.goalId,
    sample.identity.epoch,
    sample.identity.outerRunId,
    sample.sessionId,
    sample.executionId ?? "",
    sample.coreTurnId,
  ]);
}
