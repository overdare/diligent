// @summary JSON-RPC app server mapping SessionManager/AgentEvent to shared protocol requests and notifications

import { KNOWN_MODELS, resolveModel } from "@diligent/core/llm/models";
import type { ProviderManager } from "@diligent/core/llm/provider-manager";
import { supportsThinkingNone } from "@diligent/core/llm/thinking-effort";
import type { RuntimeAgent } from "../agent/runtime-agent";
import type { AgentEvent } from "../agent-event";
import type { ApprovalRequest, ApprovalResponse, PermissionEngine } from "../approval/types";
import type { DiligentConfig } from "../config/schema";
import type { DiligentPaths } from "../infrastructure";
import {
  DILIGENT_CLIENT_NOTIFICATION_METHODS,
  DILIGENT_CLIENT_REQUEST_METHODS,
  DILIGENT_SERVER_NOTIFICATION_METHODS,
  DILIGENT_VERSION,
  type DiligentClientRequest,
  DiligentClientRequestSchema,
  type DiligentServerNotification,
  type JSONRPCErrorResponse,
  JSONRPCErrorResponseSchema,
  JSONRPCRequestSchema,
  type JSONRPCResponse,
  JSONRPCResponseSchema,
  type Mode,
  type ModelInfo,
  type ThinkingEffort,
  type ToolConflictPolicy,
  type TurnStartParams,
} from "../protocol/index";
import { isRpcNotification, isRpcRequest, isRpcResponse, type RpcPeer } from "../rpc/channel";
import { SessionManager, type SessionManagerConfig } from "../session/manager";
import type { UserInputRequest, UserInputResponse } from "../tools/user-input-types";
import {
  buildProviderList,
  handleAuthOAuthStart,
  handleAuthRemove,
  handleAuthSet,
  handleConfigSet,
  handleImageUpload,
} from "./config-handlers";
import { agentEventToNotification } from "./event-mapper";
import {
  handleKnowledgeAdd,
  handleKnowledgeDelete,
  handleKnowledgeList,
  handleKnowledgeUpdate,
} from "./knowledge-handlers";
import {
  handleServerResponseMessage,
  type PendingServerRequest,
  requestApprovalFromConnections,
  requestUserInputFromConnections,
} from "./server-requests";
import {
  getLatestEffortFromSessions,
  handleEffortSet,
  handleModeSet,
  handleThreadCompactStart,
  handleThreadDelete,
  handleThreadList,
  handleThreadRead,
  handleThreadResume,
  handleThreadStart,
  handleToolsList,
  handleToolsSet,
  handleTurnInterrupt,
  handleTurnStart,
  handleTurnSteer,
  type ThreadRuntime,
} from "./thread-handlers";

export interface ModelConfig {
  currentModelId: string | undefined;
  getAvailableModels: () => ModelInfo[];
  onModelChange: (modelId: string, threadId?: string) => void;
}

export interface ToolConfigManager {
  getTools: () => DiligentConfig["tools"] | undefined;
  setTools: (tools: DiligentConfig["tools"] | undefined) => void;
}

export interface CreateAgentArgs {
  cwd: string;
  mode: Mode;
  effort: ThinkingEffort;
  modelId: string;
  approve: (request: ApprovalRequest) => Promise<ApprovalResponse>;
  ask: (request: UserInputRequest) => Promise<UserInputResponse>;
  /** Lazily returns the current session ID for collab parent-session linking. */
  getSessionId?: () => string | undefined;
  /** The thread's current agent, if one already exists. Passed so createAgent can reuse the registry. */
  existingAgent?: RuntimeAgent;
}

export interface DiligentAppServerConfig {
  serverName?: string;
  serverVersion?: string;
  cwd?: string;
  getInitializeResult?: () => Record<string, unknown> | Promise<Record<string, unknown>>;
  resolvePaths: (cwd: string) => Promise<DiligentPaths>;
  createAgent: (args: CreateAgentArgs) => RuntimeAgent | Promise<RuntimeAgent>;
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
  /** Loaded skill names for slash-command disambiguation in turn/start. */
  skillNames?: string[];
  /** Default effort from config (defaults to "medium") */
  defaultEffort?: ThinkingEffort;
  /** Permission policy engine loaded from runtime config (yolo/rules). */
  permissionEngine?: PermissionEngine;
}

interface ConnectedPeer {
  id: string;
  peer: RpcPeer;
  subscriptions: Set<string>;
  currentThreadId: string | null;
  cwd: string;
  mode: Mode;
  effort: ThinkingEffort;
}

