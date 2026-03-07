// @summary JSON-RPC app server mapping SessionManager/AgentEvent to shared protocol requests and notifications

import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import {
  DILIGENT_CLIENT_NOTIFICATION_METHODS,
  DILIGENT_CLIENT_REQUEST_METHODS,
  DILIGENT_SERVER_NOTIFICATION_METHODS,
  DILIGENT_SERVER_REQUEST_METHODS,
  type DiligentClientRequest,
  DiligentClientRequestSchema,
  type DiligentServerNotification,
  type DiligentServerRequest,
  type DiligentServerRequestResponse,
  DiligentServerRequestResponseSchema,
  type JSONRPCErrorResponse,
  JSONRPCErrorResponseSchema,
  JSONRPCRequestSchema,
  type JSONRPCResponse,
  JSONRPCResponseSchema,
  type Mode,
  type ModelInfo,
  type PluginDescriptor,
  type ProviderAuthStatus,
  type SessionSummary,
  type ThinkingEffort,
  type ToolConflictPolicy,
  type ToolDescriptor,
  type TurnStartParams,
} from "@diligent/protocol";
import type { AgentEvent, AgentLoopConfig, ModeKind } from "../agent/types";
import {
  loadAuthStore,
  loadOAuthTokens,
  removeAuthKey,
  removeOAuthTokens,
  saveAuthKey,
  saveOAuthTokens,
} from "../auth/auth-store";
import {
  buildOAuthTokens,
  CHATGPT_AUTH_URL,
  CHATGPT_CLIENT_ID,
  CHATGPT_REDIRECT_URI,
  CHATGPT_SCOPES,
  openBrowser as defaultOpenBrowser,
  exchangeCodeForTokens,
  generatePKCE,
  waitForCallback,
} from "../auth/oauth";
import type { AgentRegistry } from "../collab/registry";
import type { DiligentConfig } from "../config/schema";
import { getProjectConfigPath, writeProjectToolsConfig } from "../config/writer";
import type { DiligentPaths } from "../infrastructure/diligent-dir";
import { readKnowledge } from "../knowledge/store";
import { PROVIDER_NAMES, type ProviderManager } from "../provider/provider-manager";
import { isRpcNotification, isRpcRequest, isRpcResponse, type RpcPeer } from "../rpc/channel";
import { buildSessionContext } from "../session/context-builder";
import { SessionManager, type SessionManagerConfig } from "../session/manager";
import { deleteSession, listSessions, readChildSessions, readSessionFile } from "../session/persistence";
import { generateSessionId } from "../session/types";
import type { ApprovalRequest, ApprovalResponse, UserInputRequest, UserInputResponse } from "../tool/types";
import { buildDefaultTools } from "../tools/defaults";
import { agentEventToNotification } from "./event-mapper";

export interface ModelConfig {
  currentModelId: string | undefined;
  getAvailableModels: () => ModelInfo[];
  onModelChange: (modelId: string) => void;
}

export interface ToolConfigManager {
  getTools: () => DiligentConfig["tools"] | undefined;
  setTools: (tools: DiligentConfig["tools"] | undefined) => void;
}

export interface DiligentAppServerConfig {
  serverName?: string;
  serverVersion?: string;
  cwd?: string;
  getInitializeResult?: () => Record<string, unknown> | Promise<Record<string, unknown>>;
  resolvePaths: (cwd: string) => Promise<DiligentPaths>;
  buildAgentConfig: (args: {
    cwd: string;
    mode: Mode;
    effort: ThinkingEffort;
    signal: AbortSignal;
    approve: (request: ApprovalRequest) => Promise<ApprovalResponse>;
    ask: (request: UserInputRequest) => Promise<UserInputResponse>;
    getSessionId?: () => string | undefined;
    onCollabEvent?: (event: AgentEvent) => void;
  }) => (AgentLoopConfig & { registry?: AgentRegistry }) | Promise<AgentLoopConfig & { registry?: AgentRegistry }>;
  compaction?: SessionManagerConfig["compaction"];
  /** Config/model management — required for CONFIG_SET and AUTH_LIST */
  modelConfig?: ModelConfig;
  /** Tool config management — required for TOOLS_LIST and TOOLS_SET */
  toolConfig?: ToolConfigManager;
  /** Provider manager — required for AUTH_* methods */
  providerManager?: ProviderManager;
  /** Open a URL in the browser — defaults to the built-in openBrowser from @diligent/core */
  openBrowser?: (url: string) => void;
  /** Convert an absolute image path to a URL for web clients (omit if not needed) */
  toImageUrl?: (absPath: string) => string | undefined;
}

/** @deprecated Use connect() instead */
export type NotificationListener = (notification: DiligentServerNotification) => void | Promise<void>;
/** @deprecated Use connect() instead */
export type ServerRequestHandler = (request: DiligentServerRequest) => Promise<DiligentServerRequestResponse>;

interface ConnectedPeer {
  id: string;
  peer: RpcPeer;
  subscriptions: Set<string>;
  currentThreadId: string | null;
  cwd: string;
  mode: Mode;
  effort: ThinkingEffort;
}

interface PendingServerRequest {
  method: string;
  resolve: (response: DiligentServerRequestResponse | null) => void;
  timeoutId: ReturnType<typeof setTimeout>;
  sentTo: Set<string>;
}

interface ThreadRuntime {
  id: string;
  cwd: string;
  mode: Mode;
  effort: ThinkingEffort;
  manager: SessionManager;
  abortController: AbortController | null;
  currentTurnId: string | null;
  isRunning: boolean;
  registry?: AgentRegistry;
}

export class DiligentAppServer {
  private readonly serverName: string;
  private readonly serverVersion: string;
  private readonly threads = new Map<string, ThreadRuntime>();
  private readonly knownCwds = new Set<string>();
  /** In-memory cache of thread summaries — updated immediately on create/message so THREAD_LIST never lags disk */
  private readonly threadSummaryCache = new Map<string, SessionSummary>();
  private activeThreadId: string | null = null;

  // New multi-connection infrastructure
  private readonly connections = new Map<string, ConnectedPeer>();
  private readonly subscriptionMap = new Map<string, { connectionId: string; threadId: string }>();
  private readonly turnInitiators = new Map<string, string>(); // threadId → connectionId
  private readonly pendingServerRequests = new Map<number, PendingServerRequest>();
  private serverRequestSeq = 0;

