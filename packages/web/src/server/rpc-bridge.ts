// @summary WebSocket bridge that multiplexes JSON-RPC calls, notifications, and server requests

import { randomBytes } from "node:crypto";
import {
  buildOAuthTokens,
  CHATGPT_AUTH_URL,
  CHATGPT_CLIENT_ID,
  CHATGPT_REDIRECT_URI,
  CHATGPT_SCOPES,
  type DiligentAppServer,
  exchangeCodeForTokens,
  generatePKCE,
  loadAuthStore,
  loadOAuthTokens,
  openBrowser,
  PROVIDER_NAMES,
  type ProviderManager,
  removeAuthKey,
  removeOAuthTokens,
  saveAuthKey,
  saveOAuthTokens,
  waitForCallback,
} from "@diligent/core";
import type {
  DiligentServerNotification,
  DiligentServerRequest,
  DiligentServerRequestResponse,
  Mode,
  ProviderAuthStatus,
} from "@diligent/protocol";
import {
  AuthRemoveParamsSchema,
  AuthSetParamsSchema,
  ConfigSetParamsSchema,
  DILIGENT_SERVER_REQUEST_METHODS,
  DILIGENT_WEB_REQUEST_METHODS,
  DiligentServerRequestResponseSchema,
  JSONRPCErrorResponseSchema,
  JSONRPCResponseSchema,
} from "@diligent/protocol";
import type { ServerWebSocket } from "bun";
import type { ConnectedMessage, ModelInfo, WsClientMessage, WsServerMessage } from "../shared/ws-protocol";

interface RpcSession {
  id: string;
  ws: ServerWebSocket<RpcWsData>;
  cwd: string;
  mode: Mode;
  currentThreadId: string | null;
}

export interface RpcWsData {
  sessionId: string;
}

function toSafeFallback(request: DiligentServerRequest): DiligentServerRequestResponse {
  if (request.method === DILIGENT_SERVER_REQUEST_METHODS.APPROVAL_REQUEST) {
    return {
      method: DILIGENT_SERVER_REQUEST_METHODS.APPROVAL_REQUEST,
      result: { decision: "reject" },
    };
  }

  return {
    method: DILIGENT_SERVER_REQUEST_METHODS.USER_INPUT_REQUEST,
    result: { answers: {} },
  };
}

function maskKey(key: string): string {
  if (key.length <= 11) return "***";
  return `${key.slice(0, 7)}...${key.slice(-4)}`;
}

interface ModelConfig {
  currentModelId: string | undefined;
  allModels: ModelInfo[];
  getAvailableModels: () => ModelInfo[];
  onModelChange: (modelId: string) => void;
}

export class RpcBridge {
  private readonly sessions = new Map<string, RpcSession>();
  private readonly threadSubscribers = new Map<string, Set<string>>();
  private readonly subscriptions = new Map<string, { threadId: string; sessionId: string }>();
  private readonly pendingServerRequests = new Map<
    number,
    {
      resolve: (response: DiligentServerRequestResponse) => void;
      timeoutId: ReturnType<typeof setTimeout>;
      request: DiligentServerRequest;
      sentTo: Set<string>;
    }
  >();
  private serverRequestSeq = 0;
  private currentModelId: string | undefined;
  private oauthPending: Promise<void> | null = null;

  constructor(
    private readonly appServer: DiligentAppServer,
    private readonly cwd: string,
    private readonly initialMode: Mode,
    private readonly modelConfig: ModelConfig,
    private readonly providerManager?: ProviderManager,
  ) {
    this.currentModelId = modelConfig.currentModelId;
    this.appServer.setNotificationListener(async (notification) => {
      this.routeNotification(notification);
    });

    this.appServer.setServerRequestHandler(async (request) => {
      const threadId = request.params.threadId;
      const subscribers = threadId ? this.threadSubscribers.get(threadId) : null;
      if (!subscribers || subscribers.size === 0) {
        return toSafeFallback(request);
      }
      return this.requestFromSubscribers(subscribers, request);
    });
  }

