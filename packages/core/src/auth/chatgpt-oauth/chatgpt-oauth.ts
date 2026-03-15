// @summary ChatGPT OAuth request helpers — build authorize URL and PKCE request state
import { randomBytes } from "node:crypto";
import { generatePKCE } from "./pkce";

export const CHATGPT_AUTH_URL = "https://auth.openai.com/oauth/authorize";
export const CHATGPT_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const CHATGPT_REDIRECT_URI = "http://localhost:1455/auth/callback";
export const CHATGPT_SCOPES = "openid profile email offline_access";

export interface ChatGPTOAuthUrlOptions {
  codeChallenge: string;
  state: string;
  clientId?: string;
  redirectUri?: string;
  scopes?: string;
}

export interface ChatGPTOAuthRequest {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  authUrl: string;
}

export function buildChatGPTOAuthUrl(options: ChatGPTOAuthUrlOptions): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: options.clientId ?? CHATGPT_CLIENT_ID,
    redirect_uri: options.redirectUri ?? CHATGPT_REDIRECT_URI,
    scope: options.scopes ?? CHATGPT_SCOPES,
    code_challenge: options.codeChallenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    originator: "diligent",
    state: options.state,
  });

  return `${CHATGPT_AUTH_URL}?${params}`;
}

export function createChatGPTOAuthRequest(): ChatGPTOAuthRequest {
  const { codeVerifier, codeChallenge } = generatePKCE();
  const state = randomBytes(32).toString("base64url");

  return {
    state,
    codeVerifier,
    codeChallenge,
    authUrl: buildChatGPTOAuthUrl({
      state,
      codeChallenge,
    }),
  };
}
