// @summary Shared thinking-effort helpers for aliases, provider capabilities, and UI labels
import type { ModelInfo } from "@diligent/protocol";
import type { Model, ThinkingEffort } from "./types";

export const THINKING_EFFORT_VALUES = [
  "none",
  "low",
  "medium",
  "high",
  "max",
] as const satisfies readonly ThinkingEffort[];

export function normalizeThinkingEffort(value: ThinkingEffort): ThinkingEffort {
  return value;
}

export function supportsThinkingNone(model: Pick<Model, "provider" | "supportsThinking"> | undefined): boolean {
  if (!model?.supportsThinking) return false;
  return model.provider === "openai" || model.provider === "gemini";
}

export function getThinkingEffortLabel(
  effort: ThinkingEffort,
  model: Pick<Model, "provider" | "supportsThinking"> | undefined,
): string {
  if (effort === "none" && supportsThinkingNone(model)) return "minimal";
  return effort;
}

export function getThinkingEffortOptions(
  model: Pick<Model, "provider" | "supportsThinking"> | undefined,
): Array<{ value: ThinkingEffort; label: string }> {
  return THINKING_EFFORT_VALUES.filter((effort) => effort !== "none" || supportsThinkingNone(model)).map((effort) => ({
    value: effort,
    label: getThinkingEffortLabel(effort, model),
  }));
}

export function findModelInfo(models: ModelInfo[], modelId?: string): ModelInfo | undefined {
  if (!modelId) return undefined;
  return models.find((model) => model.id === modelId);
}