  // Deprecated backward-compat fields (used by rpc-bridge.ts and old tests)
  private notificationListener: NotificationListener | null = null;
  private serverRequestHandler: ServerRequestHandler | null = null;

  // Config/auth state
  private currentModelId: string | undefined;
  private oauthPending: Promise<void> | null = null;

  constructor(private readonly config: DiligentAppServerConfig) {
    this.serverName = config.serverName ?? "diligent-app-server";
    this.serverVersion = config.serverVersion ?? "0.0.1";
    this.knownCwds.add(config.cwd ?? process.cwd());
    this.currentModelId = config.modelConfig?.currentModelId;
  }

  // ─── New multi-connection API ───────────────────────────────────────────────

  connect(connectionId: string, peer: RpcPeer, options?: { cwd?: string; mode?: Mode }): () => void {
    const conn: ConnectedPeer = {
      id: connectionId,
      peer,
      subscriptions: new Set(),
      currentThreadId: null,
      cwd: options?.cwd ?? this.config.cwd ?? process.cwd(),
      mode: options?.mode ?? "default",
      effort: "medium",
    };
    this.connections.set(connectionId, conn);

    peer.onMessage(async (message) => {
      if (!this.connections.has(connectionId)) return;

      if (isRpcRequest(message)) {
        const response = await this.handleRequest(connectionId, message);
        await peer.send(response);
        return;
      }

      if (isRpcNotification(message)) {
        await this.handleNotification(message);
        return;
      }

      if (isRpcResponse(message)) {
        const reqId = typeof message.id === "number" ? message.id : parseInt(String(message.id), 10);
        if (Number.isNaN(reqId)) return;

        const pending = this.pendingServerRequests.get(reqId);
        if (!pending) return;

        clearTimeout(pending.timeoutId);
        this.pendingServerRequests.delete(reqId);

        // Notify other connections that this request was resolved
        for (const otherId of pending.sentTo) {
          if (otherId === connectionId) continue;
          const other = this.connections.get(otherId);
          if (other) {
            void other.peer.send({
              method: DILIGENT_SERVER_NOTIFICATION_METHODS.SERVER_REQUEST_RESOLVED,
              params: { requestId: reqId },
            });
          }
        }

        if ("error" in message) {
          pending.resolve(null);
          return;
        }

        const parsed = DiligentServerRequestResponseSchema.safeParse({
          method: pending.method,
          result: message.result,
        });
        pending.resolve(parsed.success ? parsed.data : null);
      }
    });

    peer.onClose?.(() => {
      this.disconnect(connectionId);
    });

    return () => this.disconnect(connectionId);
  }

  disconnect(connectionId: string): void {
    const conn = this.connections.get(connectionId);
    if (!conn) return;

    // Clean up subscriptions for this connection
    for (const [subId, sub] of this.subscriptionMap) {
      if (sub.connectionId === connectionId) {
        this.subscriptionMap.delete(subId);
      }
    }

    // Resolve pending server requests where this was the only remaining responder
    for (const [reqId, pending] of this.pendingServerRequests) {
      if (pending.sentTo.has(connectionId)) {
        pending.sentTo.delete(connectionId);
        if (pending.sentTo.size === 0) {
          clearTimeout(pending.timeoutId);
          this.pendingServerRequests.delete(reqId);
          pending.resolve(null);
        }
      }
    }

    this.connections.delete(connectionId);
  }

  subscribeToThread(connectionId: string, threadId: string): string {
    const conn = this.connections.get(connectionId);
    if (!conn) throw new Error(`Unknown connection: ${connectionId}`);
    const subscriptionId = `sub-${crypto.randomUUID().slice(0, 8)}`;
    conn.subscriptions.add(threadId);
    this.subscriptionMap.set(subscriptionId, { connectionId, threadId });
    return subscriptionId;
  }

  unsubscribeFromThread(subscriptionId: string): boolean {
    const sub = this.subscriptionMap.get(subscriptionId);
    if (!sub) return false;
    this.subscriptionMap.delete(subscriptionId);
    const conn = this.connections.get(sub.connectionId);
    if (conn) conn.subscriptions.delete(sub.threadId);
    return true;
  }

  // ─── Deprecated backward-compat API ────────────────────────────────────────

  /** @deprecated Use connect() instead */
  setNotificationListener(listener: NotificationListener | null): void {
    this.notificationListener = listener;
  }

  /** @deprecated Use connect() instead */
  setServerRequestHandler(handler: ServerRequestHandler | null): void {
    this.serverRequestHandler = handler;
  }

  // ─── Request handling ───────────────────────────────────────────────────────

  async handleRequest(connectionId: string, raw: unknown): Promise<JSONRPCResponse>;
  /** @deprecated Pass connectionId as first argument */
  async handleRequest(raw: unknown): Promise<JSONRPCResponse>;
  async handleRequest(connectionIdOrRaw: string | unknown, rawArg?: unknown): Promise<JSONRPCResponse> {
    const [connectionId, raw] =
      typeof connectionIdOrRaw === "string" && rawArg !== undefined
        ? [connectionIdOrRaw, rawArg]
        : ["_legacy", connectionIdOrRaw];

    const request = JSONRPCRequestSchema.safeParse(raw);
    if (!request.success) {
      return this.errorResponse("unknown", -32600, "Invalid Request", request.error.message);
    }

    const rawParams = (request.data.params ?? {}) as Record<string, unknown>;
    const params = this.applySessionDefaults(connectionId, request.data.method, rawParams);

    const parsed = DiligentClientRequestSchema.safeParse({
      method: request.data.method,
      params,
    });

    if (!parsed.success) {
      return this.errorResponse(request.data.id, -32602, "Invalid params", parsed.error.message);
    }

    try {
      const result = await this.dispatchClientRequest(connectionId, parsed.data);
      return JSONRPCResponseSchema.parse({ id: request.data.id, result });
    } catch (error) {
      const code =
        error instanceof Error && typeof (error as unknown as { code?: unknown }).code === "number"
          ? (error as unknown as { code: number }).code
          : -32000;
      const message = error instanceof Error ? error.message : String(error);
      return this.errorResponse(request.data.id, code, message);
    }
  }

