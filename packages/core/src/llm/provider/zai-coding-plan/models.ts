// @summary Z.AI Coding Plan-owned model-card definitions
import { defineProviderModels } from "../../model-card";
import { defineProviderModelClasses } from "../../model-class";

export const ZAI_CODING_PLAN_MODEL_CLASSES = defineProviderModelClasses({
  pro: { defaultModelId: "glm-5.3" },
  general: { defaultModelId: "glm-5.3" },
});

export const ZAI_CODING_PLAN_MODELS = defineProviderModels("zai-coding-plan", [
  {
    modelId: "glm-5.3",
    display: "GLM 5.3",
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsThinking: true,
    supportedEfforts: ["low", "high", "max"],
    supportsVision: false,
    // Coding Plan serves GLM-5.3 for these historical IDs. Keep saved selections resolvable.
    // https://docs.z.ai/devpack/overview
    aliases: ["glm", "glm-5", "glm-5.2", "glm5.2", "glm-5.1", "glm5.1"],
    provenance: {
      source: "Z.AI GLM-5.3 and Coding Plan model documentation",
      sourceUrl: "https://docs.z.ai/guides/llm/glm-5.3",
      updatedAt: "2026-10-28",
    },
  },
  {
    modelId: "glm-5.3-flash",
    display: "GLM 5.3 Flash",
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsThinking: true,
    supportedEfforts: ["low", "high", "max"],
    supportsVision: true,
    provenance: {
      source: "Z.AI GLM-5.3-Flash and Coding Plan model documentation",
      sourceUrl: "https://docs.z.ai/guides/vlm/glm-5.3-flash",
      updatedAt: "2026-10-28",
    },
  },
]);
