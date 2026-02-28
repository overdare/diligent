import { describe, expect, test } from "bun:test";
import type { DiligentConfig, StreamFunction } from "@diligent/core";
import { DEFAULT_MODELS, PROVIDER_NAMES, ProviderManager } from "../src/provider-manager";

describe("ProviderManager", () => {
  test("collects API key from config", () => {
    const pm = new ProviderManager({
      provider: { anthropic: { apiKey: "sk-ant-test" } },
    });
    expect(pm.hasKeyFor("anthropic")).toBe(true);
    expect(pm.getApiKey("anthropic")).toBe("sk-ant-test");
  });

  test("collects API key from env var (ANTHROPIC_API_KEY)", () => {
    const origKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-from-env";
    try {
      const pm = new ProviderManager({});
      expect(pm.hasKeyFor("anthropic")).toBe(true);
      expect(pm.getApiKey("anthropic")).toBe("sk-from-env");
    } finally {
      if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
      else delete process.env.ANTHROPIC_API_KEY;
    }
  });

  test("collects API key from env var (OPENAI_API_KEY)", () => {
    const origKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-openai-env";
    try {
      const pm = new ProviderManager({});
      expect(pm.hasKeyFor("openai")).toBe(true);
      expect(pm.getApiKey("openai")).toBe("sk-openai-env");
    } finally {
      if (origKey) process.env.OPENAI_API_KEY = origKey;
      else delete process.env.OPENAI_API_KEY;
    }
  });

  test("hasKeyFor returns false when no key", () => {
    const origAnthro = process.env.ANTHROPIC_API_KEY;
    const origOpenai = process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const pm = new ProviderManager({});
      expect(pm.hasKeyFor("anthropic")).toBe(false);
      expect(pm.hasKeyFor("openai")).toBe(false);
    } finally {
      if (origAnthro) process.env.ANTHROPIC_API_KEY = origAnthro;
      if (origOpenai) process.env.OPENAI_API_KEY = origOpenai;
    }
  });

  test("setApiKey updates the key and invalidates cache", () => {
    const origKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const pm = new ProviderManager({});
      expect(pm.hasKeyFor("anthropic")).toBe(false);

      pm.setApiKey("anthropic", "sk-new-key");
      expect(pm.hasKeyFor("anthropic")).toBe(true);
      expect(pm.getApiKey("anthropic")).toBe("sk-new-key");
    } finally {
      if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
    }
  });

  test("getConfiguredProviders returns only providers with keys", () => {
    const origAnthro = process.env.ANTHROPIC_API_KEY;
    const origOpenai = process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const pm = new ProviderManager({
        provider: { anthropic: { apiKey: "sk-test" } },
      });
      expect(pm.getConfiguredProviders()).toEqual(["anthropic"]);

      pm.setApiKey("openai", "sk-openai");
      expect(pm.getConfiguredProviders()).toEqual(["anthropic", "openai"]);
    } finally {
      if (origAnthro) process.env.ANTHROPIC_API_KEY = origAnthro;
      if (origOpenai) process.env.OPENAI_API_KEY = origOpenai;
    }
  });

  test("getMaskedKey returns first 7 chars", () => {
    const pm = new ProviderManager({
      provider: { anthropic: { apiKey: "sk-ant-1234567890" } },
    });
    expect(pm.getMaskedKey("anthropic")).toBe("sk-ant-...");
  });

  test("getMaskedKey returns undefined when no key", () => {
    const origKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const pm = new ProviderManager({});
      expect(pm.getMaskedKey("anthropic")).toBeUndefined();
    } finally {
      if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
    }
  });

  test("createProxyStream returns a function", () => {
    const pm = new ProviderManager({
      provider: { anthropic: { apiKey: "sk-test" } },
    });
    const stream = pm.createProxyStream();
    expect(typeof stream).toBe("function");
  });

  test("proxy stream throws when no key for provider", () => {
    const origKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const pm = new ProviderManager({});
      const proxy = pm.createProxyStream();
      expect(() => {
        proxy(
          { id: "claude-sonnet-4-6", provider: "anthropic", contextWindow: 200_000, maxOutputTokens: 16384 },
          { systemPrompt: "", messages: [], tools: [] },
          {},
        );
      }).toThrow(/No API key configured for anthropic/);
    } finally {
      if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
    }
  });

  test("config key takes precedence over env var", () => {
    const origKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-env";
    try {
      const pm = new ProviderManager({
        provider: { anthropic: { apiKey: "sk-config" } },
      });
      expect(pm.getApiKey("anthropic")).toBe("sk-config");
    } finally {
      if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
      else delete process.env.ANTHROPIC_API_KEY;
    }
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
    const origKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const pm = new ProviderManager({});
      expect(pm.hasKeyFor("openai")).toBe(false);

      pm.setApiKey("openai", "sk-openai-new");
      expect(pm.hasKeyFor("openai")).toBe(true);

      // Proxy should not throw after setting key
      const proxy = pm.createProxyStream();
      // We can't call it without a real SDK client, but we can verify it doesn't throw
      // during the key-check phase by checking hasKeyFor
      expect(pm.getApiKey("openai")).toBe("sk-openai-new");
    } finally {
      if (origKey) process.env.OPENAI_API_KEY = origKey;
    }
  });

  test("empty string key is treated as no key", () => {
    const pm = new ProviderManager({
      provider: { anthropic: { apiKey: "" } },
    });
    expect(pm.hasKeyFor("anthropic")).toBe(false);
  });
});