  async handleNotification(raw: unknown): Promise<void> {
    const notification = JSONRPCRequestSchema.omit({ id: true }).safeParse(raw);
    if (!notification.success) {
      return;
    }

    if (notification.data.method === DILIGENT_CLIENT_NOTIFICATION_METHODS.INITIALIZED) {
      return;
    }
  }

  // ─── Session defaults injection ─────────────────────────────────────────────

  private applySessionDefaults(
    connectionId: string,
    method: string,
    params: Record<string, unknown>,
  ): Record<string, unknown> {
    const conn = this.connections.get(connectionId);
    if (!conn) return params;

    if (method === DILIGENT_CLIENT_REQUEST_METHODS.THREAD_START) {
      return {
        ...params,
        cwd: (params.cwd as string | undefined)?.length ? params.cwd : conn.cwd,
        mode: (params.mode as string | undefined) ?? conn.mode,
      };
    }

    const threadScoped: string[] = [
      DILIGENT_CLIENT_REQUEST_METHODS.TURN_START,
      DILIGENT_CLIENT_REQUEST_METHODS.TURN_INTERRUPT,
      DILIGENT_CLIENT_REQUEST_METHODS.TURN_STEER,
      DILIGENT_CLIENT_REQUEST_METHODS.MODE_SET,
      DILIGENT_CLIENT_REQUEST_METHODS.EFFORT_SET,
      DILIGENT_CLIENT_REQUEST_METHODS.THREAD_READ,
      DILIGENT_CLIENT_REQUEST_METHODS.KNOWLEDGE_LIST,
      DILIGENT_CLIENT_REQUEST_METHODS.TOOLS_LIST,
      DILIGENT_CLIENT_REQUEST_METHODS.TOOLS_SET,
    ];

    if (threadScoped.includes(method)) {
      const threadId = params.threadId as string | undefined;
      return {
        ...params,
        threadId: threadId?.length ? threadId : (conn.currentThreadId ?? undefined),
      };
    }

    return params;
  }

  // ─── Request dispatch ───────────────────────────────────────────────────────

  private async dispatchClientRequest(connectionId: string, request: DiligentClientRequest): Promise<unknown> {
    switch (request.method) {
      case DILIGENT_CLIENT_REQUEST_METHODS.INITIALIZE: {
        const extra = (await this.config.getInitializeResult?.()) ?? {};
        return {
          serverName: this.serverName,
          serverVersion: this.serverVersion,
          protocolVersion: 1,
          capabilities: {
            supportsFollowUp: true,
            supportsApprovals: true,
            supportsUserInput: true,
          },
          ...extra,
        };
      }

      case DILIGENT_CLIENT_REQUEST_METHODS.THREAD_START: {
        const result = await this.handleThreadStart(request.params);
        const conn = this.connections.get(connectionId);
        if (conn) conn.currentThreadId = result.threadId;
        return result;
      }

      case DILIGENT_CLIENT_REQUEST_METHODS.THREAD_RESUME: {
        const result = await this.handleThreadResume(request.params);
        const conn = this.connections.get(connectionId);
        if (conn && result.found && result.threadId) conn.currentThreadId = result.threadId;
        return result;
      }

      case DILIGENT_CLIENT_REQUEST_METHODS.THREAD_LIST:
        return this.handleThreadList(request.params.limit, request.params.includeChildren);

      case DILIGENT_CLIENT_REQUEST_METHODS.THREAD_READ:
        return this.handleThreadRead(request.params.threadId);

      case DILIGENT_CLIENT_REQUEST_METHODS.TURN_START:
        return this.handleTurnStart(request.params, connectionId);

      case DILIGENT_CLIENT_REQUEST_METHODS.TURN_INTERRUPT:
        return this.handleTurnInterrupt(request.params.threadId);

      case DILIGENT_CLIENT_REQUEST_METHODS.TURN_STEER:
        return this.handleTurnSteer(request.params.threadId, request.params.content, request.params.followUp);

      case DILIGENT_CLIENT_REQUEST_METHODS.MODE_SET:
        return this.handleModeSet(request.params.threadId, request.params.mode);

      case DILIGENT_CLIENT_REQUEST_METHODS.EFFORT_SET:
        return this.handleEffortSet(request.params.threadId, request.params.effort);

      case DILIGENT_CLIENT_REQUEST_METHODS.KNOWLEDGE_LIST:
        return this.handleKnowledgeList(request.params.threadId, request.params.limit);

      case DILIGENT_CLIENT_REQUEST_METHODS.THREAD_DELETE:
        return this.handleThreadDelete(request.params.threadId);

      case DILIGENT_CLIENT_REQUEST_METHODS.TOOLS_LIST:
        return this.handleToolsList(request.params.threadId);

      case DILIGENT_CLIENT_REQUEST_METHODS.TOOLS_SET:
        return this.handleToolsSet(request.params.threadId, request.params);

      case DILIGENT_CLIENT_REQUEST_METHODS.THREAD_SUBSCRIBE: {
        const subscriptionId = this.subscribeToThread(connectionId, request.params.threadId);
        return { subscriptionId };
      }

      case DILIGENT_CLIENT_REQUEST_METHODS.THREAD_UNSUBSCRIBE: {
        const ok = this.unsubscribeFromThread(request.params.subscriptionId);
        return { ok };
      }

      case DILIGENT_CLIENT_REQUEST_METHODS.CONFIG_SET: {
        const { model } = request.params;
        if (!model) return { model: this.currentModelId };
        const mc = this.config.modelConfig;
        if (!mc) throw Object.assign(new Error("Model config not available"), { code: -32601 });
        const valid = mc.getAvailableModels().find((m) => m.id === model);
        if (!valid) throw Object.assign(new Error(`Unknown model: ${model}`), { code: -32602 });
        this.currentModelId = model;
        mc.onModelChange(model);
        return { model };
      }

      case DILIGENT_CLIENT_REQUEST_METHODS.AUTH_LIST: {
        const pm = this.config.providerManager;
        const mc = this.config.modelConfig;
        if (!pm || !mc) throw Object.assign(new Error("Auth not available"), { code: -32601 });
        const providers = await this.buildProviderList();
        return { providers, availableModels: mc.getAvailableModels() };
      }

      case DILIGENT_CLIENT_REQUEST_METHODS.AUTH_SET: {
        const pm = this.config.providerManager;
        if (!pm) throw Object.assign(new Error("Auth not available"), { code: -32601 });
        await saveAuthKey(request.params.provider, request.params.apiKey);
        pm.setApiKey(request.params.provider, request.params.apiKey);
        const providers = await this.buildProviderList();
        await this.emit({
          method: DILIGENT_SERVER_NOTIFICATION_METHODS.ACCOUNT_UPDATED,
          params: { providers },
        });
        return { ok: true as const };
      }

      case DILIGENT_CLIENT_REQUEST_METHODS.AUTH_REMOVE: {
        const pm = this.config.providerManager;
        if (!pm) throw Object.assign(new Error("Auth not available"), { code: -32601 });
        await removeAuthKey(request.params.provider);
        pm.removeApiKey(request.params.provider);
        if (request.params.provider === "openai") {
          await removeOAuthTokens();
          pm.removeOAuthTokens();
        }
        const providers = await this.buildProviderList();
        await this.emit({
          method: DILIGENT_SERVER_NOTIFICATION_METHODS.ACCOUNT_UPDATED,
          params: { providers },
        });
        return { ok: true as const };
      }

      case DILIGENT_CLIENT_REQUEST_METHODS.AUTH_OAUTH_START: {
        const pm = this.config.providerManager;
        if (!pm) throw Object.assign(new Error("Auth not available"), { code: -32601 });
        if (this.oauthPending) throw Object.assign(new Error("OAuth flow already in progress"), { code: -32000 });
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
        const browser = this.config.openBrowser ?? defaultOpenBrowser;
        browser(authUrl);
        this.oauthPending = (async () => {
          try {
            const { code } = await waitForCallback(state, 5 * 60 * 1000);
            const rawTokens = await exchangeCodeForTokens(code, codeVerifier);
            const tokens = buildOAuthTokens(rawTokens);
            await saveOAuthTokens(tokens);
            pm.setOAuthTokens(tokens);
            await this.emit({
              method: DILIGENT_SERVER_NOTIFICATION_METHODS.ACCOUNT_LOGIN_COMPLETED,
              params: { loginId, success: true, error: null },
            });
            const providers = await this.buildProviderList();
            await this.emit({
              method: DILIGENT_SERVER_NOTIFICATION_METHODS.ACCOUNT_UPDATED,
              params: { providers },
            });
          } catch (e) {
            const error = e instanceof Error ? e.message : "OAuth flow failed";
            await this.emit({
              method: DILIGENT_SERVER_NOTIFICATION_METHODS.ACCOUNT_LOGIN_COMPLETED,
              params: { loginId, success: false, error },
            });
          } finally {
            this.oauthPending = null;
          }
        })();
        return { authUrl };
      }

      case DILIGENT_CLIENT_REQUEST_METHODS.IMAGE_UPLOAD: {
        const conn = this.connections.get(connectionId);
        const effectiveThreadId = request.params.threadId ?? conn?.currentThreadId ?? undefined;
        const attachment = await this.handleImageUpload(request.params, effectiveThreadId, conn?.cwd);
        return { attachment };
      }
    }
  }

