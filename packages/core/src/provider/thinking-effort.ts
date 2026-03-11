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

export function supportsThinkingNone(
  model: Pick<Model, "provider" | "supportsThinking" | "supportedEfforts"> | undefined,
): boolean {
  if (!model?.supportsThinking) return false;
  return model.supportedEfforts?.includes("none") ?? false;
}

export function getThinkingEffortLabel(
  effort: ThinkingEffort,
  model: Pick<Model, "provider" | "supportsThinking" | "supportedEfforts"> | undefined,
): string {
  if (effort === "none" && supportsThinkingNone(model)) return "minimal";
  return effort;
}

export function getThinkingEffortOptions(
  model: Pick<Model, "provider" | "supportsThinking" | "supportedEfforts"> | undefined,
): Array<{ value: ThinkingEffort; label: string }> {
  if (model && !model.supportsThinking) return [];
  const supportedEfforts =
    model?.supportsThinking === true
      ? (model.supportedEfforts ?? THINKING_EFFORT_VALUES.filter((effort) => effort !== "none"))
      : THINKING_EFFORT_VALUES.filter((effort) => effort !== "none");
  return supportedEfforts.map((effort) => ({
    value: effort,
    label: getThinkingEffortLabel(effort, model),
  }));
}

export function getThinkingEffortUsageValues(
  model: Pick<Model, "provider" | "supportsThinking" | "supportedEfforts"> | undefined,
): string[] {
  return getThinkingEffortOptions(model).map((option) => option.label);
}

export function getThinkingEffortUsage(
  model: Pick<Model, "provider" | "supportsThinking" | "supportedEfforts"> | undefined,
): string {
  return getThinkingEffortUsageValues(model).join("|");
}

export function findModelInfo(models: ModelInfo[], modelId?: string): ModelInfo | undefined {
  if (!modelId) return undefined;
  return models.find((model) => model.id === modelId);
}
