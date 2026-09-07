// @summary Resolves Gemini image-generation credentials from Diligent's configured auth store.

import { type AuthKeys, loadAuthStore, loadDiligentConfig } from "@diligent/runtime";
import type { AuthCredentialsStoreMode } from "@diligent/runtime/auth";

export const DEFAULT_GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image";

export interface GeminiImageConfig {
  apiKey: string;
  baseUrl?: string;
  model: string;
}

interface GeminiProviderConfig {
  provider?: {
    auth?: { credentialsStore?: AuthCredentialsStoreMode };
    gemini?: { apiKey?: string; baseUrl?: string };
  };
}

export interface GeminiImageConfigDependencies {
  env: NodeJS.ProcessEnv;
  loadConfig(cwd: string): Promise<GeminiProviderConfig>;
  loadAuth(options: { mode: AuthCredentialsStoreMode }): Promise<AuthKeys>;
}

const defaultDependencies: GeminiImageConfigDependencies = {
  env: process.env,
  loadConfig: async (cwd) => (await loadDiligentConfig(cwd)).config,
  loadAuth: loadAuthStore,
};

export function createResolveGeminiImageConfig(
  dependencies: GeminiImageConfigDependencies = defaultDependencies,
): (cwd: string) => Promise<GeminiImageConfig | undefined> {
  return async (cwd) => {
    const config = await dependencies.loadConfig(cwd);
    const keys = await dependencies.loadAuth({ mode: config.provider?.auth?.credentialsStore ?? "auto" });
    const apiKey =
      keys.gemini?.trim() || config.provider?.gemini?.apiKey?.trim() || dependencies.env.GEMINI_API_KEY?.trim();
    if (!apiKey) return undefined;
    const baseUrl = config.provider?.gemini?.baseUrl;
    return {
      apiKey,
      model: DEFAULT_GEMINI_IMAGE_MODEL,
      ...(baseUrl ? { baseUrl } : {}),
    };
  };
}

export const resolveGeminiImageConfig = createResolveGeminiImageConfig();
