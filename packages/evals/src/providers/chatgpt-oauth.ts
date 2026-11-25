// @summary ChatGPT OAuth lifecycle and provider binding for live eval profiles, interactive or unattended
import { resolve } from "node:path";
import type { OpenAIOAuthTokens } from "@diligent/core/auth";
import { refreshOAuthTokens, shouldRefresh } from "@diligent/core/auth/chatgpt-oauth";
import { EventStream } from "@diligent/core/event-stream";
import {
  type ExternalProviderAuth,
  type ImageGenerationFn,
  type Model,
  type NativeCompactFn,
  ProviderError,
  ProviderErrorReason,
  ProviderErrorType,
  type ProviderEvent,
  type ProviderManager,
  type ProviderResult,
  type StreamContext,
  type StreamFunction,
  type StreamOptions,
} from "@diligent/core/provider-contract";
import {
  createChatGPTImageGeneration,
  createChatGPTNativeCompaction,
  createChatGPTStream,
} from "@diligent/core/providers/chatgpt";
import { type AuthStoreOptions, loadOAuthTokens, runChatGPTOAuth, saveOAuthTokens } from "@diligent/runtime/auth";
import { loadDiligentConfig } from "@diligent/runtime/config";

type InteractiveLoginReason = "missing" | "relogin";

export const CHATGPT_EVAL_LOGIN_COMMAND = "bun run eval chatgpt-login";

export interface ChatGPTEvalAuthDependencies {
  load: () => Promise<OpenAIOAuthTokens | undefined>;
  save: (tokens: OpenAIOAuthTokens) => Promise<void>;
  refresh: (tokens: OpenAIOAuthTokens) => Promise<OpenAIOAuthTokens>;
  /** Browser sign-in. Omit for unattended runs, which then fail with a classified authentication error. */
  login?: (reason: InteractiveLoginReason) => Promise<OpenAIOAuthTokens>;
  shouldRefresh: (tokens: OpenAIOAuthTokens) => boolean;
  createStream: (getTokens: () => OpenAIOAuthTokens) => StreamFunction;
  createNativeCompaction: (getTokens: () => OpenAIOAuthTokens) => NativeCompactFn;
  createImageGeneration: (getTokens: () => OpenAIOAuthTokens) => ImageGenerationFn;
  onStatus?: (status: string) => void;
  onCredentials?: (tokens: OpenAIOAuthTokens) => void;
}

export class ChatGPTEvalAuth {
  private tokens: OpenAIOAuthTokens | undefined;
  private reLoginUsed = false;
  private readonly providerStream: StreamFunction;
  private readonly nativeCompaction: NativeCompactFn;
  private readonly imageGeneration: ImageGenerationFn;
  private readonly externalAuth: ExternalProviderAuth;

  readonly streamFunction: StreamFunction;

  constructor(private readonly dependencies: ChatGPTEvalAuthDependencies) {
    this.providerStream = dependencies.createStream(() => this.getTokens());
    const providerCompaction = dependencies.createNativeCompaction(() => this.getTokens());
    this.nativeCompaction = (input) => this.runAuthenticated(() => providerCompaction(input));
    const providerImageGeneration = dependencies.createImageGeneration(() => this.getTokens());
    this.imageGeneration = (input, options) => this.runAuthenticated(() => providerImageGeneration(input, options));
    this.streamFunction = (model, context, options) => this.createAuthenticatedStream(model, context, options);
    this.externalAuth = {
      isConfigured: () => this.tokens !== undefined,
      ensureFresh: () => this.ensureFresh(),
      getStream: () => this.streamFunction,
      getNativeCompaction: () => this.nativeCompaction,
      getImageGeneration: () => this.imageGeneration,
    };
  }

  async initialize(): Promise<void> {
    const stored = await this.dependencies.load();
    if (!stored) {
      await this.interactiveLogin("missing");
      return;
    }
    this.setTokens(stored);
    this.dependencies.onStatus?.("credentials_loaded");
    await this.ensureFresh();
  }

  bindProviderManager(manager: ProviderManager): void {
    manager.setExternalAuth("chatgpt", this.externalAuth);
  }

