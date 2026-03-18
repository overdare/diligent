// @summary Tests for model resolution inference logic and model class system
import { describe, expect, it } from "bun:test";
import {
  agentTypeToModelClass,
  getModelClass,
  KNOWN_MODELS,
  resolveModel,
  resolveModelForClass,
} from "../../../src/llm/models";
import type { Model } from "../../../src/llm/types";

describe("resolveModel", () => {
  it("infers anthropic from claude- prefix", () => {
    const model = resolveModel("claude-opus-4-20250514");
    expect(model.provider).toBe("anthropic");
    expect(model.contextWindow).toBe(200_000);
  });

  it("infers openai from gpt- prefix", () => {
    const model = resolveModel("gpt-5-turbo");
    expect(model.provider).toBe("openai");
    expect(model.contextWindow).toBe(128_000);
  });

  it("infers openai from o-series prefix", () => {
    expect(resolveModel("o1-preview").provider).toBe("openai");
    expect(resolveModel("o3-mini").provider).toBe("openai");
    expect(resolveModel("o4-mini").provider).toBe("openai");
  });

  it("defaults unknown model to anthropic", () => {
    const model = resolveModel("unknown-model");
    expect(model.provider).toBe("anthropic");
  });

  it("infers chatgpt from chatgpt- prefix", () => {
    const model = resolveModel("chatgpt-5.3-codex");
    expect(model.provider).toBe("chatgpt");
  });
});

describe("model class annotations", () => {
  it("annotates vision support for Anthropic and OpenAI only", () => {
    for (const model of KNOWN_MODELS) {
      if (model.provider === "anthropic" || model.provider === "openai" || model.provider === "chatgpt") {
        expect(model.supportsVision).toBe(true);
      } else {
        expect(model.supportsVision).not.toBe(true);
      }
    }
  });

  it("every known model has a modelClass", () => {
    for (const model of KNOWN_MODELS) {
      expect(model.modelClass).toBeDefined();
      expect(["pro", "general", "lite"]).toContain(model.modelClass);
    }
  });

  it("each provider has at least one model per class", () => {
    for (const provider of ["anthropic", "openai", "chatgpt", "gemini"]) {
      for (const cls of ["pro", "general", "lite"] as const) {
        const match = KNOWN_MODELS.find((m) => m.provider === provider && m.modelClass === cls);
        expect(match).toBeDefined();
      }
    }
  });

  it("anthropic classes map correctly", () => {
    expect(KNOWN_MODELS.find((m) => m.id === "claude-opus-4-6")?.modelClass).toBe("pro");
    expect(KNOWN_MODELS.find((m) => m.id === "claude-sonnet-4-6")?.modelClass).toBe("general");
    expect(KNOWN_MODELS.find((m) => m.id === "claude-haiku-4-5")?.modelClass).toBe("lite");
  });

  it("openai classes map correctly", () => {
    expect(KNOWN_MODELS.find((m) => m.id === "gpt-5.4")?.modelClass).toBe("pro");
    expect(KNOWN_MODELS.find((m) => m.id === "gpt-5.3-codex")?.modelClass).toBe("general");
    expect(KNOWN_MODELS.find((m) => m.id === "gpt-5.4-mini")?.modelClass).toBe("lite");
  });

  it("gemini classes map correctly", () => {
    expect(KNOWN_MODELS.find((m) => m.id === "gemini-2.5-pro")?.modelClass).toBe("pro");
    expect(KNOWN_MODELS.find((m) => m.id === "gemini-2.5-flash")?.modelClass).toBe("general");
    expect(KNOWN_MODELS.find((m) => m.id === "gemini-2.5-flash-lite")?.modelClass).toBe("lite");
  });

  it("chatgpt classes map correctly", () => {
    expect(KNOWN_MODELS.find((m) => m.id === "chatgpt-5.4")?.modelClass).toBe("pro");
    expect(KNOWN_MODELS.find((m) => m.id === "chatgpt-5.3-codex")?.modelClass).toBe("general");
    expect(KNOWN_MODELS.find((m) => m.id === "chatgpt-5.4-mini")?.modelClass).toBe("lite");
  });
});

