// @summary Tests provider-scoped model catalog identity and strict resolution
import { describe, expect, it } from "bun:test";
import {
  AmbiguousModelError,
  findModel,
  getModelInfoList,
  listModels,
  MODEL_CARD_SCHEMA_VERSION,
  type ModelCard,
  resolveModel,
  resolveModelSelector,
  sameModelRef,
  UnknownModelError,
} from "../../src/llm/models";
import { getDefaultModelRef, PROVIDER_MODEL_POLICIES } from "../../src/llm/provider-model-policy";

describe("provider-scoped model catalog", () => {
  it.each([
    ["openai", "gpt-6.2-astra", 1_050_000],
    ["openai", "gpt-6.2-sol", 1_050_000],
    ["chatgpt", "gpt-6.2-astra", 272_000],
    ["chatgpt", "gpt-6.2-sol", 500_000],
  ] as const)("resolves the GPT-6.2 wire identity %s/%s with its documented limits", (provider, modelId, contextWindow) => {
    const ref = { provider, modelId };
    const card = resolveModel(ref);
    expect(resolveModelSelector(`${provider}/${modelId}`)).toBe(card);
    expect(getModelInfoList().find((info) => sameModelRef(info, ref))).toMatchObject({
      ...ref,
      contextWindow,
      maxOutputTokens: 128_000,
      supportsThinking: true,
      supportedEfforts: ["low", "medium", "high", "xhigh", "max"],
      supportsVision: true,
      supportsFastMode: true,
    });
  });

  it("registers Claude, Gemini, and Vertex models with their documented capabilities", () => {
    expect(resolveModel({ provider: "anthropic", modelId: "claude-fable-5-2" })).toMatchObject({
      contextWindow: 1_000_000,
      maxOutputTokens: 128_000,
      supportsAdaptiveThinking: true,
    });
    expect(resolveModel({ provider: "gemini", modelId: "gemini-4-carbon" })).toMatchObject({
      contextWindow: 1_048_576,
      maxOutputTokens: 65_536,
      supportedEfforts: ["low", "medium", "high"],
    });
    expect(resolveModel({ provider: "gemini", modelId: "gemini-4-argon" })).toMatchObject({
      contextWindow: 1_048_576,
      maxOutputTokens: 65_536,
      supportedEfforts: ["low", "medium", "high"],
    });
    expect(resolveModel({ provider: "gemini", modelId: "gemini-4-hydrogen" })).toMatchObject({
      contextWindow: 1_048_576,
      maxOutputTokens: 65_536,
      supportedEfforts: ["low", "medium", "high", "xhigh"],
    });
    expect(resolveModel({ provider: "vertex", modelId: "vertex-gemma-4-26b-it" })).toMatchObject({
      contextWindow: 262_144,
      maxOutputTokens: 128_000,
      supportsVision: true,
    });
  });

  it("lists each provider-scoped identity once and resolves it to its catalog card", () => {
    const cards = listModels();
    expect(cards.length).toBeGreaterThan(0);
    const identities = cards.map((card) => `${card.provider}/${card.modelId}`);
    expect(new Set(identities).size).toBe(cards.length);
    for (const card of cards) {
      expect(resolveModel(card)).toBe(card);
      expect(resolveModelSelector(`${card.provider}/${card.modelId}`)).toBe(card);
      for (const alias of card.aliases ?? []) {
        expect(resolveModel({ provider: card.provider, modelId: alias })).toBe(card);
        expect(resolveModelSelector(`${card.provider}/${alias}`)).toBe(card);
      }
    }
    for (const provider of Object.keys(PROVIDER_MODEL_POLICIES) as ModelCard["provider"][]) {
      expect(listModels(provider)).toEqual(cards.filter((card) => card.provider === provider));
      const ref = getDefaultModelRef(provider);
      expect(ref).toEqual({ provider, modelId: PROVIDER_MODEL_POLICIES[provider].defaultModel });
      expect(resolveModel(ref).provider).toBe(provider);
    }
  });

  it("selects synthetic aliases, rejects ambiguous identities, and deduplicates repeated cards", () => {
    const first: ModelCard = {
      schemaVersion: MODEL_CARD_SCHEMA_VERSION,
      provider: "openai",
      modelId: "synthetic-model",
      aliases: ["synthetic-alias"],
      contextWindow: 1000,
      maxOutputTokens: 100,
      supportsThinking: false,
    };
    const second: ModelCard = { ...first, provider: "chatgpt" };
    expect(resolveModelSelector("synthetic-alias", [first])).toBe(first);
    expect(resolveModelSelector(first.modelId, [first, first])).toBe(first);
    expect(() => resolveModelSelector(first.modelId, [first, second])).toThrow(AmbiguousModelError);
    expect(() => resolveModelSelector("synthetic-alias", [first, second])).toThrow(AmbiguousModelError);
    expect(() => resolveModelSelector("missing-model", [first])).toThrow("Unknown model");
  });

  it("keeps the routed Gemini 3.7 ID compatible without a stale picker entry", () => {
    expect(listModels("gemini").map((model) => model.modelId)).not.toContain("gemini-3.7-flash");
    expect(
      getModelInfoList()
        .filter((model) => model.provider === "gemini")
        .map((model) => model.modelId),
    ).not.toContain("gemini-3.7-flash");
    const replacement = resolveModel({ provider: "gemini", modelId: "gemini-3.8-flash" });
    expect(resolveModel({ provider: "gemini", modelId: "gemini-3.7-flash" })).toBe(replacement);
    expect(resolveModelSelector("gemini/gemini-3.7-flash")).toBe(replacement);
    expect(resolveModelSelector("gemini-3.7-flash")).toBe(replacement);
  });

  it("resolves the routed Gemini 3.5 ID to the served 3.6 card without adding a stale picker entry", () => {
    const replacement = resolveModel({ provider: "gemini", modelId: "gemini-3.6-flash" });
    expect(resolveModel({ provider: "gemini", modelId: "gemini-3.5-flash" })).toBe(replacement);
    expect(resolveModelSelector("gemini/gemini-3.5-flash")).toBe(replacement);
    expect(resolveModelSelector("gemini-3.5-flash")).toBe(replacement);
    expect(findModel({ provider: "vertex", modelId: "gemini-3.5-flash" })).toBeUndefined();
    expect(listModels("gemini").map((model) => model.modelId)).not.toContain("gemini-3.5-flash");
    expect(
      getModelInfoList().find((model) => model.provider === "gemini" && model.modelId === replacement.modelId),
    ).toMatchObject({ supportsVision: replacement.supportsVision, supportedEfforts: replacement.supportedEfforts });
  });

  it("resolves aliases only inside the explicit provider", () => {
    const model = listModels().find((candidate) => candidate.aliases && candidate.aliases.length > 0);
    expect(model).toBeDefined();
    if (!model) throw new Error("Expected at least one aliased model card");
    const alias = model.aliases?.[0];
    expect(alias).toBeDefined();
    if (!alias) throw new Error("Expected the selected model card to have an alias");
    expect(resolveModel({ provider: model.provider, modelId: alias })).toBe(model);
  });

  it("rejects unknown cards without inferring capabilities", () => {
    const ref = { provider: "openai", modelId: "gpt-unknown" } as const;
    expect(findModel(ref)).toBeUndefined();
    expect(() => resolveModel(ref)).toThrow(UnknownModelError);
    try {
      resolveModel(ref);
    } catch (error) {
      expect((error as UnknownModelError).ref).toEqual(ref);
    }
  });

  it("compares both identity fields", () => {
    expect(
      sameModelRef({ provider: "openai", modelId: "shared-model" }, { provider: "openai", modelId: "shared-model" }),
    ).toBe(true);
    expect(
      sameModelRef({ provider: "openai", modelId: "shared-model" }, { provider: "chatgpt", modelId: "shared-model" }),
    ).toBe(false);
  });

  it("maps catalog cards to protocol model info", () => {
    for (const card of listModels()) expect(card.schemaVersion).toBe(MODEL_CARD_SCHEMA_VERSION);
    const cards = listModels();
    const infos = getModelInfoList();
    expect(infos).toHaveLength(cards.length);
    for (const card of cards) {
      expect(infos.find((info) => sameModelRef(info, card))).toEqual({
        modelId: card.modelId,
        display: card.display,
        provider: card.provider,
        aliases: card.aliases,
        contextWindow: card.contextWindow,
        maxOutputTokens: card.maxOutputTokens,
        inputCostPer1M: card.inputCostPer1M,
        outputCostPer1M: card.outputCostPer1M,
        supportsThinking: card.supportsThinking,
        supportedEfforts: card.supportedEfforts,
        supportsVision: card.supportsVision,
        supportsFastMode: card.supportsFastMode,
      });
    }
  });
});
