// @summary App-server config/auth/image helpers extracted from server.ts

import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { toPersistedLocalImagePath } from "@diligent/core/llm/local-image-paths";
import { PROVIDER_NAMES, type ProviderManager } from "@diligent/core/llm/provider-manager";
import {
  createChatGPTOAuthBinding,
  openBrowser as defaultOpenBrowser,
  loadAuthStore,
  loadOAuthTokens,
  removeAuthKey,
  removeOAuthTokens,
  runChatGPTOAuth,
  saveAuthKey,
  saveOAuthTokens,
} from "../auth/index";
import {
  DILIGENT_SERVER_NOTIFICATION_METHODS,
  type DiligentServerNotification,
  type ProviderAuthStatus,
  type ProviderName,
} from "../protocol/index";

type EmitFn = (notification: DiligentServerNotification) => Promise<void>;

export async function handleConfigSet(
  modelConfig:
    | {
        getAvailableModels: () => Array<{ id: string }>;
        onModelChange: (modelId: string, threadId?: string) => void;
      }
    | undefined,
  currentModelId: string | undefined,
  model: string | undefined,
  threadId?: string,
): Promise<{ model: string | undefined }> {
  if (!model) return { model: currentModelId };
  if (!modelConfig) throw Object.assign(new Error("Model config not available"), { code: -32601 });

  const valid = modelConfig.getAvailableModels().find((entry) => entry.id === model);
  if (!valid) throw Object.assign(new Error(`Unknown model: ${model}`), { code: -32602 });

  modelConfig.onModelChange(model, threadId);
  return { model };
}

export async function buildProviderList(): Promise<ProviderAuthStatus[]> {
  const keys = await loadAuthStore();
  const oauthTokens = await loadOAuthTokens();
  return PROVIDER_NAMES.map((provider) => ({
    provider,
    configured: provider === "chatgpt" ? Boolean(oauthTokens) : Boolean(keys[provider]),
    maskedKey:
      provider === "chatgpt"
        ? oauthTokens
          ? "ChatGPT OAuth"
          : undefined
        : keys[provider]
          ? maskKey(keys[provider] as string)
          : undefined,
    oauthConnected: provider === "chatgpt" ? Boolean(oauthTokens) : undefined,
  }));
}

export async function handleAuthSet(
  providerManager: ProviderManager | undefined,
  params: { provider: ProviderName; apiKey: string },
  emit: EmitFn,
): Promise<{ ok: true }> {
  if (!providerManager) throw Object.assign(new Error("Auth not available"), { code: -32601 });
  if (params.provider === "chatgpt") {
    throw Object.assign(new Error("ChatGPT uses OAuth login, not API keys"), { code: -32602 });
  }

  await saveAuthKey(params.provider, params.apiKey);
  providerManager.setApiKey(params.provider, params.apiKey);
  const providers = await buildProviderList();
  await emit({ method: DILIGENT_SERVER_NOTIFICATION_METHODS.ACCOUNT_UPDATED, params: { providers } });
  return { ok: true };
}

export async function handleAuthRemove(
  providerManager: ProviderManager | undefined,
  params: { provider: ProviderName },
  emit: EmitFn,
): Promise<{ ok: true }> {
  if (!providerManager) throw Object.assign(new Error("Auth not available"), { code: -32601 });

  await removeAuthKey(params.provider);
  providerManager.removeApiKey(params.provider);
  if (params.provider === "chatgpt") {
    await removeOAuthTokens();
    providerManager.removeExternalAuth("chatgpt");
  }

  const providers = await buildProviderList();
  await emit({ method: DILIGENT_SERVER_NOTIFICATION_METHODS.ACCOUNT_UPDATED, params: { providers } });
  return { ok: true };
}

export async function handleAuthOAuthStart(args: {
  params: { provider: "chatgpt" };
  providerManager: ProviderManager | undefined;
  oauthPending: Promise<void> | null;
  setOAuthPending: (value: Promise<void> | null) => void;
  openBrowser?: (url: string) => void;
  emit: EmitFn;
}): Promise<{ authUrl: string }> {
  if (args.params.provider !== "chatgpt") {
    throw Object.assign(new Error("Unsupported OAuth provider"), { code: -32602 });
  }
  const pm = args.providerManager;
  if (!pm) throw Object.assign(new Error("Auth not available"), { code: -32601 });
  if (args.oauthPending) throw Object.assign(new Error("OAuth flow already in progress"), { code: -32000 });

  const loginId = randomBytes(32).toString("base64url");
  let authUrl = "";
  // Always open browser server-side. Custom openBrowser callback is used if provided (e.g. TUI),
  // otherwise fall back to the default platform browser launcher. This ensures it works inside
  // Tauri where window.open() cannot open an external browser.
  const opener = args.openBrowser ?? defaultOpenBrowser;

  const pending = (async () => {
    try {
      const tokens = await runChatGPTOAuth({
        timeoutMs: 5 * 60 * 1000,
        onUrl: (url) => {
          authUrl = url;
        },
        openBrowser: opener,
      });
      await saveOAuthTokens(tokens);
      const authBinding = createChatGPTOAuthBinding({
        initialTokens: tokens,
        onTokensRefreshed: saveOAuthTokens,
      });
      pm.setExternalAuth("chatgpt", authBinding.auth);
      await args.emit({
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.ACCOUNT_LOGIN_COMPLETED,
        params: { loginId, success: true, error: null },
      });
      const providers = await buildProviderList();
      await args.emit({
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.ACCOUNT_UPDATED,
        params: { providers },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "OAuth flow failed";
      await args.emit({
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.ACCOUNT_LOGIN_COMPLETED,
        params: { loginId, success: false, error: message },
      });
    } finally {
      args.setOAuthPending(null);
    }
  })();

  args.setOAuthPending(pending);
  return { authUrl };
}

export async function handleImageUpload(args: {
  params: { fileName: string; mediaType: string; dataBase64: string };
  threadId?: string;
  cwd: string;
  toImageUrl?: (absPath: string) => string | undefined;
}): Promise<{ type: "local_image"; path: string; mediaType: string; fileName: string; webUrl?: string }> {
  const root = args.threadId
    ? join(args.cwd, ".diligent", "images", args.threadId)
    : join(args.cwd, ".diligent", "images", "drafts");
  await mkdir(root, { recursive: true });

  const ext = extname(args.params.fileName) || mediaTypeToExtension(args.params.mediaType);
  const safeBase = sanitizeFileStem(basename(args.params.fileName, ext));
  const fileName = `${Date.now()}-${randomBytes(4).toString("hex")}-${safeBase}${ext}`;
  const absPath = join(root, fileName);

  let buffer: Buffer;
  try {
    buffer = Buffer.from(args.params.dataBase64, "base64");
  } catch {
    throw new Error("Invalid image payload");
  }

  if (buffer.length === 0) throw new Error("Empty image payload");
  if (buffer.length > 10 * 1024 * 1024) throw new Error("Image exceeds 10 MB limit");

  await Bun.write(absPath, buffer);

  const webUrl = args.toImageUrl?.(absPath);
  return {
    type: "local_image",
    path: toPersistedLocalImagePath(absPath, args.cwd),
    mediaType: args.params.mediaType,
    fileName: args.params.fileName,
    webUrl,
  };
}

function maskKey(key: string): string {
  if (key.length <= 11) return "***";
  return `${key.slice(0, 7)}...${key.slice(-4)}`;
}

function sanitizeFileStem(input: string): string {
  const cleaned = input
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || "image";
}

function mediaTypeToExtension(mediaType: string): string {
  switch (mediaType) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    default:
      return ".img";
  }
}
