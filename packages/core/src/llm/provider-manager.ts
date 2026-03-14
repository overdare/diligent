// @summary Unified provider manager — API key/OAuth token lifecycle, proxy stream dispatch
import { refreshOAuthTokens, shouldRefresh } from "../auth/oauth/refresh";
import type { OpenAIOAuthTokens } from "../auth/types";
import { createAnthropicNativeCompaction, createAnthropicStream } from "./provider/anthropic";
import { createChatGPTNativeCompaction, createChatGPTStream } from "./provider/chatgpt";
import { createGeminiStream } from "./provider/gemini";
import type { NativeCompactionLookup } from "./provider/native-compaction";
import { createOpenAINativeCompaction, createOpenAIStream } from "./provider/openai";
import type { ProviderName, StreamFunction } from "./types";

export interface ProviderManagerConfig {
  provider?: {
    anthropic?: { baseUrl?: string };
    openai?: { baseUrl?: string };
    gemini?: { baseUrl?: string };
  };
  onOAuthTokensRefreshed?: (tokens: OpenAIOAuthTokens) => Promise<void>;
}

export type { ProviderName };

export const DEFAULT_PROVIDER: ProviderName = "anthropic";

export const PROVIDER_NAMES: ProviderName[] = ["anthropic", "openai", "gemini"];

export const DEFAULT_MODELS: Record<ProviderName, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-5.3-codex",
  gemini: "gemini-2.5-flash",
};

export const PROVIDER_HINTS: Record<ProviderName, { apiKeyUrl: string; apiKeyPlaceholder: string }> = {
  anthropic: { apiKeyUrl: "https://console.anthropic.com/settings/keys", apiKeyPlaceholder: "sk-ant-..." },
  openai: { apiKeyUrl: "https://platform.openai.com/api-keys", apiKeyPlaceholder: "sk-..." },
  gemini: { apiKeyUrl: "https://aistudio.google.com/apikey", apiKeyPlaceholder: "AIza..." },
};

const PROVIDER_FACTORIES: Record<ProviderName, (key: string, baseUrl?: string) => StreamFunction> = {
  anthropic: createAnthropicStream,
  openai: createOpenAIStream,
  gemini: createGeminiStream,
};

class StreamFactoryCache {
  private cache = new Map<string, StreamFunction>();

  getOrCreate(provider: ProviderName, apiKey: string, baseUrl?: string): StreamFunction {
    const cacheKey = `${provider}:${apiKey}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const factory = PROVIDER_FACTORIES[provider];
    if (!factory) throw new Error(`Unknown provider: ${provider}`);
    const stream = factory(apiKey, baseUrl);
    this.cache.set(cacheKey, stream);
    return stream;
  }

  invalidateProvider(provider: ProviderName): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${provider}:`)) this.cache.delete(key);
    }
  }
}

class AuthStateManager {
  constructor(private onOAuthTokensRefreshed?: (tokens: OpenAIOAuthTokens) => Promise<void>) {}

  private keys: Partial<Record<ProviderName, string>> = {};
  private oauthTokens: OpenAIOAuthTokens | undefined = undefined;
  private chatgptStream: StreamFunction | undefined = undefined;
  private refreshLock: Promise<void> | undefined = undefined;

  setOAuthTokens(tokens: OpenAIOAuthTokens): void {
    this.oauthTokens = tokens;
    this.chatgptStream = createChatGPTStream(() => this.oauthTokens!);
    this.keys.openai = "chatgpt-oauth";
  }

  removeOAuthTokens(): void {
    this.oauthTokens = undefined;
    this.chatgptStream = undefined;
    if (this.keys.openai === "chatgpt-oauth") {
      delete this.keys.openai;
    }
  }

  hasOAuthFor(_provider: "openai"): boolean {
    return this.oauthTokens !== undefined;
  }

  getOAuthTokens(): OpenAIOAuthTokens | undefined {
    return this.oauthTokens;
  }

  getChatGPTStream(): StreamFunction | undefined {
    return this.chatgptStream;
  }

  async ensureOAuthFresh(): Promise<void> {
    if (!this.oauthTokens || !shouldRefresh(this.oauthTokens)) return;

    if (!this.refreshLock) {
      this.refreshLock = (async () => {
        try {
          const newTokens = await refreshOAuthTokens(this.oauthTokens!);
          this.oauthTokens = newTokens;
          await this.onOAuthTokensRefreshed?.(newTokens).catch(() => {});
        } finally {
          this.refreshLock = undefined;
        }
      })();
    }
    await this.refreshLock;
  }

  setApiKey(provider: ProviderName, apiKey: string): void {
    this.keys[provider] = apiKey;
  }

  removeApiKey(provider: ProviderName): void {
    delete this.keys[provider];
  }

  hasKeyFor(provider: ProviderName): boolean {
    const key = this.keys[provider];
    return key !== undefined && key !== "";
  }

  getApiKey(provider: ProviderName): string | undefined {
    return this.keys[provider];
  }

  getConfiguredProviders(): ProviderName[] {
    return PROVIDER_NAMES.filter((p) => this.hasKeyFor(p));
  }

  getMaskedKey(provider: ProviderName): string | undefined {
    const key = this.keys[provider];
    if (!key) return undefined;
    if (provider === "openai" && this.oauthTokens) return "ChatGPT OAuth";
    return key.length > 7 ? `${key.slice(0, 7)}...` : key;
  }
}

