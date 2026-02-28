import type { DiligentConfig, StreamFunction } from "@diligent/core";
import { createAnthropicStream, createOpenAIStream } from "@diligent/core";

export type ProviderName = "anthropic" | "openai";

export const PROVIDER_NAMES: ProviderName[] = ["anthropic", "openai"];

export const DEFAULT_MODELS: Record<ProviderName, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-5.3-codex",
};

/**
 * Manages provider API keys and creates a proxy StreamFunction
 * that dispatches to the correct provider based on model.provider.
 */
export class ProviderManager {
  private keys: Partial<Record<ProviderName, string>> = {};
  private baseUrls: Partial<Record<ProviderName, string>> = {};
  private cache = new Map<string, StreamFunction>();

  constructor(config: DiligentConfig) {
    // Collect keys from config and env vars
    this.keys.anthropic = config.provider?.anthropic?.apiKey ?? process.env.ANTHROPIC_API_KEY ?? undefined;
    this.keys.openai = config.provider?.openai?.apiKey ?? process.env.OPENAI_API_KEY ?? undefined;

    this.baseUrls.anthropic = config.provider?.anthropic?.baseUrl;
    this.baseUrls.openai = config.provider?.openai?.baseUrl;
  }

  /** Create a proxy StreamFunction that dispatches based on model.provider */
  createProxyStream(): StreamFunction {
    return (model, context, options) => {
      const provider = (model.provider ?? "anthropic") as ProviderName;
      const apiKey = this.keys[provider];
      if (!apiKey) {
        throw new Error(
          `No API key configured for ${provider}. ` +
            `Use /provider set ${provider} to add one, or set ${provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"} environment variable.`,
        );
      }

      const stream = this.getOrCreateStream(provider, apiKey);
      return stream(model, context, options);
    };
  }

  /** Check if a key is set for the given provider */
  hasKeyFor(provider: ProviderName): boolean {
    const key = this.keys[provider];
    return key !== undefined && key !== "";
  }

  /** Get the API key for a provider (or undefined) */
  getApiKey(provider: ProviderName): string | undefined {
    return this.keys[provider];
  }

  /** Set an API key for a provider, invalidating cached streams */
  setApiKey(provider: ProviderName, apiKey: string): void {
    // Invalidate cached streams for this provider
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${provider}:`)) {
        this.cache.delete(key);
      }
    }
    this.keys[provider] = apiKey;
  }

  /** Get list of providers that have API keys configured */
  getConfiguredProviders(): ProviderName[] {
    return PROVIDER_NAMES.filter((p) => this.hasKeyFor(p));
  }

  /** Get a masked version of the API key for display (first 7 chars) */
  getMaskedKey(provider: ProviderName): string | undefined {
    const key = this.keys[provider];
    if (!key) return undefined;
    return key.length > 7 ? `${key.slice(0, 7)}...` : key;
  }

  private getOrCreateStream(provider: ProviderName, apiKey: string): StreamFunction {
    const cacheKey = `${provider}:${apiKey}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    let stream: StreamFunction;
    if (provider === "openai") {
      stream = createOpenAIStream(apiKey, this.baseUrls.openai);
    } else {
      stream = createAnthropicStream(apiKey);
    }

    this.cache.set(cacheKey, stream);
    return stream;
  }
}
