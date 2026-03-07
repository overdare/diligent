// @summary WebSocket bridge that multiplexes JSON-RPC calls, notifications, and server requests

import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
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
  ThinkingEffort,
} from "@diligent/protocol";
import {
  AuthRemoveParamsSchema,
  AuthSetParamsSchema,
  ConfigSetParamsSchema,
  DILIGENT_CLIENT_REQUEST_METHODS,
  DILIGENT_SERVER_NOTIFICATION_METHODS,
  DILIGENT_SERVER_REQUEST_METHODS,
  DILIGENT_VERSION,
  DILIGENT_WEB_REQUEST_METHODS,
  DiligentServerRequestResponseSchema,
  EffortSetResponseSchema,
  ImageUploadParamsSchema,
  JSONRPCErrorResponseSchema,
  JSONRPCResponseSchema,
  ModeSetResponseSchema,
  ThreadDeleteParamsSchema,
  ThreadDeleteResponseSchema,
  ThreadReadResponseSchema,
  ThreadResumeResponseSchema,
  ThreadStartResponseSchema,
  ThreadSubscribeParamsSchema,
  ThreadUnsubscribeParamsSchema,
} from "@diligent/protocol";
import type { ServerWebSocket } from "bun";
import { toWebImageUrl } from "../shared/image-routes";
import type { ConnectedMessage, ModelInfo, WsClientMessage, WsServerMessage } from "../shared/ws-protocol";

