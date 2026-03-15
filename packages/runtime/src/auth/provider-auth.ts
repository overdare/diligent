// @summary ChatGPT OAuth provider auth binding for core ProviderManager injection
import type { OpenAIOAuthTokens } from "@diligent/core/auth";
import { refreshOAuthTokens, shouldRefresh } from "@diligent/core/auth/chatgpt-oauth";
import { createChatGPTNativeCompaction, createChatGPTStream } from "@diligent/core/llm/provider/chatgpt";
import type { ExternalProviderAuth } from "@diligent/core/llm/provider-manager";

export interface ChatGPTOAuthBinding {
  auth: ExternalProviderAuth;
  setTokens: (tokens: OpenAIOAuthTokens) => void;
  clearTokens: () => void;
  getTokens: () => OpenAIOAuthTokens | undefined;
}

export function createChatGPTOAuthBinding(args?: {
  initialTokens?: OpenAIOAuthTokens;
  onTokensRefreshed?: (tokens: OpenAIOAuthTokens) => Promise<void>;
}): ChatGPTOAuthBinding {
  let oauthTokens = args?.initialTokens;
  let refreshLock: Promise<void> | undefined;

  const setTokens = (tokens: OpenAIOAuthTokens): void => {
    oauthTokens = tokens;
  };

  const clearTokens = (): void => {
    oauthTokens = undefined;
  };

  const getTokens = (): OpenAIOAuthTokens | undefined => oauthTokens;

  const ensureFresh = async (): Promise<void> => {
    if (!oauthTokens || !shouldRefresh(oauthTokens)) return;

    if (!refreshLock) {
      refreshLock = (async () => {
        try {
          const refreshed = await refreshOAuthTokens(oauthTokens!);
          oauthTokens = refreshed;
          await args?.onTokensRefreshed?.(refreshed).catch(() => {});
        } finally {
          refreshLock = undefined;
        }
      })();
    }

    await refreshLock;
  };

  const auth: ExternalProviderAuth = {
    isConfigured: () => oauthTokens !== undefined,
    getMaskedKey: () => (oauthTokens ? "ChatGPT OAuth" : undefined),
    getStream: () => createChatGPTStream(() => oauthTokens!),
    getNativeCompaction: () => createChatGPTNativeCompaction(() => oauthTokens!),
    ensureFresh,
  };

  return { auth, setTokens, clearTokens, getTokens };
}
