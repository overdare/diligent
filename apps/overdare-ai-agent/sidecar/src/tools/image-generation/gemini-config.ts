// @summary Resolves Gemini image-generation credentials from Diligent's configured auth store.

import { type AuthKeys, type DiligentConfig, loadAuthStore, loadDiligentConfig } from "@diligent/runtime";
import type { AuthCredentialsStoreMode } from "@diligent/runtime/auth";

export const DEFAULT_GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image";

export interface GeminiImageConfig {
  apiKey: string;
  baseUrl?: string;
  model: string;
}

export interface GeminiImageConfigDependencies {
  loadConfig(cwd: string): Promise<Pick<DiligentConfig, "provider">>;
  loadAuth(options: { mode: AuthCredentialsStoreMode }): Promise<AuthKeys>;
}

const defaultDependencies: GeminiImageConfigDependencies = {
  loadConfig: async (cwd) => (await loadDiligentConfig(cwd)).config,
  loadAuth: loadAuthStore,
};

export function createResolveGeminiImageConfig(
  dependencies: GeminiImageConfigDependencies = defaultDependencies,
): (cwd: string) => Promise<GeminiImageConfig | undefined> {
  return async (cwd) => {
    const config = await dependencies.loadConfig(cwd);
    const keys = await dependencies.loadAuth({ mode: config.provider?.auth?.credentialsStore ?? "auto" });
    const apiKey = keys.gemini?.trim();
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
