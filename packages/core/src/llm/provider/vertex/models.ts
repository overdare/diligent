// @summary Vertex-owned model-card definitions
import { defineProviderModels } from "../../model-card";
import { defineProviderModelClasses } from "../../model-class";

export const VERTEX_MODEL_CLASSES = defineProviderModelClasses({
  general: { defaultModelId: "vertex-gemma-4-26b-it" },
});

export const VERTEX_MODELS = defineProviderModels("vertex", [
  {
    modelId: "vertex-gemma-4-26b-it",
    display: "Gemma 4 26B (Vertex)",
    contextWindow: 262_144,
    maxOutputTokens: 128_000,
    supportsThinking: false,
    supportsVision: true,
    aliases: ["vertex-gemma", "vertex-gemma-4", "vertex-gemma-4-26b", "gemma-4-26b-vertex", "gemma-vertex"],
    provenance: {
      source: "Google Cloud Gemma 4 26B MaaS model documentation",
      sourceUrl: "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/maas/google/gemma-4-26b-a4b-it",
      updatedAt: "2026-11-18",
    },
  },
]);