  redactionSecrets(): string[] {
    return getChatGPTRedactionSecrets(this.getTokens());
  }

  private getTokens(): OpenAIOAuthTokens {
    if (!this.tokens) throw new Error("ChatGPT OAuth is not initialized for evals.");
    return this.tokens;
  }

  private async ensureFresh(): Promise<void> {
    const current = this.getTokens();
    if (!this.dependencies.shouldRefresh(current)) return;
    this.dependencies.onStatus?.("refreshing_credentials");
    try {
      const refreshed = await this.dependencies.refresh(current);
      await this.dependencies.save(refreshed);
      this.setTokens(refreshed);
      this.dependencies.onStatus?.("credentials_refreshed");
    } catch (error) {
      if (!(await this.recoverAuthentication(error))) throw error;
    }
  }

  private async interactiveLogin(reason: InteractiveLoginReason, cause?: unknown): Promise<void> {
    const login = this.dependencies.login;
    if (!login) throw createUnattendedAuthenticationError(reason, cause);
    this.dependencies.onStatus?.(reason === "missing" ? "opening_browser" : "opening_browser_for_relogin");
    const loggedIn = await login(reason);
    await this.dependencies.save(loggedIn);
    this.setTokens(loggedIn);
    this.dependencies.onStatus?.("credentials_saved");
  }

  private async recoverAuthentication(error: unknown): Promise<boolean> {
    if (!isClearChatGPTAuthenticationFailure(error)) return false;
    if (!this.dependencies.login) throw createUnattendedAuthenticationError("relogin", error);
    if (this.reLoginUsed) return false;
    this.reLoginUsed = true;
    await this.interactiveLogin("relogin", error);
    return true;
  }

  private setTokens(tokens: OpenAIOAuthTokens): void {
    this.tokens = tokens;
    this.dependencies.onCredentials?.(tokens);
  }

  private async runAuthenticated<T>(operation: () => Promise<T>): Promise<T> {
    try {
      await this.ensureFresh();
      return await operation();
    } catch (error) {
      if (!(await this.recoverAuthentication(error))) throw error;
      return operation();
    }
  }

  private createAuthenticatedStream(
    model: Model,
    context: StreamContext,
    options: StreamOptions,
  ): EventStream<ProviderEvent, ProviderResult> {
    const stream = new EventStream<ProviderEvent, ProviderResult>(
      (event) => event.type === "done" || event.type === "error",
      (event) => {
        if (event.type === "done") return { message: event.message };
        if (event.type === "error") throw event.error;
        throw new Error("ChatGPT eval stream completed without a terminal event.");
      },
    );
    if (options.signal) stream.attachSignal(options.signal);
    const work = this.pumpStream(stream, model, context, options).catch((error) => {
      stream.push({ type: "error", error: error instanceof Error ? error : new Error(String(error)) });
    });
    stream.setInnerWork(work);
    return stream;
  }

  private async pumpStream(
    target: EventStream<ProviderEvent, ProviderResult>,
    model: Model,
    context: StreamContext,
    options: StreamOptions,
  ): Promise<void> {
    await this.ensureFresh();
    const source = this.providerStream(model, context, options);
    void source.result().catch(() => {});
    let terminalError: Error | undefined;
    let terminalSeen = false;
    for await (const event of source) {
      if (event.type === "error") {
        terminalSeen = true;
        terminalError = event.error;
        break;
      }
      if (event.type === "done") terminalSeen = true;
      target.push(event);
    }
    await source.waitForInnerWork();
    if (!terminalError) {
      if (!terminalSeen) throw new Error("ChatGPT eval provider stream ended without a terminal event.");
      return;
    }
    if (await this.recoverAuthentication(terminalError)) {
      await this.pumpStream(target, model, context, options);
      return;
    }
    target.push({ type: "error", error: terminalError });
  }
}

export function getChatGPTRedactionSecrets(tokens: OpenAIOAuthTokens): string[] {
  return [
    tokens.access_token,
    tokens.refresh_token,
    tokens.id_token,
    tokens.account_id,
    tokens.account_info?.email,
    tokens.account_info?.chatgpt_user_id,
    tokens.account_info?.chatgpt_account_id,
  ].filter((value): value is string => Boolean(value));
}