  open(ws: ServerWebSocket<RpcWsData>): void {
    const sessionId = ws.data.sessionId;
    const session: RpcSession = {
      id: sessionId,
      ws,
      cwd: this.cwd,
      mode: this.initialMode,
      currentThreadId: null,
    };

    this.sessions.set(sessionId, session);

    const connected: ConnectedMessage = {
      type: "connected",
      cwd: this.cwd,
      mode: this.initialMode,
      serverVersion: "0.0.1",
      currentModel: this.currentModelId,
      availableModels: this.modelConfig.getAvailableModels(),
    };
    this.send(ws, connected);
  }

  close(ws: ServerWebSocket<RpcWsData>): void {
    const session = this.sessions.get(ws.data.sessionId);
    if (!session) return;

    // Clean up all subscriptions for this session
    for (const [subId, sub] of this.subscriptions.entries()) {
      if (sub.sessionId === session.id) {
        const subs = this.threadSubscribers.get(sub.threadId);
        if (subs) {
          subs.delete(session.id);
          if (subs.size === 0) {
            this.threadSubscribers.delete(sub.threadId);
          }
        }
        this.subscriptions.delete(subId);
      }
    }

    // Resolve pending server requests if this was the last remaining subscriber
    for (const [requestId, pending] of this.pendingServerRequests.entries()) {
      pending.sentTo.delete(session.id);
      if (pending.sentTo.size === 0) {
        clearTimeout(pending.timeoutId);
        this.pendingServerRequests.delete(requestId);
        pending.resolve(toSafeFallback(pending.request));
      }
    }

    this.sessions.delete(session.id);
  }

