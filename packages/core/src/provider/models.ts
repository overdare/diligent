// @summary Known models registry with resolution logic for aliases, inference, and model classes
import type { Model } from "./types";

/**
 * Model class tiers — abstract capability levels independent of provider.
 * - pro:     Highest capability, most expensive. For complex reasoning tasks.
 * - general: Balanced cost/capability. Default for most work.
 * - lite:    Cheapest/fastest. Good for read-only exploration and simple tasks.
 */
export type ModelClass = "pro" | "general" | "lite";

export interface ModelDefinition extends Model {
  aliases?: string[];
  modelClass?: ModelClass;
}

export const KNOWN_MODELS: ModelDefinition[] = [
  // Anthropic
  {
    id: "claude-opus-4-6",
    provider: "anthropic",
    contextWindow: 200_000,
    maxOutputTokens: 128_000,
    inputCostPer1M: 5.0,
    outputCostPer1M: 25.0,
    supportsThinking: true,
    defaultBudgetTokens: 10_000,
    aliases: ["claude-opus", "opus"],
    modelClass: "pro",
  },
  {
    id: "claude-sonnet-4-6",
    provider: "anthropic",
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    inputCostPer1M: 3.0,
    outputCostPer1M: 15.0,
    supportsThinking: true,
    defaultBudgetTokens: 10_000,
    aliases: ["claude-sonnet", "sonnet"],
    modelClass: "general",
  },
  {
    id: "claude-haiku-4-5-20251001",
    provider: "anthropic",
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    inputCostPer1M: 1.0,
    outputCostPer1M: 5.0,
    supportsThinking: true,
    defaultBudgetTokens: 10_000,
    aliases: ["claude-haiku", "haiku"],
    modelClass: "lite",
  },
  // Gemini
  {
    id: "gemini-2.5-pro",
    provider: "gemini",
    contextWindow: 1_000_000,
    maxOutputTokens: 65_536,
    inputCostPer1M: 1.25,
    outputCostPer1M: 10.0,
    supportsThinking: true,
    defaultBudgetTokens: 10_000,
    aliases: ["gemini-pro"],
    modelClass: "pro",
  },
  {
    id: "gemini-2.5-flash",
    provider: "gemini",
    contextWindow: 1_000_000,
    maxOutputTokens: 65_536,
    inputCostPer1M: 0.15,
    outputCostPer1M: 0.6,
    supportsThinking: true,
    defaultBudgetTokens: 10_000,
    aliases: ["gemini-flash", "gemini"],
    modelClass: "general",
  },
  {
    id: "gemini-2.5-flash-lite",
    provider: "gemini",
    contextWindow: 1_000_000,
    maxOutputTokens: 65_536,
    inputCostPer1M: 0.1,
    outputCostPer1M: 0.4,
    supportsThinking: true,
    defaultBudgetTokens: 10_000,
    aliases: ["gemini-flash-lite"],
    modelClass: "lite",
  },
  {
    id: "gemini-3.1-pro-preview",
    provider: "gemini",
    contextWindow: 1_000_000,
    maxOutputTokens: 65_536,
    inputCostPer1M: 2.0,
    outputCostPer1M: 12.0,
    supportsThinking: true,
    defaultBudgetTokens: 10_000,
    aliases: ["gemini-3.1-pro"],
    modelClass: "pro",
  },
  {
    id: "gemini-3-flash-preview",
    provider: "gemini",
    contextWindow: 1_000_000,
    maxOutputTokens: 65_536,
    inputCostPer1M: 0.5,
    outputCostPer1M: 3.0,
    supportsThinking: true,
    defaultBudgetTokens: 10_000,
    aliases: ["gemini-3-flash"],
    modelClass: "general",
  },
  // OpenAI
  {
    id: "gpt-5.3-codex",
    provider: "openai",
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
    inputCostPer1M: 1.75,
    outputCostPer1M: 14.0,
    supportsThinking: true,
    defaultBudgetTokens: 10_000,
    aliases: ["codex"],
    modelClass: "pro",
  },
  {
    id: "gpt-5.2",
    provider: "openai",
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
    inputCostPer1M: 1.75,
    outputCostPer1M: 14.0,
    supportsThinking: true,
    defaultBudgetTokens: 10_000,
    modelClass: "general",
  },
  {
    id: "gpt-5.2-codex",
    provider: "openai",
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
    inputCostPer1M: 1.75,
    outputCostPer1M: 14.0,
    supportsThinking: true,
    defaultBudgetTokens: 10_000,
    modelClass: "general",
  },
  {
    id: "gpt-5.1-codex",
    provider: "openai",
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
    inputCostPer1M: 1.25,
    outputCostPer1M: 10.0,
    supportsThinking: true,
    defaultBudgetTokens: 10_000,
    modelClass: "general",
  },
  {
    id: "codex-mini-latest",
    provider: "openai",
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    inputCostPer1M: 1.5,
    outputCostPer1M: 6.0,
    supportsThinking: false,
    defaultBudgetTokens: 10_000,
    aliases: ["codex-mini"],
    modelClass: "lite",
  },
  {
    id: "o3",
    provider: "openai",
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    inputCostPer1M: 2.0,
    outputCostPer1M: 8.0,
    supportsThinking: true,
    defaultBudgetTokens: 10_000,
    modelClass: "pro",
  },
  {
    id: "o4-mini",
    provider: "openai",
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    inputCostPer1M: 1.1,
    outputCostPer1M: 4.4,
    supportsThinking: true,
    defaultBudgetTokens: 10_000,
    aliases: ["o4"],
    modelClass: "lite",
  },
  {
    id: "gpt-4.1",
    provider: "openai",
    contextWindow: 1_047_576,
    maxOutputTokens: 32_768,
    inputCostPer1M: 2.0,
    outputCostPer1M: 8.0,
    modelClass: "general",
  },
];

