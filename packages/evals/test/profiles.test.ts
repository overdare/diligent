// @summary Tests default and catalog-wide profile selection, credential validation, and provider binding

import { describe, expect, test } from "bun:test";
import { getDefaultModelRef, listModels } from "@diligent/core/model-registry";
import { ProviderManager } from "@diligent/core/provider-contract";
import type { EvalCliOptions } from "../src/cli-options";
import {
  CAPABILITY_DEFAULT_PROVIDERS,
  configureProfileProviderManager,
  createProfileStream,
  DEFAULT_PROFILES,
  isEvalProvider,
  missingApiKey,
  resolveCapabilityProfiles,
  resolveSelectedProfiles,
  validateCredentials,
} from "../src/profiles";
import type { ChatGPTEvalAuth } from "../src/providers/chatgpt-oauth";

const BASE_OPTIONS: EvalCliOptions = { command: "core", help: false };

describe("eval profiles", () => {
  test("default mode returns both profiles", () => {
    expect(resolveSelectedProfiles(BASE_OPTIONS)).toEqual([...DEFAULT_PROFILES]);
    expect(DEFAULT_PROFILES.map((profile) => profile.provider)).toEqual(["openai", "anthropic"]);
  });

  test("a provider filter selects one default provider profile", () => {
    expect(resolveSelectedProfiles({ ...BASE_OPTIONS, provider: "anthropic" })).toEqual([
      { provider: "anthropic", model: "claude-sonnet-5", effort: "medium" },
    ]);
  });

  test("a model override still uses medium effort", () => {
    expect(resolveSelectedProfiles({ ...BASE_OPTIONS, model: "claude-sonnet-5" })).toEqual([
      { provider: "anthropic", model: "claude-sonnet-5", effort: "medium" },
    ]);
  });

  test("an explicit Gemini filter selects the centrally configured Gemini default", () => {
    const defaultModel = getDefaultModelRef("gemini").modelId;
    expect(resolveSelectedProfiles({ ...BASE_OPTIONS, provider: "gemini" })).toEqual([
      { provider: "gemini", model: defaultModel, effort: "medium" },
    ]);
  });

  test("an explicit Gemini model override is supported", () => {
    expect(resolveSelectedProfiles({ ...BASE_OPTIONS, model: "gemini-3.5-flash-lite" })).toEqual([
      { provider: "gemini", model: "gemini-3.5-flash-lite", effort: "medium" },
    ]);
    expect(isEvalProvider("gemini")).toBe(true);
  });

  test("an explicit ChatGPT filter selects the configured ChatGPT default", () => {
    expect(resolveSelectedProfiles({ ...BASE_OPTIONS, provider: "chatgpt" })).toEqual([
      { provider: "chatgpt", model: getDefaultModelRef("chatgpt").modelId, effort: "medium" },
    ]);
    expect(isEvalProvider("chatgpt")).toBe(true);
  });

  test("an explicit ChatGPT model override remains a ChatGPT profile", () => {
    expect(resolveSelectedProfiles({ ...BASE_OPTIONS, provider: "chatgpt", model: "gpt-6-astra" })).toEqual([
      { provider: "chatgpt", model: "gpt-6-astra", effort: "medium" },
    ]);
  });

  test("fails before execution when a selected credential is missing", () => {
    expect(() => validateCredentials(DEFAULT_PROFILES, { ANTHROPIC_API_KEY: "anthropic", OPENAI_API_KEY: "" })).toThrow(
      "OPENAI_API_KEY is required",
    );
  });

  test("a filtered profile requires only its own credential", () => {
    expect(() =>
      validateCredentials([{ provider: "anthropic", model: "claude-sonnet-5", effort: "medium" }], {
        ANTHROPIC_API_KEY: "anthropic",
      }),
    ).not.toThrow();
  });

  test("a Gemini profile requires only GEMINI_API_KEY", () => {
    const profiles = resolveSelectedProfiles({ ...BASE_OPTIONS, provider: "gemini" });
    expect(() => validateCredentials(profiles, { GEMINI_API_KEY: "gemini" })).not.toThrow();
    expect(() => validateCredentials(profiles, { GEMINI_API_KEY: " " })).toThrow("GEMINI_API_KEY is required");
  });

  test("a ChatGPT profile uses OAuth instead of an environment API key", () => {
    const profiles = resolveSelectedProfiles({ ...BASE_OPTIONS, provider: "chatgpt" });
    expect(() => validateCredentials(profiles, {})).not.toThrow();
  });

  test("routes ChatGPT streams and native compaction through the prepared OAuth binding", () => {
    const stream = (() => {
      throw new Error("not invoked");
    }) as ChatGPTEvalAuth["streamFunction"];
    const auth = {
      streamFunction: stream,
      bindProviderManager: (manager: ProviderManager) => manager.setApiKey("openai", "bound"),
      redactionSecrets: () => [],
    } as unknown as ChatGPTEvalAuth;
    const profile = { provider: "chatgpt", model: "gpt-6-astra", effort: "medium" } as const;

    expect(createProfileStream(profile, {}, auth)).toBe(stream);
    const manager = new ProviderManager({});
    configureProfileProviderManager(profile, manager, auth);
    expect(manager.getApiKey("openai")).toBe("bound");
  });

  test("the capability matrix covers every catalog model of the API-key providers by default", () => {
    const profiles = resolveCapabilityProfiles({ command: "runtime", models: "catalog", help: false });
    const expected = CAPABILITY_DEFAULT_PROVIDERS.flatMap((provider) =>
      listModels(provider).map((model) => `${provider}/${model.modelId}`),
    );
    expect(profiles.map((profile) => `${profile.provider}/${profile.model}`)).toEqual(expected);
    expect(profiles.some((profile) => profile.provider === "chatgpt")).toBe(false);
  });

  test("a capability provider filter selects that provider's whole catalog", () => {
    const profiles = resolveCapabilityProfiles({
      command: "runtime",
      models: "catalog",
      provider: "chatgpt",
      help: false,
    });
    expect(profiles.map((profile) => profile.model)).toEqual(listModels("chatgpt").map((model) => model.modelId));
  });

  test("capability runs report missing API keys per provider and never need one for ChatGPT", () => {
    expect(missingApiKey("anthropic", { OPENAI_API_KEY: "openai" })).toBe("ANTHROPIC_API_KEY");
    expect(missingApiKey("openai", { OPENAI_API_KEY: "openai" })).toBeUndefined();
    expect(missingApiKey("chatgpt", {})).toBeUndefined();
  });

  test("binds the profile API key into ProviderManager for product-equivalent runtime paths", () => {
    const manager = new ProviderManager({});
    configureProfileProviderManager(
      { provider: "anthropic", model: "claude-sonnet-5", effort: "medium" },
      manager,
      undefined,
      {
        apiKeyEnv: { ANTHROPIC_API_KEY: "anthropic-key", OPENAI_API_KEY: "openai-key" },
      },
    );
    expect(manager.getConfiguredProviders()).toEqual(["anthropic"]);
  });

  test("a ChatGPT profile never falls back to an available OpenAI API key", () => {
    const auth = { bindProviderManager: () => {} } as unknown as ChatGPTEvalAuth;
    const manager = new ProviderManager({});
    configureProfileProviderManager({ provider: "chatgpt", model: "gpt-6-astra", effort: "medium" }, manager, auth, {
      apiKeyEnv: { OPENAI_API_KEY: "openai-key" },
    });
    expect(manager.getApiKey("openai")).toBeUndefined();
    expect(manager.getApiKey("chatgpt")).toBeUndefined();
  });
});