  async message(ws: ServerWebSocket<RpcWsData>, raw: string | Buffer): Promise<void> {
    let parsed: WsClientMessage;
    try {
      parsed = JSON.parse(typeof raw === "string" ? raw : raw.toString()) as WsClientMessage;
    } catch {
      this.send(ws, { type: "error", message: "Malformed JSON" });
      return;
    }

    if (parsed.type === "rpc_notify") {
      await this.appServer.handleNotification({ method: parsed.method, params: parsed.params });
      return;
    }

    if (parsed.type === "rpc_request") {
      const session = this.sessions.get(ws.data.sessionId);
      if (!session) {
        this.send(ws, { type: "error", message: "Session not found" });
        return;
      }

      if (parsed.method === DILIGENT_WEB_REQUEST_METHODS.CONFIG_SET) {
        const validated = ConfigSetParamsSchema.safeParse(parsed.params ?? {});
        if (!validated.success) {
          this.send(ws, {
            type: "rpc_response",
            response: JSONRPCErrorResponseSchema.parse({
              id: parsed.id,
              error: { code: -32602, message: validated.error.message },
            }),
          });
          return;
        }
        const modelId = validated.data.model;
        if (modelId) {
          const valid = this.modelConfig.getAvailableModels().find((m) => m.id === modelId);
          if (valid) {
            this.currentModelId = modelId;
            this.modelConfig.onModelChange(modelId);
            this.send(ws, {
              type: "rpc_response",
              response: JSONRPCResponseSchema.parse({ id: parsed.id, result: { model: modelId } }),
            });
          } else {
            this.send(ws, {
              type: "rpc_response",
              response: JSONRPCErrorResponseSchema.parse({
                id: parsed.id,
                error: { code: -32602, message: `Unknown model: ${modelId}` },
              }),
            });
          }
        } else {
          this.send(ws, {
            type: "rpc_response",
            response: JSONRPCResponseSchema.parse({ id: parsed.id, result: { model: this.currentModelId } }),
          });
        }
        return;
      }

      if (parsed.method === DILIGENT_WEB_REQUEST_METHODS.AUTH_LIST && this.providerManager) {
        const providers = await this.buildProviderList();
        this.send(ws, {
          type: "rpc_response",
          response: JSONRPCResponseSchema.parse({
            id: parsed.id,
            result: { providers, availableModels: this.modelConfig.getAvailableModels() },
          }),
        });
        return;
      }

      if (parsed.method === DILIGENT_WEB_REQUEST_METHODS.AUTH_SET && this.providerManager) {
        const validated = AuthSetParamsSchema.safeParse(parsed.params);
        if (validated.success) {
          const { provider, apiKey } = validated.data;
          await saveAuthKey(provider, apiKey);
          this.providerManager.setApiKey(provider, apiKey);
          this.send(ws, {
            type: "rpc_response",
            response: JSONRPCResponseSchema.parse({ id: parsed.id, result: { ok: true } }),
          });
          const providers = await this.buildProviderList();
          this.emitAccountUpdated(providers);
        } else {
          this.send(ws, {
            type: "rpc_response",
            response: JSONRPCErrorResponseSchema.parse({
              id: parsed.id,
              error: { code: -32602, message: validated.error.message },
            }),
          });
        }
        return;
      }

      if (parsed.method === DILIGENT_WEB_REQUEST_METHODS.AUTH_REMOVE && this.providerManager) {
        const validated = AuthRemoveParamsSchema.safeParse(parsed.params);
        if (validated.success) {
          const { provider } = validated.data;
          await removeAuthKey(provider);
          this.providerManager.removeApiKey(provider);
          if (provider === "openai") {
            await removeOAuthTokens();
            this.providerManager.removeOAuthTokens();
          }
          this.send(ws, {
            type: "rpc_response",
            response: JSONRPCResponseSchema.parse({ id: parsed.id, result: { ok: true } }),
          });
          const providers = await this.buildProviderList();
          this.emitAccountUpdated(providers);
        } else {
          this.send(ws, {
            type: "rpc_response",
            response: JSONRPCErrorResponseSchema.parse({
              id: parsed.id,
              error: { code: -32602, message: validated.error.message },
            }),
          });
        }
        return;
      }

      if (parsed.method === DILIGENT_WEB_REQUEST_METHODS.THREAD_SUBSCRIBE) {
        const params = parsed.params as { threadId?: string };
        if (!params?.threadId) {
          this.send(ws, {
            type: "rpc_response",
            response: JSONRPCErrorResponseSchema.parse({
              id: parsed.id,
              error: { code: -32602, message: "threadId is required" },
            }),
          });
          return;
        }
        const subscriptionId = this.addSubscription(params.threadId, session.id);
        this.send(ws, {
          type: "rpc_response",
          response: JSONRPCResponseSchema.parse({ id: parsed.id, result: { subscriptionId } }),
        });
        return;
      }

      if (parsed.method === DILIGENT_WEB_REQUEST_METHODS.THREAD_UNSUBSCRIBE) {
        const params = parsed.params as { subscriptionId?: string };
        if (!params?.subscriptionId) {
          this.send(ws, {
            type: "rpc_response",
            response: JSONRPCErrorResponseSchema.parse({
              id: parsed.id,
              error: { code: -32602, message: "subscriptionId is required" },
            }),
          });
          return;
        }
        const ok = this.removeSubscription(params.subscriptionId);
        this.send(ws, {
          type: "rpc_response",
          response: JSONRPCResponseSchema.parse({ id: parsed.id, result: { ok } }),
        });
        return;
      }

      if (parsed.method === DILIGENT_WEB_REQUEST_METHODS.AUTH_OAUTH_START && this.providerManager) {
        if (this.oauthPending) {
          this.send(ws, {
            type: "rpc_response",
            response: JSONRPCErrorResponseSchema.parse({
              id: parsed.id,
              error: { code: -32000, message: "OAuth flow already in progress" },
            }),
          });
          return;
        }

        try {
          const { codeVerifier, codeChallenge } = generatePKCE();
          const state = randomBytes(16).toString("hex");

          const params = new URLSearchParams({
            response_type: "code",
            client_id: CHATGPT_CLIENT_ID,
            redirect_uri: CHATGPT_REDIRECT_URI,
            scope: CHATGPT_SCOPES,
            code_challenge: codeChallenge,
            code_challenge_method: "S256",
            id_token_add_organizations: "true",
            codex_cli_simplified_flow: "true",
            originator: "diligent",
            state,
          });

          const authUrl = `${CHATGPT_AUTH_URL}?${params}`;
          const loginId = state;

          // Respond immediately with the auth URL and open the browser server-side
          // (client-side window.open() fails in Tauri WebView)
          this.send(ws, {
            type: "rpc_response",
            response: JSONRPCResponseSchema.parse({ id: parsed.id, result: { authUrl } }),
          });
          openBrowser(authUrl);

          // Run OAuth flow asynchronously, notify on completion
          this.oauthPending = (async () => {
            try {
              const { code } = await waitForCallback(state, 5 * 60 * 1000);
              const rawTokens = await exchangeCodeForTokens(code, codeVerifier);
              const tokens = buildOAuthTokens(rawTokens);
              await saveOAuthTokens(tokens);
              this.providerManager!.setOAuthTokens(tokens);

              this.emitAccountLoginCompleted(loginId, true, null);
              const providers = await this.buildProviderList();
              this.emitAccountUpdated(providers);
            } catch (e) {
              const error = e instanceof Error ? e.message : "OAuth flow failed";
              this.emitAccountLoginCompleted(loginId, false, error);
            } finally {
              this.oauthPending = null;
            }
          })();
        } catch (e) {
          this.send(ws, {
            type: "rpc_response",
            response: JSONRPCErrorResponseSchema.parse({
              id: parsed.id,
              error: { code: -32000, message: e instanceof Error ? e.message : "OAuth start failed" },
            }),
          });
        }
        return;
      }

      const params = this.withSessionDefaults(parsed.method, parsed.params, session);
      const response = await this.appServer.handleRequest({
        id: parsed.id,
        method: parsed.method,
        params,
      });

      if (parsed.method === "thread/start" && "result" in response) {
        const maybeThreadId = (response.result as { threadId?: string }).threadId;
        if (maybeThreadId) {
          session.currentThreadId = maybeThreadId;
          this.addSubscription(maybeThreadId, session.id);
        }
      }

      if (parsed.method === "thread/resume" && "result" in response) {
        const resumed = response.result as { found: boolean; threadId?: string };
        if (resumed.found && resumed.threadId) {
          session.currentThreadId = resumed.threadId;
          this.addSubscription(resumed.threadId, session.id);
        }
      }

      if (parsed.method === "mode/set" && "result" in response) {
        const mode = (response.result as { mode?: Mode }).mode;
        if (mode) {
          session.mode = mode;
        }
      }

      if (parsed.method === "thread/delete" && "result" in response) {
        const r = response.result as { deleted?: boolean };
        const deletedId = (parsed.params as { threadId?: string }).threadId;
        if (r.deleted && deletedId) {
          this.removeAllSubscriptionsForThread(deletedId);
          if (session.currentThreadId === deletedId) {
            session.currentThreadId = null;
          }
        }
      }

      this.send(ws, { type: "rpc_response", response });
      return;
    }

    if (parsed.type === "server_request_response") {
      // Global pending map — first responder wins, subsequent responses are ignored
      const pending = this.pendingServerRequests.get(parsed.id);
      if (!pending) {
        return;
      }

      clearTimeout(pending.timeoutId);
      this.pendingServerRequests.delete(parsed.id);

      const safe = DiligentServerRequestResponseSchema.safeParse(parsed.response);
      if (!safe.success) {
        pending.resolve({
          method: DILIGENT_SERVER_REQUEST_METHODS.APPROVAL_REQUEST,
          result: { decision: "reject" },
        });
        return;
      }

      pending.resolve(safe.data);
    }
  }

