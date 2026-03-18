// @summary Web model lookup and thinking-effort option helpers

import type { ModelInfo, ThinkingEffort } from "@diligent/protocol";

export function findModelInfo(models: ModelInfo[], modelId?: string): ModelInfo | undefined {
  if (!modelId) return undefined;
  return models.find((model) => model.id === modelId);
}

export function supportsThinkingNone(
  model: Pick<ModelInfo, "supportsThinking" | "supportedEfforts"> | undefined,
): boolean {
  if (!model?.supportsThinking) return false;
  return model.supportedEfforts?.includes("none") ?? false;
}

function getThinkingEffortLabel(
  effort: ThinkingEffort,
  model: Pick<ModelInfo, "supportsThinking" | "supportedEfforts"> | undefined,
): string {
  if (effort === "none" && supportsThinkingNone(model)) return "minimal";
  return effort;
}

export function getThinkingEffortOptions(
  model: Pick<ModelInfo, "supportsThinking" | "supportedEfforts"> | undefined,
): Array<{ value: ThinkingEffort; label: string }> {
  const effortValues: ThinkingEffort[] = ["none", "low", "medium", "high", "max"];
  if (model && !model.supportsThinking) return [];
  const supportedEfforts =
    model?.supportsThinking === true
      ? (model.supportedEfforts ?? effortValues.filter((effort) => effort !== "none"))
      : effortValues.filter((effort) => effort !== "none");
  return supportedEfforts.map((effort) => ({ value: effort, label: getThinkingEffortLabel(effort, model) }));
}

export function getThinkingEffortUsage(
  model: Pick<ModelInfo, "supportsThinking" | "supportedEfforts"> | undefined,
): string {
  return getThinkingEffortOptions(model)
    .map((option) => option.label)
    .join("|");
}
