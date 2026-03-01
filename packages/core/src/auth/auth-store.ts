// @summary Loads and saves API keys from auth.json
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";

export type ProviderName = "anthropic" | "openai" | "gemini";
export type AuthKeys = Partial<Record<ProviderName, string>>;

const AuthKeysSchema = z
  .object({
    anthropic: z.string().optional(),
    openai: z.string().optional(),
    gemini: z.string().optional(),
  })
  .strict();

/** Default path: ~/.config/diligent/auth.json */
export function getAuthFilePath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? homedir();
  return join(home, ".config", "diligent", "auth.json");
}

/** Load auth keys from auth.json. Returns {} if file missing or invalid. */
export async function loadAuthStore(path?: string): Promise<AuthKeys> {
  const filePath = path ?? getAuthFilePath();
  try {
    const file = Bun.file(filePath);
    if (!(await file.exists())) return {};
    const text = await file.text();
    const parsed = JSON.parse(text);
    const result = AuthKeysSchema.safeParse(parsed);
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
