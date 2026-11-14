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
  // Previous-generation models stay selectable: ChatGPT Enterprise/Business workspaces can lag the
  // latest rollout available to personal plans. Limits mirror the Codex ChatGPT model catalog.
  {
    modelId: "gpt-6-sol",
    display: "ChatGPT 6 Sol",
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    supportsThinking: true,
    supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
    supportsVision: true,
    supportsFastMode: true,
  },
  {
    modelId: "gpt-5.6-sol",
    display: "ChatGPT 5.6 Sol",
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    supportsThinking: true,
    supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
    supportsVision: true,
    supportsFastMode: true,
  },
  {
    modelId: "gpt-5.6-terra",
    display: "ChatGPT 5.6 Terra",
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    supportsThinking: true,
    supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
    supportsVision: true,
    supportsFastMode: true,
  },
  {
    modelId: "gpt-5.6-luna",
    display: "ChatGPT 5.6 Luna",
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    supportsThinking: true,
    supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
    supportsVision: true,
    supportsFastMode: true,
  },
]);