interface RpcSession {
  id: string;
  ws: ServerWebSocket<RpcWsData>;
  cwd: string;
  mode: Mode;
  effort: ThinkingEffort;
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
  private readonly turnInitiators = new Map<string, string>(); // threadId → sessionId that started the turn
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
      return this.broadcastServerRequest(request);
    });
  }

  open(ws: ServerWebSocket<RpcWsData>): void {
    const sessionId = ws.data.sessionId;
    const session: RpcSession = {
      id: sessionId,
      ws,
      cwd: this.cwd,
      mode: this.initialMode,
      effort: "medium",
      currentThreadId: null,
    };

    this.sessions.set(sessionId, session);

    const connected: ConnectedMessage = {
      type: "connected",
      cwd: this.cwd,
      mode: this.initialMode,
      effort: session.effort,
      serverVersion: DILIGENT_VERSION,
      currentModel: this.currentModelId,
      availableModels: this.modelConfig.getAvailableModels(),
    };
    this.send(ws, connected);
  }

  close(ws: ServerWebSocket<RpcWsData>): void {
    const session = this.sessions.get(ws.data.sessionId);
    if (!session) return;

    this.removeAllSubscriptionsForSession(session.id);
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
        const validated = ThreadSubscribeParamsSchema.safeParse(parsed.params);
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
        const subscriptionId = this.addSubscription(validated.data.threadId, session.id);
        session.currentThreadId = validated.data.threadId;
        this.send(ws, {
          type: "rpc_response",
          response: JSONRPCResponseSchema.parse({ id: parsed.id, result: { subscriptionId } }),
        });
        return;
      }

      if (parsed.method === DILIGENT_WEB_REQUEST_METHODS.THREAD_UNSUBSCRIBE) {
        const validated = ThreadUnsubscribeParamsSchema.safeParse(parsed.params);
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
        const ok = this.removeSubscription(validated.data.subscriptionId);
        this.send(ws, {
          type: "rpc_response",
          response: JSONRPCResponseSchema.parse({ id: parsed.id, result: { ok } }),
        });
        return;
      }

      if (parsed.method === DILIGENT_WEB_REQUEST_METHODS.IMAGE_UPLOAD) {
        const validated = ImageUploadParamsSchema.safeParse(parsed.params);
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

        try {
          const attachment = await this.handleImageUpload(
            validated.data,
            validated.data.threadId ?? session.currentThreadId ?? undefined,
          );
          this.send(ws, {
            type: "rpc_response",
            response: JSONRPCResponseSchema.parse({ id: parsed.id, result: { attachment } }),
          });
        } catch (error) {
          this.send(ws, {
            type: "rpc_response",
            response: JSONRPCErrorResponseSchema.parse({
              id: parsed.id,
              error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
            }),
          });
        }
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

      // Set turnInitiators BEFORE forwarding so echo prevention works during notification routing
      if (parsed.method === DILIGENT_CLIENT_REQUEST_METHODS.TURN_START && session.currentThreadId) {
        this.turnInitiators.set(session.currentThreadId, session.id);
      }

      const response = await this.appServer.handleRequest({
        id: parsed.id,
        method: parsed.method,
        params,
      });

      if (parsed.method === DILIGENT_CLIENT_REQUEST_METHODS.THREAD_START && "result" in response) {
        const r = ThreadStartResponseSchema.parse(response.result);
        if (r.threadId) {
          // Unsubscribe from all previous threads — a tab views one thread at a time
          this.removeAllSubscriptionsForSession(session.id);
          session.currentThreadId = r.threadId;
          this.addSubscription(r.threadId, session.id);
        }
      }

      if (parsed.method === DILIGENT_CLIENT_REQUEST_METHODS.THREAD_RESUME && "result" in response) {
        const resumed = ThreadResumeResponseSchema.parse(response.result);
        if (resumed.found && resumed.threadId) {
          this.removeAllSubscriptionsForSession(session.id);
          session.currentThreadId = resumed.threadId;
          this.addSubscription(resumed.threadId, session.id);
        }
      }

      if (parsed.method === DILIGENT_CLIENT_REQUEST_METHODS.THREAD_READ && "result" in response) {
        const r = ThreadReadResponseSchema.parse(response.result);
        if (r.currentEffort) {
          session.effort = r.currentEffort;
        }
      }

      // Clean up turnInitiators if turn/start failed
      if (
        parsed.method === DILIGENT_CLIENT_REQUEST_METHODS.TURN_START &&
        session.currentThreadId &&
        !("result" in response)
      ) {
        this.turnInitiators.delete(session.currentThreadId);
      }

      if (parsed.method === DILIGENT_CLIENT_REQUEST_METHODS.MODE_SET && "result" in response) {
        const r = ModeSetResponseSchema.parse(response.result);
        if (r.mode) {
          session.mode = r.mode;
        }
      }

      if (parsed.method === DILIGENT_CLIENT_REQUEST_METHODS.EFFORT_SET && "result" in response) {
        const r = EffortSetResponseSchema.parse(response.result);
        if (r.effort) {
          session.effort = r.effort;
        }
      }

      if (parsed.method === DILIGENT_CLIENT_REQUEST_METHODS.THREAD_DELETE && "result" in response) {
        const r = ThreadDeleteResponseSchema.parse(response.result);
        const deletedId = ThreadDeleteParamsSchema.parse(parsed.params).threadId;
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

      // Notify other subscribers that this request was resolved (dismiss their prompts)
      const responderId = ws.data.sessionId;
      for (const sessionId of pending.sentTo) {
        if (sessionId === responderId) continue;
        const session = this.sessions.get(sessionId);
        if (session) {
          this.send(session.ws, { type: "server_request_resolved", id: parsed.id });
        }
      }

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

  /**
   * Broadcast a server request to ALL connected clients.
   * Each client decides whether to show the dialog (active thread) or buffer it (inactive thread).
   * First response wins; others get a server_request_resolved message.
   */
  private broadcastServerRequest(request: DiligentServerRequest): Promise<DiligentServerRequestResponse> {
    const requestId = ++this.serverRequestSeq;
    const payload: WsServerMessage = {
      type: "server_request",
      id: requestId,
      request,
    };

    const sentTo = new Set<string>();
    for (const session of this.sessions.values()) {
      this.send(session.ws, payload);
      sentTo.add(session.id);
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
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.ACCOUNT_UPDATED,
        params: { providers },
      },
    });
  }

  private emitAccountLoginCompleted(loginId: string, success: boolean, error: string | null): void {
    this.broadcast({
      type: "server_notification",
      notification: {
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.ACCOUNT_LOGIN_COMPLETED,
        params: { loginId, success, error },
      },
    });
  }

  private withSessionDefaults(method: string, params: unknown, session: RpcSession): unknown {
    if (!params || typeof params !== "object") {
      return params;
    }

    const objectParams = params as Record<string, unknown>;

    if (method === DILIGENT_CLIENT_REQUEST_METHODS.THREAD_START) {
      return {
        ...objectParams,
        cwd: typeof objectParams.cwd === "string" ? objectParams.cwd : session.cwd,
        mode: typeof objectParams.mode === "string" ? objectParams.mode : session.mode,
      };
    }

    if (
      method === DILIGENT_CLIENT_REQUEST_METHODS.TURN_START ||
      method === DILIGENT_CLIENT_REQUEST_METHODS.TURN_INTERRUPT ||
      method === DILIGENT_CLIENT_REQUEST_METHODS.TURN_STEER ||
      method === DILIGENT_CLIENT_REQUEST_METHODS.MODE_SET ||
      method === DILIGENT_CLIENT_REQUEST_METHODS.EFFORT_SET ||
      method === DILIGENT_CLIENT_REQUEST_METHODS.THREAD_READ ||
      method === DILIGENT_CLIENT_REQUEST_METHODS.KNOWLEDGE_LIST
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

    if (notification.method.startsWith("collab/")) {
      console.log("[RpcBridge][collab] routeNotification", {
        method: notification.method,
        threadId,
        hasThreadId: Boolean(threadId),
      });
    }

    if (!threadId) {
      this.broadcast({ type: "server_notification", notification });
      return;
    }

    // Clean up turn initiator when turn completes
    if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED) {
      this.turnInitiators.delete(threadId);
    }

    const subscribers = this.threadSubscribers.get(threadId);
    if (!subscribers || subscribers.size === 0) {
      if (notification.method.startsWith("collab/")) {
        console.log("[RpcBridge][collab] no thread subscribers; broadcasting", {
          method: notification.method,
          threadId,
        });
      }
      this.broadcast({ type: "server_notification", notification });
      return;
    }

    // Skip sender for userMessage items (sender already has it)
    const skipSessionId = this.getUserMessageSender(notification, threadId);

    for (const sessionId of subscribers) {
      if (sessionId === skipSessionId) continue;
      const session = this.sessions.get(sessionId);
      if (session) {
        if (notification.method.startsWith("collab/")) {
          console.log("[RpcBridge][collab] send to session", {
            method: notification.method,
            threadId,
            sessionId,
          });
        }
        this.send(session.ws, { type: "server_notification", notification });
      }
    }
  }

  private getUserMessageSender(notification: DiligentServerNotification, threadId: string): string | null {
    if (
      notification.method !== DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_STARTED &&
      notification.method !== DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_COMPLETED
    ) {
      return null;
    }
    const item = (notification.params as { item?: { type?: string } }).item;
    if (item?.type !== "userMessage") return null;
    return this.turnInitiators.get(threadId) ?? null;
  }

  private async handleImageUpload(
    params: { fileName: string; mediaType: string; dataBase64: string },
    threadId?: string,
  ): Promise<{ type: "local_image"; path: string; mediaType: string; fileName: string; webUrl: string }> {
    const root = threadId
      ? join(this.cwd, ".diligent", "images", threadId)
      : join(this.cwd, ".diligent", "images", "drafts");
    await mkdir(root, { recursive: true });

    const ext = extname(params.fileName) || mediaTypeToExtension(params.mediaType);
    const safeBase = sanitizeFileStem(basename(params.fileName, ext));
    const fileName = `${Date.now()}-${randomBytes(4).toString("hex")}-${safeBase}${ext}`;
    const absPath = join(root, fileName);

    let buffer: Buffer;
    try {
      buffer = Buffer.from(params.dataBase64, "base64");
    } catch {
      throw new Error("Invalid image payload");
    }

    if (buffer.length === 0) {
      throw new Error("Empty image payload");
    }
    if (buffer.length > 10 * 1024 * 1024) {
      throw new Error("Image exceeds 10 MB limit");
    }

    await Bun.write(absPath, buffer);
    return {
      type: "local_image",
      path: absPath,
      mediaType: params.mediaType,
      fileName: params.fileName,
      webUrl: toWebImageUrl(absPath),
    };
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

  private removeAllSubscriptionsForSession(sessionId: string): void {
    for (const [subId, sub] of this.subscriptions.entries()) {
      if (sub.sessionId === sessionId) {
        const subs = this.threadSubscribers.get(sub.threadId);
        if (subs) {
          subs.delete(sessionId);
          if (subs.size === 0) {
            this.threadSubscribers.delete(sub.threadId);
          }
        }
        this.subscriptions.delete(subId);
      }
    }
  }

  private send(ws: ServerWebSocket<RpcWsData>, message: WsServerMessage): void {
    ws.send(JSON.stringify(message));
  }
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

export function parseRpcResponse(raw: unknown): { ok: boolean; error?: string } {
  const parsed = JSONRPCResponseSchema.safeParse(raw);
  if (parsed.success) return { ok: true };

  const errorParsed = JSONRPCErrorResponseSchema.safeParse(raw);
  if (errorParsed.success) return { ok: false, error: errorParsed.data.error.message };

  return { ok: false, error: "invalid response" };
}
