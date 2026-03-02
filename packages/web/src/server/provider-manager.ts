// @summary Provider key/token manager for creating stream functions in Web CLI server
import type { DiligentConfig, OpenAIOAuthTokens, StreamFunction } from "@diligent/core";
import {
  createAnthropicStream,
  createChatGPTStream,
  createGeminiStream,
  createOpenAIStream,
  refreshOAuthTokens,
  saveOAuthTokens,
  shouldRefresh,
} from "@diligent/core";

export type ProviderName = "anthropic" | "openai" | "gemini";

export class ProviderManager {
  private keys: Partial<Record<ProviderName, string>> = {};
  private baseUrls: Partial<Record<ProviderName, string>> = {};
  private cache = new Map<string, StreamFunction>();
  private oauthTokens: OpenAIOAuthTokens | undefined;
  private chatgptStream: StreamFunction | undefined;
  private refreshLock: Promise<void> | undefined;

  constructor(config: DiligentConfig) {
    this.baseUrls.anthropic = config.provider?.anthropic?.baseUrl;
    this.baseUrls.openai = config.provider?.openai?.baseUrl;
    this.baseUrls.gemini = config.provider?.gemini?.baseUrl;
  }

  setOAuthTokens(tokens: OpenAIOAuthTokens): void {
    this.oauthTokens = tokens;
    this.chatgptStream = createChatGPTStream(() => this.oauthTokens as OpenAIOAuthTokens);
    this.keys.openai = "chatgpt-oauth";
  }

  async ensureOAuthFresh(): Promise<void> {
    if (!this.oauthTokens || !shouldRefresh(this.oauthTokens)) return;

    if (!this.refreshLock) {
      this.refreshLock = (async () => {
        try {
          const newTokens = await refreshOAuthTokens(this.oauthTokens as OpenAIOAuthTokens);
          this.oauthTokens = newTokens;
          await saveOAuthTokens(newTokens).catch(() => {});
        } finally {
          this.refreshLock = undefined;
        }
      })();
    }

    await this.refreshLock;
  }

  setApiKey(provider: ProviderName, apiKey: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${provider}:`)) {
        this.cache.delete(key);
      }
    }
    this.keys[provider] = apiKey;
  }

  createProxyStream(): StreamFunction {
    return (model, context, options) => {
      const provider = (model.provider ?? "anthropic") as ProviderName;

      if (provider === "openai" && this.chatgptStream) {
        this.ensureOAuthFresh().catch(() => {});
        return this.chatgptStream(model, context, options);
      }

      const apiKey = this.keys[provider];
      if (!apiKey) {
        throw new Error(`No API key configured for ${provider}.`);
      }

      const cacheKey = `${provider}:${apiKey}`;
      const cached = this.cache.get(cacheKey);
      if (cached) {
        return cached(model, context, options);
      }

      const stream =
        provider === "openai"
          ? createOpenAIStream(apiKey, this.baseUrls.openai)
          : provider === "gemini"
            ? createGeminiStream(apiKey, this.baseUrls.gemini)
            : createAnthropicStream(apiKey);

      this.cache.set(cacheKey, stream);
      return stream(model, context, options);
    };
  }
}