export interface ChatGPTEvalAuthOptions {
  /** Open the browser when credentials are missing or rejected. Unattended runs pass false. */
  interactive?: boolean;
  /** Dedicated file-backed credential store. Omit to use the developer's configured Diligent auth store. */
  authFile?: string;
  onStatus?: (status: string) => void;
  onCredentials?: (tokens: OpenAIOAuthTokens) => void;
}

export async function createLocalChatGPTEvalAuth(
  cwd: string,
  options: ChatGPTEvalAuthOptions = {},
): Promise<ChatGPTEvalAuth> {
  const authStore = await resolveChatGPTEvalAuthStore(cwd, options.authFile);
  const auth = new ChatGPTEvalAuth({
    load: () => loadOAuthTokens(authStore),
    save: (tokens) => saveOAuthTokens(tokens, authStore),
    refresh: refreshOAuthTokens,
    ...(options.interactive !== false && { login: () => runChatGPTOAuth() }),
    shouldRefresh,
    createStream: createChatGPTStream,
    createNativeCompaction: createChatGPTNativeCompaction,
    createImageGeneration: createChatGPTImageGeneration,
    onStatus: options.onStatus,
    onCredentials: options.onCredentials,
  });
  await auth.initialize();
  return auth;
}

/** Signs in through the browser and stores the credentials that later unattended eval runs use. */
export async function loginChatGPTEvalAuth(
  cwd: string,
  options: { authFile?: string; onUrl?: (url: string) => void } = {},
): Promise<void> {
  const authStore = await resolveChatGPTEvalAuthStore(cwd, options.authFile);
  await saveOAuthTokens(await runChatGPTOAuth({ onUrl: options.onUrl }), authStore);
}

/** Authentication failure that an unattended run reports instead of opening a browser. */
export class ChatGPTEvalAuthUnavailableError extends ProviderError {}

function createUnattendedAuthenticationError(
  reason: InteractiveLoginReason,
  cause: unknown,
): ChatGPTEvalAuthUnavailableError {
  if (cause instanceof ChatGPTEvalAuthUnavailableError) return cause;
  const detail = cause instanceof Error ? ` Cause: ${cause.message}` : "";
  const message =
    reason === "missing"
      ? `ChatGPT OAuth credentials are missing from the eval auth store. Run \`${CHATGPT_EVAL_LOGIN_COMMAND}\` with the same auth store to sign in.`
      : `ChatGPT OAuth credentials were rejected or expired, and unattended evals do not sign in again. Run \`${CHATGPT_EVAL_LOGIN_COMMAND}\` with the same auth store.${detail}`;
  return new ChatGPTEvalAuthUnavailableError(message, {
    errorType: ProviderErrorType.Auth,
    isRetryable: false,
    reason: reason === "missing" ? ProviderErrorReason.CredentialsMissing : ProviderErrorReason.CredentialsRejected,
    ...(cause instanceof Error && { cause }),
  });
}

export function isClearChatGPTAuthenticationFailure(error: unknown): boolean {
  if (error instanceof ProviderError && error.errorType === ProviderErrorType.Auth) return true;
  const status = readNumericProperty(error, "statusCode") ?? readNumericProperty(error, "status");
  if (status === 401) return true;
  const message = error instanceof Error ? error.message : "";
  if (/ChatGPT (?:native compaction|image generation) failed \(401\)/i.test(message)) return true;
  if (/Token refresh failed \(401\)/i.test(message)) return true;
  return /Token refresh failed \(400\):[\s\S]*invalid_grant/i.test(message);
}

async function resolveChatGPTEvalAuthStore(cwd: string, authFile?: string): Promise<AuthStoreOptions> {
  if (authFile) return { path: resolve(cwd, authFile), mode: "file" };
  const { config } = await loadDiligentConfig(cwd);
  return { mode: config.provider?.auth?.credentialsStore ?? "auto" };
}

function readNumericProperty(value: unknown, key: string): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "number" && Number.isInteger(candidate) ? candidate : undefined;
}
