// @summary PKCE code verifier and challenge generation for OAuth 2.0
import { createHash, randomBytes } from "node:crypto";

export interface PKCEPair {
  codeVerifier: string;
  codeChallenge: string;
}

/** Generate a PKCE code verifier (32 random bytes → base64url, no padding) */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

/** Generate SHA-256 code challenge from verifier */
export function generateCodeChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

/** Generate a full PKCE pair */
export function generatePKCE(): PKCEPair {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  return { codeVerifier, codeChallenge };
}
