// @summary Tests for provider manager configuration and model handling
import { describe, expect, test } from "bun:test";
import { DEFAULT_MODELS, PROVIDER_NAMES, ProviderManager } from "../src/provider-manager";

describe("ProviderManager", () => {
  test("config does not provide API keys (auth-only)", () => {
    const pm = new ProviderManager({
      provider: { anthropic: { apiKey: "sk-ant-test" } },
    });
    // apiKey in config is ignored — keys come from auth.json via setApiKey
    expect(pm.hasKeyFor("anthropic")).toBe(false);
  });

  test("hasKeyFor returns false when no key", () => {
    const pm = new ProviderManager({});
    expect(pm.hasKeyFor("anthropic")).toBe(false);
    expect(pm.hasKeyFor("openai")).toBe(false);
  });

  test("setApiKey updates the key and invalidates cache", () => {
    const pm = new ProviderManager({});
    expect(pm.hasKeyFor("anthropic")).toBe(false);

    pm.setApiKey("anthropic", "sk-new-key");
    expect(pm.hasKeyFor("anthropic")).toBe(true);
    expect(pm.getApiKey("anthropic")).toBe("sk-new-key");
  });

  test("getConfiguredProviders returns only providers with keys", () => {
    const pm = new ProviderManager({});
    expect(pm.getConfiguredProviders()).toEqual([]);

    pm.setApiKey("anthropic", "sk-test");
    expect(pm.getConfiguredProviders()).toEqual(["anthropic"]);

    pm.setApiKey("openai", "sk-openai");
    expect(pm.getConfiguredProviders()).toEqual(["anthropic", "openai"]);
  });

  test("getMaskedKey returns first 7 chars", () => {
    const pm = new ProviderManager({});
    pm.setApiKey("anthropic", "sk-ant-1234567890");
    expect(pm.getMaskedKey("anthropic")).toBe("sk-ant-...");
  });

  test("getMaskedKey returns undefined when no key", () => {
    const pm = new ProviderManager({});
    expect(pm.getMaskedKey("anthropic")).toBeUndefined();
  });

  test("createProxyStream returns a function", () => {
    const pm = new ProviderManager({});
    pm.setApiKey("anthropic", "sk-test");
    const stream = pm.createProxyStream();
    expect(typeof stream).toBe("function");
  });

  test("proxy stream throws when no key for provider", () => {
    const pm = new ProviderManager({});
    const proxy = pm.createProxyStream();
    expect(() => {
      proxy(
        { id: "claude-sonnet-4-6", provider: "anthropic", contextWindow: 200_000, maxOutputTokens: 16384 },
        { systemPrompt: [], messages: [], tools: [] },
        {},
      );
    }).toThrow(/No API key configured for anthropic/);
  });

  test("PROVIDER_NAMES constant contains all providers", () => {
    expect(PROVIDER_NAMES).toEqual(["anthropic", "openai", "gemini"]);
  });

  test("DEFAULT_MODELS has entries for all providers", () => {
    for (const provider of PROVIDER_NAMES) {
      expect(DEFAULT_MODELS[provider]).toBeDefined();
    }
  });

  test("setApiKey allows subsequent proxy calls", () => {
    const pm = new ProviderManager({});
    expect(pm.hasKeyFor("openai")).toBe(false);

    pm.setApiKey("openai", "sk-openai-new");
    expect(pm.hasKeyFor("openai")).toBe(true);
    expect(pm.getApiKey("openai")).toBe("sk-openai-new");
  });

  test("empty string key is treated as no key", () => {
    const pm = new ProviderManager({});
    pm.setApiKey("anthropic", "");
    expect(pm.hasKeyFor("anthropic")).toBe(false);
  });
});