describe("getModelClass", () => {
  it("returns modelClass for known models", () => {
    const sonnet = resolveModel("claude-sonnet-4-6");
    expect(getModelClass(sonnet)).toBe("general");

    const opus = resolveModel("claude-opus-4-6");
    expect(getModelClass(opus)).toBe("pro");

    const haiku = resolveModel("claude-haiku-4-5");
    expect(getModelClass(haiku)).toBe("lite");
  });

  it("defaults to 'general' for unknown models", () => {
    const unknown: Model = {
      id: "unknown-model",
      provider: "anthropic",
      contextWindow: 200_000,
      maxOutputTokens: 4096,
    };
    expect(getModelClass(unknown)).toBe("general");
  });
});

describe("resolveModelForClass", () => {
  it("returns same model if already matching class", () => {
    const sonnet = resolveModel("claude-sonnet-4-6");
    const result = resolveModelForClass(sonnet, "general");
    expect(result.id).toBe("claude-sonnet-4-6");
  });

  it("resolves anthropic pro → opus", () => {
    const sonnet = resolveModel("claude-sonnet-4-6");
    const pro = resolveModelForClass(sonnet, "pro");
    expect(pro.id).toBe("claude-opus-4-6");
    expect(pro.provider).toBe("anthropic");
  });

  it("resolves anthropic lite → haiku", () => {
    const sonnet = resolveModel("claude-sonnet-4-6");
    const lite = resolveModelForClass(sonnet, "lite");
    expect(lite.id).toBe("claude-haiku-4-5");
    expect(lite.provider).toBe("anthropic");
  });

  it("resolves openai general → lite", () => {
    const codex = resolveModel("gpt-5.3-codex");
    const lite = resolveModelForClass(codex, "lite");
    expect(lite.id).toBe("gpt-5.4-mini");
    expect(lite.provider).toBe("openai");
  });

  it("resolves gemini general → pro", () => {
    const flash = resolveModel("gemini-2.5-flash");
    const pro = resolveModelForClass(flash, "pro");
    expect(pro.id).toBe("gemini-2.5-pro");
    expect(pro.provider).toBe("gemini");
  });

  it("resolves gemini general → lite", () => {
    const flash = resolveModel("gemini-2.5-flash");
    const lite = resolveModelForClass(flash, "lite");
    expect(lite.id).toBe("gemini-2.5-flash-lite");
    expect(lite.provider).toBe("gemini");
  });

  it("resolves chatgpt general → lite", () => {
    const codex = resolveModel("chatgpt-5.3-codex");
    const lite = resolveModelForClass(codex, "lite");
    expect(lite.id).toBe("chatgpt-5.4-mini");
    expect(lite.provider).toBe("chatgpt");
  });

  it("falls back to current model for unknown provider", () => {
    const custom: Model = { id: "custom-model", provider: "custom", contextWindow: 100_000, maxOutputTokens: 4096 };
    const result = resolveModelForClass(custom, "pro");
    expect(result.id).toBe("custom-model");
  });

  it("stays within the same provider", () => {
    const sonnet = resolveModel("claude-sonnet-4-6");
    const pro = resolveModelForClass(sonnet, "pro");
    expect(pro.provider).toBe("anthropic");
    // Should never cross providers
    expect(pro.provider).not.toBe("openai");
    expect(pro.provider).not.toBe("gemini");
  });
});

describe("agentTypeToModelClass", () => {
  it("maps explore → lite", () => {
    const sonnet = resolveModel("claude-sonnet-4-6");
    expect(agentTypeToModelClass("explore", sonnet)).toBe("lite");
  });

  it("maps general → same class as parent (general)", () => {
    const sonnet = resolveModel("claude-sonnet-4-6");
    expect(agentTypeToModelClass("general", sonnet)).toBe("general");
  });

  it("maps general → same class as parent (pro)", () => {
    const opus = resolveModel("claude-opus-4-6");
    expect(agentTypeToModelClass("general", opus)).toBe("pro");
  });

  it("maps general → same class as parent (lite)", () => {
    const haiku = resolveModel("claude-haiku-4-5");
    expect(agentTypeToModelClass("general", haiku)).toBe("lite");
  });

  it("maps unknown agent type → general (same as parent default)", () => {
    const sonnet = resolveModel("claude-sonnet-4-6");
    expect(agentTypeToModelClass("unknown_type", sonnet)).toBe("general");
  });
});