  // ─── Thread management handlers ─────────────────────────────────────────────

  private async handleThreadStart(params: { cwd: string; mode?: Mode }): Promise<{ threadId: string }> {
    const mode = params.mode ?? "default";
    const tempId = generateSessionId();
    const effort = await this.getLatestEffortForCwd(params.cwd);
    const runtime = await this.createThreadRuntime(tempId, params.cwd, mode, true, effort);
    // Use manager's sessionId as canonical threadId so it matches on resume
    const threadId = runtime.manager.sessionId;
    runtime.id = threadId;

    this.threads.set(threadId, runtime);
    this.activeThreadId = threadId;
    this.knownCwds.add(params.cwd);

    // Immediately register in cache so THREAD_LIST returns it without waiting for disk flush
    const now = new Date().toISOString();
    this.threadSummaryCache.set(threadId, {
      id: threadId,
      path: "",
      cwd: params.cwd,
      created: now,
      modified: now,
      messageCount: 0,
    });

    await this.emit({ method: DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_STARTED, params: { threadId } });
    return { threadId };
  }

  private async handleThreadResume(params: {
    threadId?: string;
    mostRecent?: boolean;
  }): Promise<{ found: boolean; threadId?: string; context?: unknown[] }> {
    // If the thread is already loaded in memory (possibly running), return it directly.
    // Creating a new runtime would overwrite isRunning=true with isRunning=false.
    if (params.threadId) {
      const existing = this.threads.get(params.threadId);
      if (existing) {
        const context = existing.manager.getContext();
        this.activeThreadId = params.threadId;
        await this.emit({
          method: DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_RESUMED,
          params: { threadId: params.threadId, restoredMessages: context.length },
        });
        return { found: true, threadId: params.threadId, context };
      }
    }

    const candidateCwds = Array.from(this.knownCwds);

    for (const cwd of candidateCwds) {
      const placeholderId = params.threadId ?? generateSessionId();
      const runtime = await this.createThreadRuntime(
        placeholderId,
        cwd,
        "default",
        false,
        await this.getLatestEffortForCwd(cwd),
      );

      const resumed = await runtime.manager.resume({
        sessionId: params.threadId,
        mostRecent: params.mostRecent,
      });
      if (!resumed) continue;

      // After resume, the manager's sessionId reflects the actual session file.
      // Use that as the canonical thread ID (= session ID).
      const threadId = runtime.manager.sessionId;
      runtime.id = threadId;

      const context = runtime.manager.getContext();
      runtime.effort = runtime.manager.getCurrentEffort() ?? runtime.effort;
      this.threads.set(threadId, runtime);
      this.activeThreadId = threadId;

      await this.emit({
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_RESUMED,
        params: { threadId, restoredMessages: context.length },
      });

      return { found: true, threadId, context };
    }

    return { found: false };
  }