/**
 * Resolve a model for a given provider and model class.
 * Returns the first KNOWN_MODELS entry matching both provider and modelClass.
 * Falls back to the current model if no match is found.
 */
export function resolveModelForClass(currentModel: Model, targetClass: ModelClass): Model {
  const provider = currentModel.provider;

  // If the current model already has this class, return as-is
  const currentDef = KNOWN_MODELS.find((m) => m.id === currentModel.id);
  if (currentDef?.modelClass === targetClass) return currentModel;

  // Find the first known model matching both provider and class
  const match = KNOWN_MODELS.find((m) => m.provider === provider && m.modelClass === targetClass);
  return match ?? currentModel;
}

/**
 * Determine the model class of a given model.
 * Returns the modelClass from KNOWN_MODELS if found, otherwise infers "general".
 */
export function getModelClass(model: Model): ModelClass {
  const def = KNOWN_MODELS.find((m) => m.id === model.id);
  return def?.modelClass ?? "general";
}

/**
 * Map agent type to a default model class.
 * - "explore" agents do read-only work → lite
 * - "general" agents need full capability → same class as parent
 */
export function agentTypeToModelClass(agentType: string, parentModel: Model): ModelClass {
  if (agentType === "explore") return "lite";
  // general: keep the same class as parent
  return getModelClass(parentModel);
}

/**
 * Resolve a model ID or alias to a full Model.
 * For unknown models, infer provider from ID prefix.
 */
export function resolveModel(modelId: string): Model {
  // Exact match
  const exact = KNOWN_MODELS.find((m) => m.id === modelId);
  if (exact) return exact;

  // Alias match
  const aliased = KNOWN_MODELS.find((m) => m.aliases?.includes(modelId));
  if (aliased) return aliased;

  // Infer provider from prefix
  if (modelId.startsWith("gemini-")) {
    return { id: modelId, provider: "gemini", contextWindow: 1_000_000, maxOutputTokens: 65_536 };
  }
  if (modelId.startsWith("claude-")) {
    return { id: modelId, provider: "anthropic", contextWindow: 200_000, maxOutputTokens: 16_384 };
  }
  if (modelId.startsWith("gpt-") || modelId.match(/^o[1-9]/)) {
    return { id: modelId, provider: "openai", contextWindow: 128_000, maxOutputTokens: 16_384 };
  }

  // Default to anthropic
  return { id: modelId, provider: "anthropic", contextWindow: 200_000, maxOutputTokens: 16_384 };
}
