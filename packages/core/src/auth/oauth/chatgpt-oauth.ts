// @summary ChatGPT subscription OAuth 2.0 PKCE flow — returns OpenAIOAuthTokens
import { randomBytes } from "node:crypto";
import type { OpenAIOAuthTokens } from "../types";
import { openBrowser } from "./browser";
import { waitForCallback } from "./callback-server";
import { CHATGPT_AUTH_URL, CHATGPT_CLIENT_ID, CHATGPT_REDIRECT_URI } from "./constants";
import { generatePKCE } from "./pkce";
import { buildOAuthTokens, exchangeCodeForTokens } from "./token-exchange";

export const CHATGPT_SCOPES = "openid profile email offline_access";

export interface OAuthFlowOptions {
  /** Called when the browser URL is ready (for display in TUI before opening) */
  onUrl?: (url: string) => void;
  /** Timeout in ms (default: 5 minutes) */
  timeoutMs?: number;
}

/**
 * Run the full ChatGPT OAuth flow. Opens browser, waits for callback,
 * exchanges code for OpenAIOAuthTokens (access_token + account_id from JWT).
 */
export async function runChatGPTOAuth(options: OAuthFlowOptions = {}): Promise<OpenAIOAuthTokens> {
  const { codeVerifier, codeChallenge } = generatePKCE();
  const state = randomBytes(16).toString("hex");

  const params = new URLSearchParams({
    response_type: "code",
    client_id: CHATGPT_CLIENT_ID,
    redirect_uri: CHATGPT_REDIRECT_URI,
    scope: CHATGPT_SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    // Required for ChatGPT subscription — ensures org/account info in JWT
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    originator: "diligent",
    state,
  });

  const authUrl = `${CHATGPT_AUTH_URL}?${params}`;
  options.onUrl?.(authUrl);

  openBrowser(authUrl);

  const { code } = await waitForCallback(state, options.timeoutMs);
  const rawTokens = await exchangeCodeForTokens(code, codeVerifier);
  return buildOAuthTokens(rawTokens);
}
