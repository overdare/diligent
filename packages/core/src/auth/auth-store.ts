// @summary Loads and saves API keys and OAuth tokens from auth.json
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { OpenAIOAuthTokens } from "./types";

export type ProviderName = "anthropic" | "openai" | "gemini";

export type AuthKeys = {
  anthropic?: string;
  openai?: string;
  gemini?: string;
  openai_oauth?: OpenAIOAuthTokens;
};

const OpenAIOAuthSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  id_token: z.string(),
  expires_at: z.number(),
  account_id: z.string().optional(),
});

const AuthKeysSchema = z
  .object({
    anthropic: z.string().optional(),
    openai: z.string().optional(),
    gemini: z.string().optional(),
    openai_oauth: OpenAIOAuthSchema.optional(),
  })
  .strict();

/** Default path: ~/.config/diligent/auth.json */
export function getAuthFilePath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? homedir();
  return join(home, ".config", "diligent", "auth.json");
}

/** Substitute {env:VAR_NAME} → process.env[VAR_NAME] in string values. */
function substituteEnv(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = typeof v === "string" ? v.replace(/\{env:([^}]+)\}/g, (_, name) => process.env[name] ?? "") : v;
  }
  return result;
}

/** Load auth keys from auth.json. Returns {} if file missing or invalid. */
export async function loadAuthStore(path?: string): Promise<AuthKeys> {
  const filePath = path ?? getAuthFilePath();
  try {
    const file = Bun.file(filePath);
    if (!(await file.exists())) return {};
    const text = await file.text();
    const parsed = JSON.parse(text);
    const substituted = substituteEnv(parsed);
    const result = AuthKeysSchema.safeParse(substituted);
    if (!result.success) {
      console.warn(`auth.json warning: ${filePath}\n${result.error.message}`);
      return {};
    }
    return result.data;
  } catch {
    return {};
  }
}

/** Save a single provider key to auth.json (read-modify-write + chmod 0o600). */
export async function saveAuthKey(provider: ProviderName, apiKey: string, path?: string): Promise<void> {
  const filePath = path ?? getAuthFilePath();

  // Ensure directory exists
  await mkdir(dirname(filePath), { recursive: true });

  // Read existing
  let existing: AuthKeys = {};
  try {
    const file = Bun.file(filePath);
    if (await file.exists()) {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const result = AuthKeysSchema.safeParse(parsed);
      if (result.success) {
        existing = result.data;
      }
    }
  } catch {
    // Start fresh
  }

  // Modify
  existing[provider] = apiKey;

  // Write
  await Bun.write(filePath, `${JSON.stringify(existing, null, 2)}\n`);

  // Set restrictive permissions (owner-only read/write)
  const { chmod } = await import("node:fs/promises");
  await chmod(filePath, 0o600);
}

/** Save OpenAI OAuth tokens to auth.json (read-modify-write + chmod 0o600). */
export async function saveOAuthTokens(tokens: OpenAIOAuthTokens, path?: string): Promise<void> {
  const filePath = path ?? getAuthFilePath();

  // Ensure directory exists
  await mkdir(dirname(filePath), { recursive: true });

  // Read existing
  let existing: AuthKeys = {};
  try {
    const file = Bun.file(filePath);
    if (await file.exists()) {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const result = AuthKeysSchema.safeParse(parsed);
      if (result.success) {
        existing = result.data;
      }
    }
  } catch {
    // Start fresh
  }

  // Modify
  existing.openai_oauth = tokens;

  // Write
  await Bun.write(filePath, `${JSON.stringify(existing, null, 2)}\n`);

  // Set restrictive permissions (owner-only read/write)
  const { chmod } = await import("node:fs/promises");
  await chmod(filePath, 0o600);
}

/** Remove a single provider key from auth.json (read-modify-write + chmod 0o600). */
export async function removeAuthKey(provider: ProviderName, path?: string): Promise<void> {
  const filePath = path ?? getAuthFilePath();

  // Ensure directory exists
  await mkdir(dirname(filePath), { recursive: true });

  // Read existing
  let existing: AuthKeys = {};
  try {
    const file = Bun.file(filePath);
    if (await file.exists()) {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const result = AuthKeysSchema.safeParse(parsed);
      if (result.success) {
        existing = result.data;
      }
    }
  } catch {
    // Start fresh
  }

  // Modify
  delete existing[provider];

  // Write
  await Bun.write(filePath, `${JSON.stringify(existing, null, 2)}\n`);

  // Set restrictive permissions (owner-only read/write)
  const { chmod } = await import("node:fs/promises");
  await chmod(filePath, 0o600);
}

/** Remove OpenAI OAuth tokens from auth.json (read-modify-write + chmod 0o600). */
export async function removeOAuthTokens(path?: string): Promise<void> {
  const filePath = path ?? getAuthFilePath();

  await mkdir(dirname(filePath), { recursive: true });

  let existing: AuthKeys = {};
  try {
    const file = Bun.file(filePath);
    if (await file.exists()) {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const result = AuthKeysSchema.safeParse(parsed);
      if (result.success) {
        existing = result.data;
      }
    }
  } catch {
    // Start fresh
  }

  delete existing.openai_oauth;

  await Bun.write(filePath, `${JSON.stringify(existing, null, 2)}\n`);

  const { chmod } = await import("node:fs/promises");
  await chmod(filePath, 0o600);
}

/** Load OpenAI OAuth tokens from auth.json. Returns undefined if not present. */
export async function loadOAuthTokens(path?: string): Promise<OpenAIOAuthTokens | undefined> {
  const keys = await loadAuthStore(path);
  return keys.openai_oauth;
}