  private async handleThreadList(limit?: number, includeChildren?: boolean): Promise<{ data: SessionSummary[] }> {
    // Load from disk and populate cache for any entries not already tracked in memory.
    // In-memory entries take precedence — they're always at least as fresh as disk.
    for (const cwd of this.knownCwds) {
      const paths = await this.config.resolvePaths(cwd);
      const sessions = await listSessions(paths.sessions);
      for (const session of sessions) {
        if (!this.threadSummaryCache.has(session.id)) {
          this.threadSummaryCache.set(session.id, {
            id: session.id,
            path: session.path,
            cwd: session.cwd,
            name: session.name,
            created: session.created.toISOString(),
            modified: session.modified.toISOString(),
            messageCount: session.messageCount,
            firstUserMessage: session.firstUserMessage,
            parentSession: session.parentSession,
          });
        }
      }
    }

    let result = Array.from(this.threadSummaryCache.values());

    // Filter out sub-agent sessions by default
    if (!includeChildren) {
      result = result.filter((s) => !s.parentSession);
    }

    // Sort by modified descending so newest thread always appears first
    result.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

    return { data: result.slice(0, limit ?? 100) };
  }

  private async handleThreadRead(threadId?: string): Promise<{
    messages: unknown[];
    childSessions?: unknown[];
    hasFollowUp: boolean;
    entryCount: number;
    isRunning: boolean;
    currentEffort: ThinkingEffort;
  }> {
    const runtime = await this.resolveThreadRuntime(threadId);
    const paths = await this.config.resolvePaths(runtime.cwd);
    const sessionId = runtime.manager.sessionId;

    // Read child sessions (sub-agents spawned by this thread)
    const children = await readChildSessions(paths.sessions, sessionId);

    return {
      messages: runtime.manager.getContext(),
      childSessions: children.length > 0 ? children : undefined,
      hasFollowUp: runtime.manager.hasPendingMessages(),
      entryCount: runtime.manager.entryCount,
      isRunning: runtime.isRunning,
      currentEffort: runtime.manager.getCurrentEffort() ?? runtime.effort,
    };
  }

  private async handleTurnStart(params: TurnStartParams, connectionId?: string): Promise<{ accepted: true }> {
    const runtime = await this.resolveThreadRuntime(params.threadId);
    if (runtime.isRunning) throw new Error("A turn is already running for this thread");

    // Track which connection initiated this turn (for userMessage notification skip)
    if (connectionId) {
      this.turnInitiators.set(runtime.id, connectionId);
    }

    runtime.abortController = new AbortController();
    runtime.isRunning = true;
    const turnId = `turn-${crypto.randomUUID().slice(0, 8)}`;
    runtime.currentTurnId = turnId;

    await this.emit({
      method: DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_STATUS_CHANGED,
      params: { threadId: runtime.id, status: "busy" },
    });
    await this.emit({
      method: DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_STARTED,
      params: { threadId: runtime.id, turnId },
    });

    const timestamp = Date.now();
    const content =
      params.content && params.content.length > 0
        ? params.content
        : params.attachments && params.attachments.length > 0
          ? [
              ...((params.message.trim().length > 0 ? [{ type: "text", text: params.message }] : []) as Array<{
                type: "text";
                text: string;
              }>),
              ...params.attachments,
            ]
          : params.message;
    const userMessage = {
      role: "user" as const,
      content,
      timestamp,
    };

    // Immediately update cache with the new message — no need to wait for disk flush
    const cached = this.threadSummaryCache.get(runtime.id);
    if (cached) {
      this.threadSummaryCache.set(runtime.id, {
        ...cached,
        firstUserMessage: cached.firstUserMessage ?? summarizeUserPreview(content),
        messageCount: cached.messageCount + 1,
        modified: new Date().toISOString(),
      });
    }

    const userItemId = `msg-${crypto.randomUUID().slice(0, 8)}`;
    const userItem = { type: "userMessage" as const, itemId: userItemId, message: userMessage };
    await this.emit({
      method: DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_STARTED,
      params: { threadId: runtime.id, turnId, item: userItem },
    });
    await this.emit({
      method: DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_COMPLETED,
      params: { threadId: runtime.id, turnId, item: userItem },
    });

    const stream = runtime.manager.run(userMessage);
    void this.consumeStream(runtime, stream, turnId);

    return { accepted: true };
  }

  private async handleTurnInterrupt(threadId?: string): Promise<{ interrupted: boolean }> {
    const runtime = await this.resolveThreadRuntime(threadId);
    if (!runtime.isRunning || !runtime.abortController) {
      console.log(
        "[AppServer] turn/interrupt: no running turn for thread %s (isRunning=%s)",
        threadId,
        runtime.isRunning,
      );
      return { interrupted: false };
    }

    console.log("[AppServer] turn/interrupt: aborting thread %s", runtime.id);
    runtime.abortController.abort();
    return { interrupted: true };
  }

  private async handleTurnSteer(
    threadId: string | undefined,
    content: string,
    _followUp: boolean,
  ): Promise<{ queued: true }> {
    const runtime = await this.resolveThreadRuntime(threadId);
    // Unified queue — followUp and steer are now the same operation
    runtime.manager.steer(content);
    return { queued: true };
  }

  private async handleModeSet(threadId: string | undefined, mode: Mode): Promise<{ mode: Mode }> {
    const runtime = await this.resolveThreadRuntime(threadId);
    runtime.mode = mode;
    runtime.manager.appendModeChange(mode as ModeKind, "command");
    return { mode };
  }

  private async handleEffortSet(
    threadId: string | undefined,
    effort: ThinkingEffort,
  ): Promise<{ effort: ThinkingEffort }> {
    const runtime = await this.resolveThreadRuntime(threadId);
    runtime.effort = effort;
    runtime.manager.appendEffortChange(effort, "command");
    return { effort };
  }

  private async handleKnowledgeList(threadId: string | undefined, limit?: number): Promise<{ data: unknown[] }> {
    const runtime = await this.resolveThreadRuntime(threadId);
    const paths = await this.config.resolvePaths(runtime.cwd);
    const entries = await readKnowledge(paths.knowledge);
    return { data: entries.slice(0, limit ?? entries.length) };
  }

  private async handleThreadDelete(threadId: string): Promise<{ deleted: boolean }> {
    const existing = this.threads.get(threadId);
    if (existing?.isRunning) {
      throw new Error("Cannot delete a thread that is currently running");
    }

    // A thread that never had a message sent has no file on disk yet (DeferredWriter hasn't
    // flushed). Treat it as deleted as long as we know about it in memory.
    const knownInMemory = this.threadSummaryCache.has(threadId) || this.threads.has(threadId);

    let deletedFromDisk = false;
    for (const cwd of this.knownCwds) {
      const paths = await this.config.resolvePaths(cwd);
      const result = await deleteSession(paths.sessions, threadId);
      if (result) {
        deletedFromDisk = true;
        break;
      }
    }

    const deleted = deletedFromDisk || knownInMemory;
    if (deleted) {
      this.threads.delete(threadId);
      this.threadSummaryCache.delete(threadId);
      if (this.activeThreadId === threadId) {
        this.activeThreadId = null;
      }
    }

    return { deleted };
  }