export class DiligentAppServer {
  private readonly serverName: string;
  private readonly serverVersion: string;
  private readonly threads = new Map<string, ThreadRuntime>();
  private readonly knownCwds = new Set<string>();
  private activeThreadId: string | null = null;

  // New multi-connection infrastructure
  private readonly connections = new Map<string, ConnectedPeer>();
  private readonly subscriptionMap = new Map<string, { connectionId: string; threadId: string }>();
  private readonly turnInitiators = new Map<string, string>(); // threadId → connectionId
  private readonly pendingServerRequests = new Map<number, PendingServerRequest>();
  private serverRequestSeq = 0;

  // Config/auth state
  private currentModelId: string | undefined;
  private oauthPending: Promise<void> | null = null;

  constructor(private readonly config: DiligentAppServerConfig) {
    this.serverName = config.serverName ?? "diligent-app-server";
    this.serverVersion = config.serverVersion ?? DILIGENT_VERSION;
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
      effort: this.config.defaultEffort ?? "medium",
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
        await handleServerResponseMessage({
          connectionId,
          message,
          pendingServerRequests: this.pendingServerRequests,
          getConnectionById: (id) => this.connections.get(id),
        });
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

  // ─── Request handling ───────────────────────────────────────────────────────

  async handleRequest(connectionId: string, raw: unknown): Promise<JSONRPCResponse> {
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
      DILIGENT_CLIENT_REQUEST_METHODS.THREAD_COMPACT_START,
      DILIGENT_CLIENT_REQUEST_METHODS.MODE_SET,
      DILIGENT_CLIENT_REQUEST_METHODS.EFFORT_SET,
      DILIGENT_CLIENT_REQUEST_METHODS.THREAD_READ,
      DILIGENT_CLIENT_REQUEST_METHODS.KNOWLEDGE_LIST,
      DILIGENT_CLIENT_REQUEST_METHODS.KNOWLEDGE_ADD,
      DILIGENT_CLIENT_REQUEST_METHODS.KNOWLEDGE_UPDATE,
      DILIGENT_CLIENT_REQUEST_METHODS.KNOWLEDGE_DELETE,
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

      case DILIGENT_CLIENT_REQUEST_METHODS.THREAD_COMPACT_START:
        return this.handleThreadCompactStart(request.params.threadId);

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

      case DILIGENT_CLIENT_REQUEST_METHODS.KNOWLEDGE_ADD:
        return this.handleKnowledgeAdd(request.params.threadId, request.params);

      case DILIGENT_CLIENT_REQUEST_METHODS.KNOWLEDGE_UPDATE:
        return this.handleKnowledgeUpdate(request.params.threadId, request.params);

      case DILIGENT_CLIENT_REQUEST_METHODS.KNOWLEDGE_DELETE:
        return this.handleKnowledgeDelete(request.params.threadId, request.params.id);

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
        const connectionThreadId = this.connections.get(connectionId)?.currentThreadId ?? undefined;
        const targetThreadId = request.params.threadId ?? connectionThreadId;
        const result = await handleConfigSet(
          this.config.modelConfig,
          this.currentModelId,
          request.params.model,
          targetThreadId,
        );
        if (targetThreadId && result.model) {
          const runtime = await this.resolveThreadRuntime(targetThreadId);
          if (runtime.modelId !== result.model) {
            runtime.modelId = result.model;
            const model = resolveModel(result.model);
            runtime.agent?.setModel(result.model);
            if (runtime.effort === "none" && !supportsThinkingNone(model)) {
              runtime.effort = "medium";
              runtime.agent?.setEffort("medium");
              runtime.manager.appendEffortChange("medium", "config");
            }
            runtime.manager.appendModelChange(model.provider, model.id);
          }
        } else {
          this.currentModelId = result.model;
        }
        return result;
      }

      case DILIGENT_CLIENT_REQUEST_METHODS.AUTH_LIST: {
        const pm = this.config.providerManager;
        const mc = this.config.modelConfig;
        if (!pm || !mc) throw Object.assign(new Error("Auth not available"), { code: -32601 });
        const providers = await buildProviderList();
        return { providers, availableModels: mc.getAvailableModels() };
      }

      case DILIGENT_CLIENT_REQUEST_METHODS.AUTH_SET:
        return handleAuthSet(this.config.providerManager, request.params, (notification) => this.emit(notification));

      case DILIGENT_CLIENT_REQUEST_METHODS.AUTH_REMOVE:
        return handleAuthRemove(this.config.providerManager, request.params, (notification) => this.emit(notification));

      case DILIGENT_CLIENT_REQUEST_METHODS.AUTH_OAUTH_START:
        return handleAuthOAuthStart({
          providerManager: this.config.providerManager,
          oauthPending: this.oauthPending,
          setOAuthPending: (value) => {
            this.oauthPending = value;
          },
          openBrowser: this.config.openBrowser,
          emit: (notification) => this.emit(notification),
        });

      case DILIGENT_CLIENT_REQUEST_METHODS.IMAGE_UPLOAD: {
        const conn = this.connections.get(connectionId);
        const effectiveThreadId = request.params.threadId ?? conn?.currentThreadId ?? undefined;
        const attachment = await handleImageUpload({
          params: request.params,
          threadId: effectiveThreadId,
          cwd: conn?.cwd ?? this.config.cwd ?? process.cwd(),
          toImageUrl: this.config.toImageUrl,
        });
        return { attachment };
      }
    }
  }

  // ─── Thread management handlers ─────────────────────────────────────────────

  private async handleThreadStart(params: { cwd: string; mode?: Mode; model?: string }): Promise<{ threadId: string }> {
    return handleThreadStart(this.buildThreadHandlersContext(), params);
  }

  private async handleThreadResume(params: {
    threadId?: string;
    mostRecent?: boolean;
  }): Promise<{ found: boolean; threadId?: string; context?: unknown[] }> {
    return handleThreadResume(this.buildThreadHandlersContext(), params);
  }

  private async handleThreadList(limit?: number, includeChildren?: boolean) {
    return handleThreadList(this.buildThreadHandlersContext(), limit, includeChildren);
  }

  private async handleThreadRead(threadId?: string) {
    return handleThreadRead(this.buildThreadHandlersContext(), threadId);
  }

  private async handleThreadCompactStart(threadId?: string) {
    return handleThreadCompactStart(this.buildThreadHandlersContext(), threadId);
  }

  private async handleTurnStart(params: TurnStartParams, connectionId?: string): Promise<{ accepted: true }> {
    return handleTurnStart(this.buildThreadHandlersContext(), params, connectionId, this.turnInitiators);
  }

  private async handleTurnInterrupt(threadId?: string): Promise<{ interrupted: boolean }> {
    return handleTurnInterrupt(this.buildThreadHandlersContext(), threadId);
  }

  private async handleTurnSteer(
    threadId: string | undefined,
    content: string,
    _followUp: boolean,
  ): Promise<{ queued: true }> {
    return handleTurnSteer(this.buildThreadHandlersContext(), threadId, content);
  }

  private async handleModeSet(threadId: string | undefined, mode: Mode): Promise<{ mode: Mode }> {
    return handleModeSet(this.buildThreadHandlersContext(), threadId, mode);
  }

  private async handleEffortSet(
    threadId: string | undefined,
    effort: ThinkingEffort,
  ): Promise<{ effort: ThinkingEffort }> {
    return handleEffortSet(this.buildThreadHandlersContext(), threadId, effort);
  }

  private async handleKnowledgeList(threadId: string | undefined, limit?: number): Promise<{ data: unknown[] }> {
    return handleKnowledgeList(this.buildThreadHandlersContext(), threadId, limit);
  }

  private async handleKnowledgeAdd(
    threadId: string | undefined,
    params: {
      type: "pattern" | "decision" | "discovery" | "preference" | "correction";
      content: string;
      confidence?: number;
      tags?: string[];
    },
  ): Promise<{ entry: unknown }> {
    return handleKnowledgeAdd(this.buildThreadHandlersContext(), threadId, params);
  }

  private async handleKnowledgeUpdate(
    threadId: string | undefined,
    params: {
      id: string;
      type: "pattern" | "decision" | "discovery" | "preference" | "correction";
      content: string;
      confidence: number;
      tags?: string[];
    },
  ): Promise<{ entry: unknown }> {
    return handleKnowledgeUpdate(this.buildThreadHandlersContext(), threadId, params);
  }

  private async handleKnowledgeDelete(threadId: string | undefined, id: string): Promise<{ deleted: boolean }> {
    return handleKnowledgeDelete(this.buildThreadHandlersContext(), threadId, id);
  }

  private async handleThreadDelete(threadId: string): Promise<{ deleted: boolean }> {
    return handleThreadDelete(this.buildThreadHandlersContext(), threadId);
  }

  private async handleToolsList(threadId?: string) {
    return handleToolsList(this.buildThreadHandlersContext(), threadId);
  }

  private async handleToolsSet(
    threadId: string | undefined,
    params: {
      builtin?: Record<string, boolean>;
      plugins?: Array<{ package: string; enabled?: boolean; tools?: Record<string, boolean>; remove?: boolean }>;
      conflictPolicy?: ToolConflictPolicy;
    },
  ) {
    const manager = this.config.toolConfig;
    if (!manager) throw Object.assign(new Error("Tool config not available"), { code: -32601 });
    return handleToolsSet(this.buildThreadHandlersContext(), manager, threadId, params);
  }

  // ─── Turn consumption ────────────────────────────────────────────────────────

  private async consumeTurn(runtime: ThreadRuntime, runPromise: Promise<void>, turnId: string): Promise<void> {
    // Wire collab events from the registry into the notification stream.
    const wiredRegistries = new Set<import("../collab/registry").AgentRegistry>();
    const collabEventHandler = (event: AgentEvent) => {
      void this.emitFromAgentEvent(runtime.id, turnId, event);
    };
    const wireCollabHandler = () => {
      const currentRegistry = runtime.agent?.registry;
      if (!currentRegistry || wiredRegistries.has(currentRegistry)) return;
      currentRegistry.setCollabEventHandler(collabEventHandler);
      wiredRegistries.add(currentRegistry);
    };

    // Subscribe to manager events BEFORE awaiting so we don't miss early events.
    // Wire collab handler on each event — the agent (and its registry) is created
    // lazily inside manager.run(), so we wire as soon as it becomes available.
    const unsub = runtime.manager.subscribe((event) => {
      wireCollabHandler();
      void this.emitFromAgentEvent(runtime.id, turnId, event);
    });

    let wasAborted = false;

    try {
      await runPromise;
      wireCollabHandler(); // wire any registry created during the run
      // Ensure all session entries are durably persisted before signaling completion.
      await runtime.manager.waitForWrites();
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
        await this.emit({
          method: DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_INTERRUPTED,
          params: { threadId: runtime.id, turnId },
        });
      } else {
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
      unsub();
      // Disconnect collab event handlers from every registry instance wired during this turn.
      for (const registry of wiredRegistries) {
        registry.setCollabEventHandler(undefined);
      }

      runtime.abortController = null;
      runtime.runningEffortSnapshot = undefined;
      runtime.runningModelIdSnapshot = undefined;
      runtime.currentTurnId = null;
      runtime.isRunning = false;
      await this.emit({
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_STATUS_CHANGED,
        params: { threadId: runtime.id, status: "idle" },
      });

      // Auto-submit any pending steer messages (both abort and normal paths)
      const pending = runtime.manager.popPendingMessages();
      if (pending && pending.length > 0) {
        const message = pending.join("\n");
        await this.handleTurnStart({ threadId: runtime.id, message });
      }
    }
  }

  private async emitFromAgentEvent(threadId: string, turnId: string, event: AgentEvent): Promise<void> {
    const runtime = this.threads.get(threadId);
    const notification = agentEventToNotification(threadId, turnId, event, {
      model: runtime?.agent?.model,
      threadStatus: runtime?.isRunning === true ? "busy" : undefined,
    });
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
    }

    // Clear turn initiator when turn ends
    if (
      notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED ||
      notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_INTERRUPTED
    ) {
      const params = notification.params as { threadId?: string };
      if (params.threadId) this.turnInitiators.delete(params.threadId);
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

  private allocateServerRequestId(): number {
    this.serverRequestSeq += 1;
    return this.serverRequestSeq;
  }

  private async requestApproval(threadId: string, request: ApprovalRequest): Promise<ApprovalResponse> {
    const policyAction = this.config.permissionEngine?.evaluate(request);
    if (policyAction === "allow") {
      return "once";
    }
    if (policyAction === "deny") {
      return "reject";
    }

    const decision = await requestApprovalFromConnections({
      threadId,
      request,
      connections: this.connections,
      pendingServerRequests: this.pendingServerRequests,
      allocateServerRequestId: () => this.allocateServerRequestId(),
    });

    if (decision === "always") {
      this.config.permissionEngine?.remember(request, "allow");
    }

    return decision;
  }

  private async requestUserInput(threadId: string, request: UserInputRequest): Promise<UserInputResponse> {
    return requestUserInputFromConnections({
      threadId,
      request,
      connections: this.connections,
      pendingServerRequests: this.pendingServerRequests,
      allocateServerRequestId: () => this.allocateServerRequestId(),
    });
  }

  // ─── Thread runtime utilities ────────────────────────────────────────────────

  private async createThreadRuntime(
    threadId: string,
    cwd: string,
    mode: Mode,
    createNew: boolean,
    effort: ThinkingEffort = this.config.defaultEffort ?? "medium",
    modelId?: string,
  ): Promise<ThreadRuntime> {
    const runtime: ThreadRuntime = {
      id: threadId,
      cwd,
      mode,
      effort,
      modelId: modelId ?? this.currentModelId ?? KNOWN_MODELS[0].id,
      runningEffortSnapshot: undefined,
      runningModelIdSnapshot: undefined,
      manager: null as unknown as SessionManager,
      abortController: null,
      currentTurnId: null,
      isRunning: false,
    };

    const paths = await this.config.resolvePaths(cwd);
    runtime.manager = new SessionManager({
      cwd,
      paths,
      agent: async () => {
        if (!runtime.agent) {
          const newAgent = await this.config.createAgent({
            cwd,
            mode: runtime.mode,
            effort: runtime.runningEffortSnapshot ?? runtime.effort,
            modelId: runtime.runningModelIdSnapshot ?? runtime.modelId,
            approve: (request) => this.requestApproval(runtime.id, request),
            ask: (request) => this.requestUserInput(runtime.id, request),
            getSessionId: () => runtime.manager.sessionId,
            existingAgent: runtime.agent,
          });
          runtime.agent = newAgent;
          for (const histAgent of runtime.manager.getHistoricalCollabAgents()) {
            newAgent.registry?.restoreAgent(histAgent.threadId, histAgent.nickname);
          }
        }
        return runtime.agent;
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
    if (!id) throw new Error("No active thread");

    const existing = this.threads.get(id);
    if (existing) {
      return existing;
    }

    for (const cwd of this.knownCwds) {
      const runtime = await this.createThreadRuntime(id, cwd, "default", false, await this.getLatestEffortForCwd(cwd));
      const resumed = await runtime.manager.resume({ sessionId: id });
      if (!resumed) continue;

      runtime.effort = runtime.manager.getCurrentEffort() ?? runtime.effort;
      runtime.modelId = runtime.manager.getCurrentModel()?.modelId ?? runtime.modelId;
      this.threads.set(id, runtime);
      this.activeThreadId = id;

      return runtime;
    }

    throw new Error(`Thread not found: ${id}`);
  }

  private async getLatestEffortForCwd(cwd: string): Promise<ThinkingEffort> {
    const fallback = this.config.defaultEffort ?? "medium";
    return getLatestEffortFromSessions(this.config.resolvePaths, this.threads, cwd, fallback);
  }

  private async resolveToolsContext(
    threadId?: string,
  ): Promise<{ cwd: string; tools: DiligentConfig["tools"] | undefined }> {
    const manager = this.config.toolConfig;
    if (!manager) throw Object.assign(new Error("Tool config not available"), { code: -32601 });

    if (threadId || this.activeThreadId) {
      const runtime = await this.resolveThreadRuntime(threadId);
      return { cwd: runtime.cwd, tools: manager.getTools() };
    }

    const cwd = this.config.cwd ?? process.cwd();
    this.knownCwds.add(cwd);
    return { cwd, tools: manager.getTools() };
  }

  private buildThreadHandlersContext() {
    return {
      activeThreadId: this.activeThreadId,
      threads: this.threads,
      knownCwds: this.knownCwds,
      resolvePaths: this.config.resolvePaths,
      createThreadRuntime: (
        threadId: string,
        cwd: string,
        mode: Mode,
        createNew: boolean,
        effort?: ThinkingEffort,
        modelId?: string,
      ) => this.createThreadRuntime(threadId, cwd, mode, createNew, effort, modelId),
      resolveThreadRuntime: (threadId?: string) => this.resolveThreadRuntime(threadId),
      getLatestEffortForCwd: (cwd: string) => this.getLatestEffortForCwd(cwd),
      emit: (notification: DiligentServerNotification) => this.emit(notification),
      consumeTurn: (runtime: ThreadRuntime, runPromise: Promise<void>, turnId: string) =>
        this.consumeTurn(runtime, runPromise, turnId),
      resolveToolsContext: (threadId?: string) => this.resolveToolsContext(threadId),
      getSkillNames: () => this.getSkillNames(),
      setActiveThreadId: (threadId: string | null) => {
        this.activeThreadId = threadId;
      },
    };
  }

  private getSkillNames(): string[] {
    return this.config.skillNames ?? [];
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

function summarizeSessionTail(messages: ReturnType<SessionManager["getContext"]>): string {
  const last = messages[messages.length - 1];
  if (!last) return "none";
  if (last.role === "tool_result") return `tool_result:${last.toolName}:error=${last.isError}`;
  if (last.role === "assistant") {
    const blockTypes = last.content.map((block) => block.type).join(",") || "-";
    return `assistant:stop=${last.stopReason}:blocks=${blockTypes}`;
  }
  return last.role;
}
