// @summary Loads and saves API keys and OAuth tokens from ~/.diligent/auth.jsonc
import { chmod, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import { z } from "zod";
import type { ProviderName } from "@diligent/core/llm/types";
import type { OpenAIOAuthTokens } from "@diligent/core/auth";

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

export function getAuthFilePath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? homedir();
  return join(home, ".diligent", "auth.jsonc");
}

function substituteEnv(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] =
      typeof value === "string" ? value.replace(/\{env:([^}]+)\}/g, (_, name) => process.env[name] ?? "") : value;
  }
  return result;
}

async function readValidatedStore(filePath: string, warnOnInvalid: boolean): Promise<AuthKeys> {
  try {
    const file = Bun.file(filePath);
    if (!(await file.exists())) return {};
    const text = await file.text();
    const parsed = parseJsonc(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result = AuthKeysSchema.safeParse(substituteEnv(parsed as Record<string, unknown>));
    if (!result.success) {
      if (warnOnInvalid) {
        console.warn(`auth.jsonc warning: ${filePath}\n${result.error.message}`);
      }
      return {};
    }
    return result.data;
  } catch {
    return {};
  }
}

export async function loadAuthStore(path?: string): Promise<AuthKeys> {
  return readValidatedStore(path ?? getAuthFilePath(), true);
}

async function writeStore(filePath: string, store: AuthKeys): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await Bun.write(filePath, `${JSON.stringify(store, null, 2)}\n`);
  await chmod(filePath, 0o600);
}

export async function saveAuthKey(provider: ProviderName, apiKey: string, path?: string): Promise<void> {
  const filePath = path ?? getAuthFilePath();
  const existing = await readValidatedStore(filePath, false);
  existing[provider] = apiKey;
  await writeStore(filePath, existing);
}

export async function saveOAuthTokens(tokens: OpenAIOAuthTokens, path?: string): Promise<void> {
  const filePath = path ?? getAuthFilePath();
  const existing = await readValidatedStore(filePath, false);
  existing.openai_oauth = tokens;
  await writeStore(filePath, existing);
}

export async function removeAuthKey(provider: ProviderName, path?: string): Promise<void> {
  const filePath = path ?? getAuthFilePath();
  const existing = await readValidatedStore(filePath, false);
  delete existing[provider];
  await writeStore(filePath, existing);
}

export async function removeOAuthTokens(path?: string): Promise<void> {
  const filePath = path ?? getAuthFilePath();
  const existing = await readValidatedStore(filePath, false);
  delete existing.openai_oauth;
  await writeStore(filePath, existing);
}

export async function loadOAuthTokens(path?: string): Promise<OpenAIOAuthTokens | undefined> {
  const keys = await loadAuthStore(path);
  return keys.openai_oauth;
}
