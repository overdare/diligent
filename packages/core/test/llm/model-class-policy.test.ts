// @summary Tests provider-scoped pro, general, and lite model routing policy
import { describe, expect, it } from "bun:test";
import { getDefaultEffortForClass, MODEL_CLASSES, resolveModelForClass } from "../../src/llm/model-class-policy";
import { findModel, listModels, resolveModel } from "../../src/llm/models";
import { ANTHROPIC_MODEL_CLASSES } from "../../src/llm/provider/anthropic/models";
import { CHATGPT_MODEL_CLASSES } from "../../src/llm/provider/chatgpt/models";
import { GEMINI_MODEL_CLASSES } from "../../src/llm/provider/gemini/models";
import { OPENAI_MODEL_CLASSES } from "../../src/llm/provider/openai/models";
import { VERTEX_MODEL_CLASSES } from "../../src/llm/provider/vertex/models";
import { ZAI_CODING_PLAN_MODEL_CLASSES } from "../../src/llm/provider/zai-coding-plan/models";
import type { ProviderName } from "../../src/llm/types";

describe("model class policy", () => {
  it("uses xhigh effort for pro class selection", () => {
    expect(getDefaultEffortForClass("pro")).toBe("xhigh");
  });

  it("keeps class policy separate from provider-owned model cards", () => {
    for (const model of listModels()) {
      expect("modelClass" in model).toBe(false);
      expect("isDefaultForModelClass" in model).toBe(false);
    }

    const providerDefinitions = {
      anthropic: ANTHROPIC_MODEL_CLASSES,
      openai: OPENAI_MODEL_CLASSES,
      chatgpt: CHATGPT_MODEL_CLASSES,
      gemini: GEMINI_MODEL_CLASSES,
      vertex: VERTEX_MODEL_CLASSES,
      "zai-coding-plan": ZAI_CODING_PLAN_MODEL_CLASSES,
    } satisfies Record<ProviderName, object>;

    for (const [provider, definitions] of Object.entries(providerDefinitions)) {
      for (const definition of Object.values(definitions)) {
        expect(findModel({ provider: provider as ProviderName, modelId: definition.defaultModelId })).toBeDefined();
        for (const modelId of definition.additionalModelIds ?? []) {
          expect(findModel({ provider: provider as ProviderName, modelId })).toBeDefined();
        }
      }
    }
  });

  it("routes classes to provider models without hard-coding model IDs", () => {
    for (const modelClass of MODEL_CLASSES) {
      for (const [providerName, defaultModelId] of Object.entries(modelClass.defaultModelIds)) {
        const provider = providerName as ProviderName;
        const current = listModels(provider)[0];
        expect(current).toBeDefined();
        if (!current || !defaultModelId)
          throw new Error(`Missing model-class fixture for ${provider}/${modelClass.id}`);
        expect(resolveModelForClass(current, modelClass.id)).toMatchObject({ provider, modelId: defaultModelId });
      }
    }
  });

  it("uses Gemini 3.6 Flash for pro and general while keeping Flash-Lite for lite", () => {
    const flash = resolveModel({ provider: "gemini", modelId: "gemini-3.6-flash" });

    expect(GEMINI_MODEL_CLASSES).toEqual({
      pro: { defaultModelId: "gemini-3.6-flash" },
      general: { defaultModelId: "gemini-3.6-flash" },
      lite: { defaultModelId: "gemini-3.5-flash-lite" },
    });
    expect(resolveModelForClass(flash, "pro").modelId).toBe("gemini-3.6-flash");
    expect(resolveModelForClass(flash, "general").modelId).toBe("gemini-3.6-flash");
    expect(resolveModelForClass(flash, "lite").modelId).toBe("gemini-3.5-flash-lite");
  });
});
