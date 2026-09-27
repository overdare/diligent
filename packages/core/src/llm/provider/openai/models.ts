// @summary OpenAI-owned model-card definitions
import { defineProviderModels } from "../../model-card";
import { defineProviderModelClasses } from "../../model-class";

export const OPENAI_MODEL_CLASSES = defineProviderModelClasses({
  pro: { defaultModelId: "gpt-6-sol" },
  general: { defaultModelId: "gpt-5.6-terra" },
  lite: { defaultModelId: "gpt-6-luna" },
});

export const OPENAI_MODELS = defineProviderModels("openai", [
  {
    modelId: "gpt-5.6-terra",
    display: "GPT-5.6 Terra",
    contextWindow: 500_000,
    maxOutputTokens: 128_000,
    inputCostPer1M: 2.5,
    outputCostPer1M: 15,
    cacheReadCostPer1M: 0.25,
    cacheWriteCostPer1M: 3.125,
    supportsThinking: true,
    supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
    supportsVision: true,
  },
  {
    modelId: "gpt-6-astra",
    display: "GPT-6 Astra",
    contextWindow: 500_000,
    maxOutputTokens: 128_000,
    inputCostPer1M: 10,
    outputCostPer1M: 50,
    cacheReadCostPer1M: 1,
    cacheWriteCostPer1M: 0,
    supportsThinking: true,
    supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
    supportsVision: true,
    aliases: ["gpt-6", "astra"],
  },
  {
    modelId: "gpt-6-sol",
    display: "GPT-6 Sol",
    contextWindow: 500_000,
    maxOutputTokens: 128_000,
    inputCostPer1M: 2,
    outputCostPer1M: 10,
    cacheReadCostPer1M: 0.2,
    cacheWriteCostPer1M: 2.5,
    supportsThinking: true,
    supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
    supportsVision: true,
  },
  {
    modelId: "gpt-6-luna",
    display: "GPT-6 Luna",
    contextWindow: 500_000,
    maxOutputTokens: 128_000,
    inputCostPer1M: 0.1,
    outputCostPer1M: 0.5,
    cacheReadCostPer1M: 0.01,
    cacheWriteCostPer1M: 0.125,
    supportsThinking: true,
    supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
    supportsVision: true,
  },
]);