function createCompactionRegistry(
  authState: AuthStateManager,
  baseUrls: Partial<Record<ProviderName, string>>,
): NativeCompactionLookup {
  // Live lookup: reads current auth state on each call so key/token changes are reflected.
  return (provider) => {
    if (provider === "openai" && authState.getChatGPTStream()) {
      return createChatGPTNativeCompaction(() => authState.getOAuthTokens()!);
    }
    const key = authState.getApiKey(provider as ProviderName);
    if (!key) return undefined;
    if (provider === "anthropic") return createAnthropicNativeCompaction(key, baseUrls.anthropic);
    if (provider === "openai") return createOpenAINativeCompaction(key, baseUrls.openai);
    return undefined;
  };
}

/** Create a StreamFunction for a given provider and API key. */
export function createStreamForProvider(provider: string, apiKey: string): StreamFunction {
  const factory = PROVIDER_FACTORIES[provider as ProviderName];
  if (!factory) throw new Error(`Unknown provider: ${provider}`);
  return factory(apiKey);
}

/**
 * Manages provider API keys and creates a proxy StreamFunction
 * that dispatches to the correct provider based on model.provider.
 *
 * OpenAI supports two auth modes (both can be active):
 *   - API Key (sk-...): uses api.openai.com — set via setApiKey("openai", ...)
 *   - ChatGPT OAuth:    uses chatgpt.com/backend-api/codex — set via setOAuthTokens(...)
 *
 * OAuth takes priority when both are set.
 */
export class ProviderManager {
  private baseUrls: Partial<Record<ProviderName, string>> = {};
  private streamCache = new StreamFactoryCache();
  private authState: AuthStateManager;

  constructor(config: ProviderManagerConfig) {
    // Only read baseUrls from config — API keys come exclusively from auth.json
    this.baseUrls.anthropic = config.provider?.anthropic?.baseUrl;
    this.baseUrls.openai = config.provider?.openai?.baseUrl;
    this.baseUrls.gemini = config.provider?.gemini?.baseUrl;
    this.authState = new AuthStateManager(config.onOAuthTokensRefreshed);
  }

  /**
   * Store ChatGPT OAuth tokens and create the dedicated ChatGPT stream.
   * The stream uses access_token directly (no sk-... key needed).
   */
  setOAuthTokens(tokens: OpenAIOAuthTokens): void {
    this.authState.setOAuthTokens(tokens);
  }

  /** Whether OpenAI is authenticated via ChatGPT OAuth */
  hasOAuthFor(_provider: "openai"): boolean {
    return this.authState.hasOAuthFor(_provider);
  }

  /** Return OAuth tokens (for save prompt) */
  getOAuthTokens(): OpenAIOAuthTokens | undefined {
    return this.authState.getOAuthTokens();
  }

  /**
   * Ensure OAuth tokens are fresh. Awaitable for blocking refresh (e.g., at startup).
   * Safe to call concurrently — uses a lock to prevent double-refresh.
   */
  async ensureOAuthFresh(): Promise<void> {
    await this.authState.ensureOAuthFresh();
  }

  /** Create a proxy StreamFunction that dispatches based on model.provider */
  createProxyStream(): StreamFunction {
    return (model, context, options) => {
      const provider = (model.provider ?? DEFAULT_PROVIDER) as ProviderName;

      // ChatGPT OAuth path: use dedicated stream (token refreshed via closure)
      const chatgptStream = this.authState.getChatGPTStream();
      if (provider === "openai" && chatgptStream) {
        // Trigger background refresh if tokens are near expiry (non-blocking)
        this.ensureOAuthFresh().catch(() => {});
        return chatgptStream(model, context, options);
      }

      // API Key path: dispatch via key
      const apiKey = this.authState.getApiKey(provider);
      if (!apiKey) {
        throw new Error(`No API key configured for ${provider}. Use /provider ${provider} to configure.`);
      }

      const stream = this.streamCache.getOrCreate(provider, apiKey, this.baseUrls[provider]);
      return stream(model, context, options);
    };
  }

  createNativeCompactionRegistry(): NativeCompactionLookup {
    return createCompactionRegistry(this.authState, this.baseUrls);
  }

  /** Check if a key is set for the given provider */
  hasKeyFor(provider: ProviderName): boolean {
    return this.authState.hasKeyFor(provider);
  }

  /** Get the API key for a provider (or undefined) */
  getApiKey(provider: ProviderName): string | undefined {
    return this.authState.getApiKey(provider);
  }

  /** Set an API key for a provider, invalidating cached streams */
  setApiKey(provider: ProviderName, apiKey: string): void {
    this.streamCache.invalidateProvider(provider);
    this.authState.setApiKey(provider, apiKey);
  }

  /** Remove an API key for a provider, invalidating cached streams */
  removeApiKey(provider: ProviderName): void {
    this.streamCache.invalidateProvider(provider);
    this.authState.removeApiKey(provider);
  }

  /** Remove OAuth tokens and the associated ChatGPT stream */
  removeOAuthTokens(): void {
    this.authState.removeOAuthTokens();
  }

  /** Get list of providers that have API keys configured */
  getConfiguredProviders(): ProviderName[] {
    return this.authState.getConfiguredProviders();
  }

  /** Get a masked version of the API key for display (first 7 chars) */
  getMaskedKey(provider: ProviderName): string | undefined {
    return this.authState.getMaskedKey(provider);
  }
}