  private async handleToolsList(threadId?: string): Promise<{
    configPath: string;
    appliesOnNextTurn: true;
    trustMode: "full_trust";
    conflictPolicy: ToolConflictPolicy;
    tools: ToolDescriptor[];
    plugins: PluginDescriptor[];
  }> {
    const { cwd, tools } = await this.resolveToolsContext(threadId);
    const paths = await this.config.resolvePaths(cwd);
    const result = await buildDefaultTools(cwd, paths, undefined, tools);

    return {
      configPath: getProjectConfigPath(cwd),
      appliesOnNextTurn: true,
      trustMode: "full_trust",
      conflictPolicy: (tools?.conflictPolicy ?? "error") as ToolConflictPolicy,
      tools: result.toolState,
      plugins: result.pluginState.map((plugin) => ({
        ...plugin,
        loadError: plugin.loadError,
      })),
    };
  }

  private async handleToolsSet(
    threadId: string | undefined,
    params: {
      builtin?: Record<string, boolean>;
      plugins?: Array<{ package: string; enabled?: boolean; tools?: Record<string, boolean>; remove?: boolean }>;
      conflictPolicy?: ToolConflictPolicy;
    },
  ): Promise<{
    configPath: string;
    appliesOnNextTurn: true;
    trustMode: "full_trust";
    conflictPolicy: ToolConflictPolicy;
    tools: ToolDescriptor[];
    plugins: PluginDescriptor[];
  }> {
    const manager = this.config.toolConfig;
    if (!manager) throw Object.assign(new Error("Tool config not available"), { code: -32601 });

    const { cwd } = await this.resolveToolsContext(threadId);
    const writeResult = await writeProjectToolsConfig(cwd, {
      builtin: params.builtin,
      plugins: params.plugins,
      conflictPolicy: params.conflictPolicy,
    });

    manager.setTools(writeResult.config.tools);

    const paths = await this.config.resolvePaths(cwd);
    const result = await buildDefaultTools(cwd, paths, undefined, writeResult.config.tools);

    return {
      configPath: writeResult.configPath,
      appliesOnNextTurn: true,
      trustMode: "full_trust",
      conflictPolicy: (writeResult.config.tools?.conflictPolicy ?? "error") as ToolConflictPolicy,
      tools: result.toolState,
      plugins: result.pluginState.map((plugin) => ({
        ...plugin,
        loadError: plugin.loadError,
      })),
    };
  }

  // ─── Stream consumption ─────────────────────────────────────────────────────

  private async consumeStream(
    runtime: ThreadRuntime,
    stream: ReturnType<SessionManager["run"]>,
    turnId: string,
  ): Promise<void> {
    // Wire collab events from any registry instance used during this turn into
    // the notification stream. A fresh AgentRegistry can appear on each
    // resolveAgentConfig() call, but previously spawned child agents may still
    // emit through older registry instances. Keep the handler attached to every
    // seen registry until the turn fully settles so child events are not dropped
    // after a turn-boundary registry refresh.
    const wiredRegistries = new Set<AgentRegistry>();
    const collabEventHandler = (event: AgentEvent) => {
      void this.emitFromAgentEvent(runtime.id, turnId, event);
    };
    const wireCollabHandler = () => {
      const currentRegistry = runtime.registry;
      if (!currentRegistry || wiredRegistries.has(currentRegistry)) return;
      currentRegistry.setCollabEventHandler(collabEventHandler);
      wiredRegistries.add(currentRegistry);
    };
    wireCollabHandler();

    let wasAborted = false;

    try {
      for await (const event of stream) {
        wireCollabHandler();
        await this.emitFromAgentEvent(runtime.id, turnId, event);
      }
      await stream.result();
      console.log("[AppServer] consumeStream: turn %s completed normally for thread %s", turnId, runtime.id);
      await this.emit({
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED,
        params: { threadId: runtime.id, turnId },
      });
    } catch (error) {
      const isAbort =
        (error instanceof Error && (error.name === "AbortError" || error.message === "Aborted")) ||
        runtime.abortController?.signal.aborted === true;

      if (isAbort) {
        wasAborted = true;
        console.log("[AppServer] consumeStream: turn %s interrupted (aborted) for thread %s", turnId, runtime.id);
        await this.emit({
          method: DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_INTERRUPTED,
          params: { threadId: runtime.id, turnId },
        });
      } else {
        console.error("[AppServer] consumeStream: turn %s error for thread %s:", turnId, runtime.id, error);
        await this.emit({
          method: DILIGENT_SERVER_NOTIFICATION_METHODS.ERROR,
          params: {
            threadId: runtime.id,
            error: {
              message: error instanceof Error ? error.message : String(error),
              name: error instanceof Error ? error.name : "Error",
            },
            fatal: false,
          },
        });
      }
    } finally {
      // Disconnect collab event handlers from every registry instance wired during this turn.
      for (const registry of wiredRegistries) {
        registry.setCollabEventHandler(undefined);
      }

      if (wasAborted) {
        // Abort path: release the thread immediately so new turns can start.
        // The abort signal prevents runSession from doing meaningful work,
        // so the zombie-loop risk is negligible.
        runtime.abortController = null;
        runtime.currentTurnId = null;
        runtime.isRunning = false;
        console.log("[AppServer] consumeStream: thread %s now idle (aborted)", runtime.id);
        await this.emit({
          method: DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_STATUS_CHANGED,
          params: { threadId: runtime.id, status: "idle" },
        });
        // Let innerWork settle in the background — don't block new turns
        stream.waitForInnerWork(5_000).catch(() => {});
      } else {
        // Normal path: wait for innerWork before clearing state
        await stream.waitForInnerWork(undefined).catch(() => {});
        runtime.abortController = null;
        runtime.currentTurnId = null;
        runtime.isRunning = false;
        console.log("[AppServer] consumeStream: thread %s now idle (normal)", runtime.id);
        await this.emit({
          method: DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_STATUS_CHANGED,
          params: { threadId: runtime.id, status: "idle" },
        });

        // Auto-submit pending messages only on normal completion
        const pendingMessages = runtime.manager.popPendingMessages();
        if (pendingMessages && pendingMessages.length > 0) {
          const message = pendingMessages.join("\n");
          await this.handleTurnStart({ threadId: runtime.id, message });
        }
      }
    }
  }

