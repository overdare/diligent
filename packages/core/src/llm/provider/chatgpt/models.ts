// @summary ChatGPT subscription-owned model-card definitions
import { defineProviderModels } from "../../model-card";
import { defineProviderModelClasses } from "../../model-class";

export const CHATGPT_MODEL_CLASSES = defineProviderModelClasses({
  pro: { defaultModelId: "gpt-6.1-sol" },
  general: { defaultModelId: "gpt-6.1-terra" },
  lite: { defaultModelId: "gpt-6-luna" },
});

export const CHATGPT_MODELS = defineProviderModels("chatgpt", [
  {
    modelId: "gpt-6.1-terra",
    display: "ChatGPT 6.1 Terra",
    contextWindow: 500_000,
    maxOutputTokens: 128_000,
    supportsThinking: true,
    supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
    supportsVision: true,
    supportsFastMode: true,
  },
  {
    modelId: "gpt-6-astra",
    display: "ChatGPT 6 Astra",
    contextWindow: 500_000,
    maxOutputTokens: 128_000,
    supportsThinking: true,
    supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
    supportsVision: true,
    supportsFastMode: true,
    aliases: ["gpt-6", "astra"],
  },
  {
    modelId: "gpt-6.1-sol",
    display: "ChatGPT 6.1 Sol",
    contextWindow: 500_000,
    maxOutputTokens: 128_000,
    supportsThinking: true,
    supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
    supportsVision: true,
    supportsFastMode: true,
  },
  {
    modelId: "gpt-6-luna",
    display: "ChatGPT 6 Luna",
    contextWindow: 500_000,
    maxOutputTokens: 128_000,
    supportsThinking: true,
    supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
    supportsVision: true,
    supportsFastMode: true,
  },
]);
