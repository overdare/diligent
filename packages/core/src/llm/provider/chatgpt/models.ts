// @summary ChatGPT subscription-owned model-card definitions
import { defineProviderModels } from "../../model-card";
import { defineProviderModelClasses } from "../../model-class";

export const CHATGPT_MODEL_CLASSES = defineProviderModelClasses({
  pro: { defaultModelId: "gpt-5.6-sol" },
  general: { defaultModelId: "gpt-5.6-terra" },
  lite: { defaultModelId: "gpt-5.6-luna" },
});

export const CHATGPT_MODELS = defineProviderModels("chatgpt", [
  {
    modelId: "gpt-5.5",
    display: "ChatGPT 5.5",
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    supportsThinking: true,
    supportedEfforts: ["low", "medium", "high", "xhigh"],
    supportsVision: true,
    aliases: ["gpt-5.5-pro"],
  },
  {
    modelId: "gpt-5.6-sol",
    display: "ChatGPT 5.6 Sol",
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    supportsThinking: true,
    supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
    supportsVision: true,
    aliases: ["gpt-5.6"],
  },
  {
    modelId: "gpt-5.6-terra",
    display: "ChatGPT 5.6 Terra",
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    supportsThinking: true,
    supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
    supportsVision: true,
  },
  {
    modelId: "gpt-5.6-luna",
    display: "ChatGPT 5.6 Luna",
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    supportsThinking: true,
    supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
    supportsVision: true,
  },
  {
    modelId: "gpt-6-astra",
    display: "ChatGPT 6 Astra",
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    supportsThinking: true,
    supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
    supportsVision: true,
    aliases: ["gpt-6", "astra"],
  },
]);

// The ChatGPT Codex endpoint rejected these model IDs with HTTP 400 on 2026-09-23.
// Keep the cards and transport support ready; add them to CHATGPT_MODELS and
// CHATGPT_MODEL_CLASSES only after ChatGPT OAuth access is confirmed.
export const CHATGPT_PENDING_MODELS = defineProviderModels("chatgpt", [
  {
    modelId: "gpt-6-sol",
    display: "ChatGPT 6 Sol",
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    supportsThinking: true,
    supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
    supportsVision: true,
  },
  {
    modelId: "gpt-6-luna",
    display: "ChatGPT 6 Luna",
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    supportsThinking: true,
    supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
    supportsVision: true,
  },
]);
