// @summary Auth callbacks factory — provider list/set/remove and ChatGPT OAuth flow
import { randomBytes } from "node:crypto";
import type { ProviderName } from "../provider/provider-manager";
import { PROVIDER_NAMES, type ProviderManager } from "../provider/provider-manager";
import type { ProviderName as AuthProviderName } from "./auth-store";
import {
  loadAuthStore,
  loadOAuthTokens,
  removeAuthKey,
  removeOAuthTokens,
  saveAuthKey,
  saveOAuthTokens,
} from "./auth-store";
import { waitForCallback } from "./oauth/callback-server";
import { CHATGPT_AUTH_URL, CHATGPT_CLIENT_ID, CHATGPT_REDIRECT_URI, CHATGPT_SCOPES } from "./oauth/chatgpt-oauth";
import { generatePKCE } from "./oauth/pkce";
import { buildOAuthTokens, exchangeCodeForTokens } from "./oauth/token-exchange";

export interface ProviderAuthInfo {
  provider: ProviderName;
  configured: boolean;
  maskedKey?: string;
  oauthConnected?: boolean;
}

export interface AuthCallbacks {
  list: () => Promise<ProviderAuthInfo[]>;
  set: (provider: string, apiKey: string) => Promise<void>;
  remove: (provider: string) => Promise<void>;
  oauthStart: () => Promise<{ authUrl: string }>;
  oauthStatus: () => Promise<{ status: string; error?: string }>;
}

export function createAuthCallbacks(providerManager: ProviderManager): AuthCallbacks {
  let oauthFlowStatus: { status: string; error?: string } = { status: "idle" };
  let oauthPending: Promise<void> | null = null;

  return {
    list: async () => {
      const keys = await loadAuthStore();
      const oauthTokens = await loadOAuthTokens();
      return PROVIDER_NAMES.map(
        (p): ProviderAuthInfo => ({
          provider: p,
          configured: Boolean(keys[p]),
          maskedKey: keys[p] ? maskKey(keys[p] as string) : undefined,
          oauthConnected: p === "openai" ? Boolean(oauthTokens) : undefined,
        }),
      );
    },
    set: async (provider, apiKey) => {
      await saveAuthKey(provider as AuthProviderName, apiKey);
      providerManager.setApiKey(provider as ProviderName, apiKey);
    },
    remove: async (provider) => {
      await removeAuthKey(provider as AuthProviderName);
      providerManager.removeApiKey(provider as ProviderName);
      if (provider === "openai") {
        await removeOAuthTokens();
        providerManager.removeOAuthTokens();
      }
    },
    oauthStart: async () => {
      if (oauthPending) {
        throw new Error("OAuth flow already in progress");
      }

      const { codeVerifier, codeChallenge } = generatePKCE();
      const state = randomBytes(16).toString("hex");

      const params = new URLSearchParams({
        response_type: "code",
        client_id: CHATGPT_CLIENT_ID,
        redirect_uri: CHATGPT_REDIRECT_URI,
        scope: CHATGPT_SCOPES,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        id_token_add_organizations: "true",
        codex_cli_simplified_flow: "true",
        originator: "diligent",
        state,
      });

      const authUrl = `${CHATGPT_AUTH_URL}?${params}`;

      oauthFlowStatus = { status: "pending" };
      oauthPending = (async () => {
        try {
          const { code } = await waitForCallback(state, 5 * 60 * 1000);
          const rawTokens = await exchangeCodeForTokens(code, codeVerifier);
          const tokens = buildOAuthTokens(rawTokens);
          await saveOAuthTokens(tokens);
          providerManager.setOAuthTokens(tokens);
          oauthFlowStatus = { status: "completed" };
        } catch (e) {
          oauthFlowStatus = {
            status: "expired",
            error: e instanceof Error ? e.message : "OAuth flow failed",
          };
        } finally {
          oauthPending = null;
        }
      })();

      return { authUrl };
    },
    oauthStatus: async () => {
      return oauthFlowStatus;
    },
  };
}

function maskKey(key: string): string {
  if (key.length <= 11) return "***";
  return `${key.slice(0, 7)}...${key.slice(-4)}`;
}
