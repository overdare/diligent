// @summary Resolves default, filtered, or catalog-wide provider profiles and credentials

import {
  getDefaultModelRef,
  listModels,
  resolveModel,
  resolveModelSelector,
  supportsThinkingEffort,
} from "@diligent/core/model-registry";
import type { Model, ProviderManager, StreamFunction } from "@diligent/core/provider-contract";
import { createAnthropicStream } from "@diligent/core/providers/anthropic";
import { createGeminiStream } from "@diligent/core/providers/gemini";
import { createOpenAIStream } from "@diligent/core/providers/openai";
import type { EvalCliOptions } from "./cli-options";
import type { ChatGPTEvalAuth } from "./providers/chatgpt-oauth";
import type { EvalProfile, EvalProvider } from "./task";

const EVAL_EFFORT = "medium" as const;

const API_KEY_ENV: Record<Exclude<EvalProvider, "chatgpt">, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
};

export const DEFAULT_PROFILES: readonly EvalProfile[] = [
  { provider: "openai", model: "gpt-6.1-terra", effort: EVAL_EFFORT },
  { provider: "anthropic", model: "claude-sonnet-5", effort: EVAL_EFFORT },
];

/** API-key providers whose whole catalog the capability matrix covers unless a provider is selected. */
export const CAPABILITY_DEFAULT_PROVIDERS: readonly EvalProvider[] = ["openai", "anthropic", "gemini"];

export function resolveSelectedProfiles(options: EvalCliOptions): EvalProfile[] {
  if (options.model) {
    const model = options.provider
      ? resolveModel({ provider: options.provider, modelId: options.model })
      : resolveModelSelector(options.model);
    if (!isEvalProvider(model.provider)) {
      throw new Error(
        `Eval suites support only OpenAI, Anthropic, Gemini, and ChatGPT models, received ${model.provider}.`,
      );
    }
    if (options.provider && options.provider !== model.provider) {
      throw new Error(`Model ${options.model} belongs to ${model.provider}, not ${options.provider}.`);
    }
    validateMediumEffort(model);
    return [{ provider: model.provider, model: model.modelId, effort: EVAL_EFFORT }];
  }

  const selected = options.provider ? [resolveDefaultProfile(options.provider)] : DEFAULT_PROFILES;
  return selected.map((profile) => {
    const model = resolveModel({ provider: profile.provider, modelId: profile.model });
    validateMediumEffort(model);
    return { ...profile };
  });
}

/** Every catalog model of the selected providers, or the one selected model. */
export function resolveCapabilityProfiles(options: EvalCliOptions): EvalProfile[] {
  if (options.model) return resolveSelectedProfiles(options);
  const providers = options.provider ? [options.provider] : CAPABILITY_DEFAULT_PROVIDERS;
  return providers.flatMap((provider) =>
    listModels(provider).map((model) => {
      validateMediumEffort(model);
      return { provider, model: model.modelId, effort: EVAL_EFFORT };
    }),
  );
}

/** Name of the unset API-key variable a provider needs; ChatGPT uses OAuth and never reads one. */
export function missingApiKey(provider: EvalProvider, env: EvalCredentialEnv = process.env): string | undefined {
  if (provider === "chatgpt") return undefined;
  const name = API_KEY_ENV[provider];
  return env[name]?.trim() ? undefined : name;
}

export function validateCredentials(profiles: readonly EvalProfile[], env: EvalCredentialEnv = process.env): void {
  for (const provider of new Set(profiles.map((profile) => profile.provider))) {
    const missing = missingApiKey(provider, env);
    if (missing) throw new Error(`${missing} is required for the selected eval profiles.`);
  }
}

export function createProfileStream(
  profile: EvalProfile,
  env: EvalCredentialEnv = process.env,
  chatgptAuth?: ChatGPTEvalAuth,
): StreamFunction {
  if (profile.provider === "openai") return createOpenAIStream(env.OPENAI_API_KEY);
  if (profile.provider === "anthropic") return createAnthropicStream(env.ANTHROPIC_API_KEY);
  if (profile.provider === "gemini") return createGeminiStream(env.GEMINI_API_KEY);
  if (!chatgptAuth) throw new Error("ChatGPT eval profiles require initialized local OAuth.");
  return chatgptAuth.streamFunction;
}

/**
 * Binds ChatGPT OAuth, and with `apiKeyEnv` also registers the profile's API key so runtime paths that resolve
 * credentials through ProviderManager (native compaction, image generation) behave as in the product.
 */
export function configureProfileProviderManager(
  profile: EvalProfile,
  manager: ProviderManager,
  chatgptAuth?: ChatGPTEvalAuth,
  options: { apiKeyEnv?: EvalCredentialEnv } = {},
): void {
  if (profile.provider !== "chatgpt") {
    const apiKey = options.apiKeyEnv?.[API_KEY_ENV[profile.provider]]?.trim();
    if (apiKey) manager.setApiKey(profile.provider, apiKey);
    return;
  }
  if (!chatgptAuth) throw new Error("ChatGPT eval profiles require initialized local OAuth.");
  chatgptAuth.bindProviderManager(manager);
}

export function resolveProfileModel(profile: EvalProfile): Model {
  const model = resolveModel({ provider: profile.provider, modelId: profile.model });
  if (model.provider !== profile.provider) {
    throw new Error(`Profile provider ${profile.provider} does not match model provider ${model.provider}.`);
  }
  validateMediumEffort(model);
  return model;
}

export function isEvalProvider(value: string): value is EvalProvider {
  return value === "openai" || value === "anthropic" || value === "gemini" || value === "chatgpt";
}

function resolveDefaultProfile(provider: EvalProvider): EvalProfile {
  const configured = DEFAULT_PROFILES.find((profile) => profile.provider === provider);
  if (configured) return { ...configured };
  return { provider, model: getDefaultModelRef(provider).modelId, effort: EVAL_EFFORT };
}

function validateMediumEffort(model: Model): void {
  if (!supportsThinkingEffort(model, EVAL_EFFORT)) {
    throw new Error(`Model ${model.provider}/${model.modelId} does not support effort ${EVAL_EFFORT}.`);
  }
}

interface EvalCredentialEnv {
  [key: string]: string | undefined;
}
