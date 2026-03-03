// @summary Unified provider manager — API key/OAuth token lifecycle, proxy stream dispatch

import { saveOAuthTokens } from "../auth/auth-store";
import { refreshOAuthTokens, shouldRefresh } from "../auth/oauth/refresh";
import type { OpenAIOAuthTokens } from "../auth/types";
import type { DiligentConfig } from "../config/schema";
import { createAnthropicStream } from "./anthropic";
import { createChatGPTStream } from "./chatgpt";
import { createGeminiStream } from "./gemini";
import { createOpenAIStream } from "./openai";
import type { ProviderName } from "@diligent/protocol";
import type { StreamFunction } from "./types";

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
  private keys: Partial<Record<ProviderName, string>> = {};
  private baseUrls: Partial<Record<ProviderName, string>> = {};
  private cache = new Map<string, StreamFunction>();
  private oauthTokens: OpenAIOAuthTokens | undefined = undefined;
  private chatgptStream: StreamFunction | undefined = undefined;
  private refreshLock: Promise<void> | undefined = undefined;

  constructor(config: DiligentConfig) {
    // Only read baseUrls from config — API keys come exclusively from auth.json
    this.baseUrls.anthropic = config.provider?.anthropic?.baseUrl;
    this.baseUrls.openai = config.provider?.openai?.baseUrl;
    this.baseUrls.gemini = config.provider?.gemini?.baseUrl;
  }

  /**
   * Store ChatGPT OAuth tokens and create the dedicated ChatGPT stream.
   * The stream uses access_token directly (no sk-... key needed).
   */
  setOAuthTokens(tokens: OpenAIOAuthTokens): void {
    this.oauthTokens = tokens;
    // Create ChatGPT stream — getTokens() always returns latest (post-refresh) tokens
    this.chatgptStream = createChatGPTStream(() => this.oauthTokens!);
    // Mark openai as "configured" for hasKeyFor() checks (value is cosmetic)
    this.keys.openai = "chatgpt-oauth";
  }

  /** Whether OpenAI is authenticated via ChatGPT OAuth */
  hasOAuthFor(_provider: "openai"): boolean {
    return this.oauthTokens !== undefined;
  }

  /** Return OAuth tokens (for save prompt) */
  getOAuthTokens(): OpenAIOAuthTokens | undefined {
    return this.oauthTokens;
  }

  /**
   * Ensure OAuth tokens are fresh. Awaitable for blocking refresh (e.g., at startup).
   * Safe to call concurrently — uses a lock to prevent double-refresh.
   */
  async ensureOAuthFresh(): Promise<void> {
    if (!this.oauthTokens || !shouldRefresh(this.oauthTokens)) return;

    if (!this.refreshLock) {
      this.refreshLock = (async () => {
        try {
          const newTokens = await refreshOAuthTokens(this.oauthTokens!);
          this.oauthTokens = newTokens;
          // chatgptStream's getTokens() closure already reads this.oauthTokens — no rebuild needed
          await saveOAuthTokens(newTokens).catch(() => {});
        } finally {
          this.refreshLock = undefined;
        }
      })();
    }
    await this.refreshLock;
  }

  /** Create a proxy StreamFunction that dispatches based on model.provider */
  createProxyStream(): StreamFunction {
    return (model, context, options) => {
      const provider = (model.provider ?? DEFAULT_PROVIDER) as ProviderName;

      // ChatGPT OAuth path: use dedicated stream (token refreshed via closure)
      if (provider === "openai" && this.chatgptStream) {
        // Trigger background refresh if tokens are near expiry (non-blocking)
        this.ensureOAuthFresh().catch(() => {});
        return this.chatgptStream(model, context, options);
      }

      // API Key path: dispatch via key
      const apiKey = this.keys[provider];
      if (!apiKey) {
        throw new Error(`No API key configured for ${provider}. Use /provider ${provider} to configure.`);
      }

      return this.getOrCreateStream(provider, apiKey)(model, context, options);
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
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${provider}:`)) this.cache.delete(key);
    }
    this.keys[provider] = apiKey;
  }

  /** Remove an API key for a provider, invalidating cached streams */
  removeApiKey(provider: ProviderName): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${provider}:`)) this.cache.delete(key);
    }
    delete this.keys[provider];
  }

  /** Remove OAuth tokens and the associated ChatGPT stream */
  removeOAuthTokens(): void {
    this.oauthTokens = undefined;
    this.chatgptStream = undefined;
    // Only remove the synthetic key if it was set by OAuth
    if (this.keys.openai === "chatgpt-oauth") {
      delete this.keys.openai;
    }
  }

  /** Get list of providers that have API keys configured */
  getConfiguredProviders(): ProviderName[] {
    return PROVIDER_NAMES.filter((p) => this.hasKeyFor(p));
  }

  /** Get a masked version of the API key for display (first 7 chars) */
  getMaskedKey(provider: ProviderName): string | undefined {
    const key = this.keys[provider];
    if (!key) return undefined;
    if (provider === "openai" && this.oauthTokens) return "ChatGPT OAuth";
    return key.length > 7 ? `${key.slice(0, 7)}...` : key;
  }

  private getOrCreateStream(provider: ProviderName, apiKey: string): StreamFunction {
    const cacheKey = `${provider}:${apiKey}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    let stream: StreamFunction;
    if (provider === "openai") {
      stream = createOpenAIStream(apiKey, this.baseUrls.openai);
    } else if (provider === "gemini") {
      stream = createGeminiStream(apiKey, this.baseUrls.gemini);
    } else {
      stream = createAnthropicStream(apiKey);
    }

    this.cache.set(cacheKey, stream);
    return stream;
  }
}