  requestFromSubscribers(
    subscribers: Set<string>,
    request: DiligentServerRequest,
  ): Promise<DiligentServerRequestResponse> {
    const requestId = ++this.serverRequestSeq;
    const payload: WsServerMessage = {
      type: "server_request",
      id: requestId,
      request,
    };

    const sentTo = new Set<string>();
    for (const sessionId of subscribers) {
      const session = this.sessions.get(sessionId);
      if (session) {
        this.send(session.ws, payload);
        sentTo.add(sessionId);
      }
    }

    if (sentTo.size === 0) {
      return Promise.resolve(toSafeFallback(request));
    }

    return new Promise<DiligentServerRequestResponse>((resolve) => {
      const timeoutId = setTimeout(
        () => {
          this.pendingServerRequests.delete(requestId);
          resolve(toSafeFallback(request));
        },
        5 * 60 * 1000,
      );

      this.pendingServerRequests.set(requestId, {
        resolve,
        timeoutId,
        request,
        sentTo,
      });
    });
  }

  private async buildProviderList(): Promise<ProviderAuthStatus[]> {
    const keys = await loadAuthStore();
    const oauthTokens = await loadOAuthTokens();
    return PROVIDER_NAMES.map((p) => ({
      provider: p,
      configured: Boolean(keys[p]),
      maskedKey: keys[p] ? maskKey(keys[p] as string) : undefined,
      oauthConnected: p === "openai" ? Boolean(oauthTokens) : undefined,
    }));
  }