  private async emitFromAgentEvent(threadId: string, turnId: string, event: AgentEvent): Promise<void> {
    const notification = agentEventToNotification(threadId, turnId, event);
    if (notification) {
      await this.emit(notification);
    }
  }

  // ─── Notification routing ───────────────────────────────────────────────────

  private async emit(notification: DiligentServerNotification): Promise<void> {
    // Collab debugging: always-on server-side log for collab/* notifications.
    // Intentionally redact large prompt fields to avoid noisy logs.
    if (notification.method.startsWith("collab/")) {
      const params = notification.params as Record<string, unknown>;
      const safeParams: Record<string, unknown> = { ...params };
      if (typeof safeParams.prompt === "string") {
        const prompt = safeParams.prompt as string;
        safeParams.prompt = `${prompt.slice(0, 120)}${prompt.length > 120 ? "…" : ""}`;
        safeParams.promptLength = prompt.length;
      }
      console.log("[AppServer][collab] → client notification", {
        method: notification.method,
        params: safeParams,
      });
    }

    // Clear turn initiator when turn ends
    if (
      notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED ||
      notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_INTERRUPTED
    ) {
      const params = notification.params as { threadId?: string };
      if (params.threadId) this.turnInitiators.delete(params.threadId);
    }

    // Deprecated: backward-compat single listener (used by rpc-bridge.ts and old tests)
    if (this.notificationListener) {
      await this.notificationListener(notification);
    }

    // New: multi-connection routing
    if (this.connections.size === 0) return;

    const threadId = (notification.params as { threadId?: string } | undefined)?.threadId;

    if (!threadId) {
      // No threadId → broadcast to all connections
      for (const conn of this.connections.values()) {
        await conn.peer.send(notification);
      }
      return;
    }

    // Thread-scoped: route to subscribed connections; fallback to all if none subscribed
    const subscribers = [...this.connections.values()].filter((c) => c.subscriptions.has(threadId));
    const targets = subscribers.length > 0 ? subscribers : [...this.connections.values()];

    for (const conn of targets) {
      // Skip turn initiator for userMessage item notifications
      if (
        notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_STARTED ||
        notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_COMPLETED
      ) {
        const item = (notification.params as { item?: { type?: string } }).item;
        if (item?.type === "userMessage" && this.turnInitiators.get(threadId) === conn.id) {
          continue;
        }
      }
      await conn.peer.send(notification);
    }
  }

  // ─── Server request broadcasting ────────────────────────────────────────────

  private async broadcastServerRequest(method: string, params: unknown): Promise<DiligentServerRequestResponse | null> {
    if (this.connections.size === 0) return null;

    const id = ++this.serverRequestSeq;
    const sentTo = new Set<string>();

    return new Promise<DiligentServerRequestResponse | null>((resolve) => {
      const timeoutId = setTimeout(
        () => {
          this.pendingServerRequests.delete(id);
          resolve(null);
        },
        5 * 60 * 1000,
      );

      this.pendingServerRequests.set(id, { method, resolve, timeoutId, sentTo });

      for (const conn of this.connections.values()) {
        sentTo.add(conn.id);
        void conn.peer.send({ id, method, params });
      }
    });
  }

  private async requestApproval(threadId: string, request: ApprovalRequest): Promise<ApprovalResponse> {
    // New: broadcast to connections if any exist
    if (this.connections.size > 0) {
      const response = await this.broadcastServerRequest(DILIGENT_SERVER_REQUEST_METHODS.APPROVAL_REQUEST, {
        threadId,
        request,
      });
      if (!response) return "once";
      const parsed = DiligentServerRequestResponseSchema.safeParse(response);
      if (!parsed.success || parsed.data.method !== DILIGENT_SERVER_REQUEST_METHODS.APPROVAL_REQUEST) return "reject";
      return parsed.data.result.decision;
    }

    // Deprecated fallback: old single-handler approach
    if (!this.serverRequestHandler) return "once";
    const response = await this.serverRequestHandler({
      method: DILIGENT_SERVER_REQUEST_METHODS.APPROVAL_REQUEST,
      params: { threadId, request },
    });
    const parsed = DiligentServerRequestResponseSchema.safeParse(response);
    if (!parsed.success || parsed.data.method !== DILIGENT_SERVER_REQUEST_METHODS.APPROVAL_REQUEST) return "reject";
    return parsed.data.result.decision;
  }

  private async requestUserInput(threadId: string, request: UserInputRequest): Promise<UserInputResponse> {
    // New: broadcast to connections if any exist
    if (this.connections.size > 0) {
      const response = await this.broadcastServerRequest(DILIGENT_SERVER_REQUEST_METHODS.USER_INPUT_REQUEST, {
        threadId,
        request,
      });
      if (!response) return { answers: {} };
      const parsed = DiligentServerRequestResponseSchema.safeParse(response);
      if (!parsed.success || parsed.data.method !== DILIGENT_SERVER_REQUEST_METHODS.USER_INPUT_REQUEST)
        return { answers: {} };
      return parsed.data.result;
    }

    // Deprecated fallback: old single-handler approach
    if (!this.serverRequestHandler) return { answers: {} };
    const response = await this.serverRequestHandler({
      method: DILIGENT_SERVER_REQUEST_METHODS.USER_INPUT_REQUEST,
      params: { threadId, request },
    });
    const parsed = DiligentServerRequestResponseSchema.safeParse(response);
    if (!parsed.success || parsed.data.method !== DILIGENT_SERVER_REQUEST_METHODS.USER_INPUT_REQUEST)
      return { answers: {} };
    return parsed.data.result;
  }

  // ─── Thread runtime utilities ────────────────────────────────────────────────

