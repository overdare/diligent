// @summary Gemini-owned model-card definitions
import { defineProviderModels } from "../../model-card";
import { defineProviderModelClasses } from "../../model-class";

export const GEMINI_MODEL_CLASSES = defineProviderModelClasses({
  pro: { defaultModelId: "gemini-3.6-flash" },
  general: { defaultModelId: "gemini-3.6-flash" },
  lite: { defaultModelId: "gemini-3.5-flash-lite" },
});

export const GEMINI_MODELS = defineProviderModels("gemini", [
  {
    modelId: "gemini-4-neon",
    display: "Gemini 4 Neon",
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    inputCostPer1M: 3,
    outputCostPer1M: 15,
    cacheReadCostPer1M: 0.15,
    supportsThinking: true,
    supportedEfforts: ["low", "medium", "high", "xhigh"],
    supportsVision: true,
    provenance: {
      source: "Gemini 4 Neon model documentation and Standard paid pricing",
      sourceUrl: "https://aistudio.google.com/docs/whats-new-gemini-4-neon",
      updatedAt: "2026-11-21",
    },
  },
  {
    modelId: "gemini-4-carbon",
    display: "Gemini 4 Carbon",
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    // Promotional Standard rates through November 30, 2026.
    inputCostPer1M: 2,
    outputCostPer1M: 10,
    cacheReadCostPer1M: 0.1,
    supportsThinking: true,
    supportedEfforts: ["low", "medium", "high"],
    supportsVision: true,
    provenance: {
      source: "Gemini 4 Carbon model documentation and Standard paid pricing",
      sourceUrl: "https://ai.google.dev/gemini-api/docs/models/gemini-4-carbon",
      updatedAt: "2026-11-18",
    },
  },
  {
    modelId: "gemini-4-argon",
    display: "Gemini 4 Argon",
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    // Promotional Standard rates through November 30, 2026.
    inputCostPer1M: 2,
    outputCostPer1M: 10,
    cacheReadCostPer1M: 0.1,
    supportsThinking: true,
    supportedEfforts: ["low", "medium", "high"],
    supportsVision: true,
    provenance: {
      source: "Gemini 4 Argon model documentation and Standard paid pricing",
      sourceUrl: "https://ai.google.dev/gemini-api/docs/models/gemini-4-argon",
      updatedAt: "2026-11-18",
    },
  },
  {
    modelId: "gemini-4-hydrogen",
    display: "Gemini 4 Hydrogen",
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    inputCostPer1M: 1.5,
    outputCostPer1M: 7.5,
    cacheReadCostPer1M: 0.075,
    supportsThinking: true,
    supportedEfforts: ["low", "medium", "high", "xhigh"],
    supportsVision: true,
    aliases: ["gemini-4"],
    provenance: {
      source: "Gemini 4 Hydrogen model documentation and Standard paid pricing",
      sourceUrl: "https://ai.google.dev/gemini-api/docs/models/gemini-4-hydrogen",
      updatedAt: "2026-11-18",
    },
  },
  {
    modelId: "gemini-3.8-flash",
    display: "Gemini 3.8 Flash",
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    inputCostPer1M: 1.5,
    outputCostPer1M: 7.5,
    supportsThinking: true,
    supportedEfforts: ["low", "medium", "high"],
    supportsVision: true,
    // Google keeps this deprecated endpoint available but serves Gemini 3.8 Flash for it.
    aliases: ["gemini-3.7-flash"],
    provenance: {
      source: "Gemini 3.8 Flash model documentation and routed Gemini 3.7 deprecation",
      sourceUrl: "https://ai.google.dev/gemini-api/docs/deprecations#gemini-3-models",
      updatedAt: "2026-11-03",
    },
  },
  {
    modelId: "gemini-3.6-flash",
    display: "Gemini 3.6 Flash",
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    inputCostPer1M: 1.5,
    outputCostPer1M: 7.5,
    supportsThinking: true,
    supportedEfforts: ["low", "medium", "high"],
    supportsVision: true,
    // This historical endpoint remains available but Google serves Gemini 3.6 Flash for it.
    aliases: ["gemini-pro", "gemini-flash", "gemini", "gemini-3.5-flash"],
    provenance: {
      source: "Gemini 3.6 Flash model documentation and routed Gemini 3.5 deprecation",
      sourceUrl: "https://aistudio.google.com/docs/deprecations#gemini-3-models",
      updatedAt: "2026-11-05",
    },
  },
  {
    modelId: "gemini-3.5-flash-lite",
    display: "Gemini 3.5 Flash-Lite",
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    inputCostPer1M: 0.3,
    outputCostPer1M: 2.5,
    cacheReadCostPer1M: 0.03,
    supportsThinking: true,
    supportedEfforts: ["low", "medium", "high"],
    supportsVision: true,
    aliases: ["gemini-flash-lite"],
    provenance: {
      source: "Gemini Developer API Standard paid pricing",
      sourceUrl: "https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-flash-lite",
      updatedAt: "2026-11-02",
    },
  },
]);