  private emitAccountUpdated(providers: ProviderAuthStatus[]): void {
    this.broadcast({
      type: "server_notification",
      notification: {
        method: "account/updated",
        params: { providers },
      },
    });
  }

  private emitAccountLoginCompleted(loginId: string, success: boolean, error: string | null): void {
    this.broadcast({
      type: "server_notification",
      notification: {
        method: "account/login/completed",
        params: { loginId, success, error },
      },
    });
  }

  private withSessionDefaults(method: string, params: unknown, session: RpcSession): unknown {
    if (!params || typeof params !== "object") {
      return params;
    }

    const objectParams = params as Record<string, unknown>;

    if (method === "thread/start") {
      return {
        ...objectParams,
        cwd: typeof objectParams.cwd === "string" ? objectParams.cwd : session.cwd,
        mode: typeof objectParams.mode === "string" ? objectParams.mode : session.mode,
      };
    }

    if (
      method === "turn/start" ||
      method === "turn/interrupt" ||
      method === "turn/steer" ||
      method === "mode/set" ||
      method === "thread/read" ||
      method === "knowledge/list"
    ) {
      return {
        ...objectParams,
        threadId:
          typeof objectParams.threadId === "string" && objectParams.threadId.length > 0
            ? objectParams.threadId
            : session.currentThreadId,
      };
    }

    return objectParams;
  }

  private routeNotification(notification: DiligentServerNotification): void {
    const params = notification.params as { threadId?: string };
    const threadId = params.threadId;

    if (!threadId) {
      this.broadcast({ type: "server_notification", notification });
      return;
    }

    const subscribers = this.threadSubscribers.get(threadId);
    if (!subscribers || subscribers.size === 0) {
      this.broadcast({ type: "server_notification", notification });
      return;
    }

    for (const sessionId of subscribers) {
      const session = this.sessions.get(sessionId);
      if (session) {
        this.send(session.ws, { type: "server_notification", notification });
      }
    }
  }

  private broadcast(message: WsServerMessage): void {
    for (const session of this.sessions.values()) {
      this.send(session.ws, message);
    }
  }

  private addSubscription(threadId: string, sessionId: string): string {
    let subs = this.threadSubscribers.get(threadId);
    if (!subs) {
      subs = new Set();
      this.threadSubscribers.set(threadId, subs);
    }

    // If already subscribed, return existing subscriptionId
    if (subs.has(sessionId)) {
      for (const [subId, sub] of this.subscriptions.entries()) {
        if (sub.threadId === threadId && sub.sessionId === sessionId) {
          return subId;
        }
      }
    }

    subs.add(sessionId);
    const subId = randomBytes(16).toString("hex");
    this.subscriptions.set(subId, { threadId, sessionId });
    return subId;
  }

  private removeSubscription(subscriptionId: string): boolean {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) return false;

    const subs = this.threadSubscribers.get(sub.threadId);
    if (subs) {
      subs.delete(sub.sessionId);
      if (subs.size === 0) {
        this.threadSubscribers.delete(sub.threadId);
      }
    }

    this.subscriptions.delete(subscriptionId);
    return true;
  }

  private removeAllSubscriptionsForThread(threadId: string): void {
    for (const [subId, sub] of this.subscriptions.entries()) {
      if (sub.threadId === threadId) {
        this.subscriptions.delete(subId);
      }
    }
    this.threadSubscribers.delete(threadId);
  }

  private send(ws: ServerWebSocket<RpcWsData>, message: WsServerMessage): void {
    ws.send(JSON.stringify(message));
  }
}

export function parseRpcResponse(raw: unknown): { ok: boolean; error?: string } {
  const parsed = JSONRPCResponseSchema.safeParse(raw);
  if (parsed.success) return { ok: true };

  const errorParsed = JSONRPCErrorResponseSchema.safeParse(raw);
  if (errorParsed.success) return { ok: false, error: errorParsed.data.error.message };

  return { ok: false, error: "invalid response" };
}