  private async createThreadRuntime(
    threadId: string,
    cwd: string,
    mode: Mode,
    createNew: boolean,
    effort: ThinkingEffort = "medium",
  ): Promise<ThreadRuntime> {
    const runtime: ThreadRuntime = {
      id: threadId,
      cwd,
      mode,
      effort,
      manager: null as unknown as SessionManager,
      abortController: null,
      currentTurnId: null,
      isRunning: false,
    };

    const paths = await this.config.resolvePaths(cwd);
    runtime.manager = new SessionManager({
      cwd,
      paths,
      agentConfig: async () => {
        const signal = runtime.abortController?.signal ?? new AbortController().signal;
        const result = await this.config.buildAgentConfig({
          cwd,
          mode: runtime.mode,
          effort: runtime.effort,
          signal,
          approve: (request) => this.requestApproval(runtime.id, request),
          ask: (request) => this.requestUserInput(runtime.id, request),
          getSessionId: () => runtime.manager.sessionId,
        });
        result.debugThreadId = runtime.id;
        result.debugTurnId = runtime.currentTurnId ?? undefined;
        if (result.registry) {
          runtime.registry = result.registry;
          // Restore thread IDs from session history so collab tools work after server restart
          for (const agent of runtime.manager.getHistoricalCollabAgents()) {
            result.registry.restoreAgent(agent.threadId, agent.nickname);
          }
        }
        return result;
      },
      compaction: this.config.compaction,
      knowledgePath: paths.knowledge,
    });

    if (createNew) {
      await runtime.manager.create();
    }

    return runtime;
  }

  private async resolveThreadRuntime(threadId?: string): Promise<ThreadRuntime> {
    const id = threadId ?? this.activeThreadId;
    if (!id) {
      throw new Error("No active thread");
    }

    const existing = this.threads.get(id);
    if (existing) {
      return existing;
    }

    for (const cwd of this.knownCwds) {
      const runtime = await this.createThreadRuntime(id, cwd, "default", false, await this.getLatestEffortForCwd(cwd));
      const resumed = await runtime.manager.resume({ sessionId: id });
      if (!resumed) continue;

      runtime.effort = runtime.manager.getCurrentEffort() ?? runtime.effort;
      this.threads.set(id, runtime);
      this.activeThreadId = id;
      return runtime;
    }

    throw new Error(`Thread not found: ${id}`);
  }

  private async getLatestEffortForCwd(cwd: string): Promise<ThinkingEffort> {
    const candidates = new Map<string, SessionSummary>();

    for (const summary of this.threadSummaryCache.values()) {
      if (summary.cwd === cwd) {
        candidates.set(summary.id, summary);
      }
    }

    const paths = await this.config.resolvePaths(cwd);
    const sessions = await listSessions(paths.sessions);
    for (const session of sessions) {
      const summary: SessionSummary = {
        id: session.id,
        path: session.path,
        cwd: session.cwd,
        name: session.name,
        created: session.created.toISOString(),
        modified: session.modified.toISOString(),
        messageCount: session.messageCount,
        firstUserMessage: session.firstUserMessage,
        parentSession: session.parentSession,
      };
      this.threadSummaryCache.set(session.id, summary);
      if (session.cwd === cwd) {
        candidates.set(session.id, summary);
      }
    }

    const ordered = Array.from(candidates.values()).sort(
      (a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime(),
    );

    for (const summary of ordered) {
      const runtime = this.threads.get(summary.id);
      const runtimeEffort = runtime?.manager.getCurrentEffort() ?? runtime?.effort;
      if (runtimeEffort) {
        return runtimeEffort;
      }

      if (!summary.path) {
        continue;
      }

      try {
        const { entries } = await readSessionFile(summary.path);
        const leafId = entries.length > 0 ? entries[entries.length - 1].id : null;
        const effort = buildSessionContext(entries, leafId).currentEffort;
        if (effort) {
          return effort;
        }
      } catch {
        // Ignore unreadable session files and continue to older candidates.
      }
    }

    return "medium";
  }

  private async resolveToolsContext(
    threadId?: string,
  ): Promise<{ cwd: string; tools: DiligentConfig["tools"] | undefined }> {
    const manager = this.config.toolConfig;
    if (!manager) throw Object.assign(new Error("Tool config not available"), { code: -32601 });

    if (threadId || this.activeThreadId) {
      const runtime = await this.resolveThreadRuntime(threadId);
      return {
        cwd: runtime.cwd,
        tools: manager.getTools(),
      };
    }

    const cwd = this.config.cwd ?? process.cwd();
    this.knownCwds.add(cwd);
    return {
      cwd,
      tools: manager.getTools(),
    };
  }

  // ─── Auth / config helpers ───────────────────────────────────────────────────

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

  // ─── Image upload helper ─────────────────────────────────────────────────────

  private async handleImageUpload(
    params: { fileName: string; mediaType: string; dataBase64: string },
    threadId?: string,
    cwd?: string,
  ): Promise<{ type: "local_image"; path: string; mediaType: string; fileName: string; webUrl?: string }> {
    const baseCwd = cwd ?? this.config.cwd ?? process.cwd();
    const root = threadId
      ? join(baseCwd, ".diligent", "images", threadId)
      : join(baseCwd, ".diligent", "images", "drafts");
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

    if (buffer.length === 0) throw new Error("Empty image payload");
    if (buffer.length > 10 * 1024 * 1024) throw new Error("Image exceeds 10 MB limit");

    await Bun.write(absPath, buffer);

    const webUrl = this.config.toImageUrl?.(absPath);
    return { type: "local_image", path: absPath, mediaType: params.mediaType, fileName: params.fileName, webUrl };
  }

  private errorResponse(
    id: string | number | "unknown",
    code: number,
    message: string,
    data?: unknown,
  ): JSONRPCErrorResponse {
    return JSONRPCErrorResponseSchema.parse({
      id: id === "unknown" ? "unknown" : id,
      error: { code, message, data },
    });
  }
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

function summarizeUserPreview(content: string | unknown[]): string | undefined {
  if (typeof content === "string") {
    const trimmed = content.trim();
    return trimmed ? trimmed.slice(0, 100) : undefined;
  }

  const text = content
    .filter((block): block is { type: "text"; text: string } => {
      return typeof block === "object" && block !== null && "type" in block && block.type === "text" && "text" in block;
    })
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 100);
  if (text) return text;

  const imageCount = content.filter(
    (block) => typeof block === "object" && block !== null && "type" in block && block.type === "local_image",
  ).length;
  return imageCount > 0 ? `[image${imageCount > 1 ? "s" : ""}]` : undefined;
}
