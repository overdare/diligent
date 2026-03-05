// @summary JSON-RPC app server mapping SessionManager/AgentEvent to shared protocol requests and notifications

import {
  DILIGENT_CLIENT_NOTIFICATION_METHODS,
  DILIGENT_CLIENT_REQUEST_METHODS,
  DILIGENT_SERVER_NOTIFICATION_METHODS,
  DILIGENT_SERVER_REQUEST_METHODS,
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
  type SessionSummary,
} from "@diligent/protocol";
import type { AgentEvent, AgentLoopConfig, ModeKind } from "../agent/types";
import type { AgentRegistry } from "../collab/registry";
import type { DiligentPaths } from "../infrastructure/diligent-dir";
import { readKnowledge } from "../knowledge/store";
import { SessionManager, type SessionManagerConfig } from "../session/manager";
import { deleteSession, listSessions, readChildSessions } from "../session/persistence";
import { generateSessionId } from "../session/types";
import type { ApprovalRequest, ApprovalResponse, UserInputRequest, UserInputResponse } from "../tool/types";

export interface DiligentAppServerConfig {
  serverName?: string;
  serverVersion?: string;
  cwd?: string;
  resolvePaths: (cwd: string) => Promise<DiligentPaths>;
  buildAgentConfig: (args: {
    cwd: string;
    mode: Mode;
    signal: AbortSignal;
    approve: (request: ApprovalRequest) => Promise<ApprovalResponse>;
    ask: (request: UserInputRequest) => Promise<UserInputResponse>;
    getSessionId?: () => string | undefined;
    onCollabEvent?: (event: AgentEvent) => void;
  }) => (AgentLoopConfig & { registry?: AgentRegistry }) | Promise<AgentLoopConfig & { registry?: AgentRegistry }>;
  compaction?: SessionManagerConfig["compaction"];
}

export type NotificationListener = (notification: DiligentServerNotification) => void | Promise<void>;
export type ServerRequestHandler = (request: DiligentServerRequest) => Promise<DiligentServerRequestResponse>;

interface ThreadRuntime {
  id: string;
  cwd: string;
  mode: Mode;
  manager: SessionManager;
  abortController: AbortController | null;
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
  private notificationListener: NotificationListener | null = null;
  private serverRequestHandler: ServerRequestHandler | null = null;

  constructor(private readonly config: DiligentAppServerConfig) {
    this.serverName = config.serverName ?? "diligent-app-server";
    this.serverVersion = config.serverVersion ?? "0.0.1";
    this.knownCwds.add(config.cwd ?? process.cwd());
  }

  setNotificationListener(listener: NotificationListener | null): void {
    this.notificationListener = listener;
  }

  setServerRequestHandler(handler: ServerRequestHandler | null): void {
    this.serverRequestHandler = handler;
  }

  async handleRequest(raw: unknown): Promise<JSONRPCResponse> {
    const request = JSONRPCRequestSchema.safeParse(raw);
    if (!request.success) {
      return this.errorResponse("unknown", -32600, "Invalid Request", request.error.message);
    }

    const parsed = DiligentClientRequestSchema.safeParse({
      method: request.data.method,
      params: request.data.params ?? {},
    });

    if (!parsed.success) {
      return this.errorResponse(request.data.id, -32602, "Invalid params", parsed.error.message);
    }

    try {
      const result = await this.dispatchClientRequest(parsed.data);
      return JSONRPCResponseSchema.parse({ id: request.data.id, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.errorResponse(request.data.id, -32000, message);
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

  private async dispatchClientRequest(request: import("@diligent/protocol").DiligentClientRequest): Promise<unknown> {
    switch (request.method) {
      case DILIGENT_CLIENT_REQUEST_METHODS.INITIALIZE:
        return {
          serverName: this.serverName,
          serverVersion: this.serverVersion,
          protocolVersion: 1,
          capabilities: {
            supportsFollowUp: true,
            supportsApprovals: true,
            supportsUserInput: true,
          },
        };

      case DILIGENT_CLIENT_REQUEST_METHODS.THREAD_START:
        return this.handleThreadStart(request.params);

      case DILIGENT_CLIENT_REQUEST_METHODS.THREAD_RESUME:
        return this.handleThreadResume(request.params);

      case DILIGENT_CLIENT_REQUEST_METHODS.THREAD_LIST:
        return this.handleThreadList(request.params.limit, request.params.includeChildren);

      case DILIGENT_CLIENT_REQUEST_METHODS.THREAD_READ:
        return this.handleThreadRead(request.params.threadId);

      case DILIGENT_CLIENT_REQUEST_METHODS.TURN_START:
        return this.handleTurnStart(request.params.threadId, request.params.message);

      case DILIGENT_CLIENT_REQUEST_METHODS.TURN_INTERRUPT:
        return this.handleTurnInterrupt(request.params.threadId);

      case DILIGENT_CLIENT_REQUEST_METHODS.TURN_STEER:
        return this.handleTurnSteer(request.params.threadId, request.params.content, request.params.followUp);

      case DILIGENT_CLIENT_REQUEST_METHODS.MODE_SET:
        return this.handleModeSet(request.params.threadId, request.params.mode);

      case DILIGENT_CLIENT_REQUEST_METHODS.KNOWLEDGE_LIST:
        return this.handleKnowledgeList(request.params.threadId, request.params.limit);

      case DILIGENT_CLIENT_REQUEST_METHODS.THREAD_DELETE:
        return this.handleThreadDelete(request.params.threadId);
    }
  }

  private async handleThreadStart(params: { cwd: string; mode?: Mode }): Promise<{ threadId: string }> {
    const mode = params.mode ?? "default";
    const tempId = generateSessionId();
    const runtime = await this.createThreadRuntime(tempId, params.cwd, mode, true);
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
      const runtime = await this.createThreadRuntime(placeholderId, cwd, "default", false);

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
    };
  }

  private async handleTurnStart(threadId: string | undefined, message: string): Promise<{ accepted: true }> {
    const runtime = await this.resolveThreadRuntime(threadId);
    if (runtime.isRunning) throw new Error("A turn is already running for this thread");

    runtime.abortController = new AbortController();
    runtime.isRunning = true;
    const turnId = `turn-${crypto.randomUUID().slice(0, 8)}`;

    await this.emit({
      method: DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_STATUS_CHANGED,
      params: { threadId: runtime.id, status: "busy" },
    });
    await this.emit({
      method: DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_STARTED,
      params: { threadId: runtime.id, turnId },
    });

    const userMessage = {
      role: "user" as const,
      content: message,
      timestamp: Date.now(),
    };

    // Immediately update cache with the new message — no need to wait for disk flush
    const cached = this.threadSummaryCache.get(runtime.id);
    if (cached) {
      this.threadSummaryCache.set(runtime.id, {
        ...cached,
        firstUserMessage: cached.firstUserMessage ?? message.slice(0, 100),
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

  private async consumeStream(
    runtime: ThreadRuntime,
    stream: ReturnType<SessionManager["run"]>,
    turnId: string,
  ): Promise<void> {
    // Wire collab events from the registry into the notification stream
    if (runtime.registry) {
      runtime.registry.setCollabEventHandler((event) => {
        void this.emitFromAgentEvent(runtime.id, turnId, event);
      });
    }

    let wasAborted = false;

    try {
      for await (const event of stream) {
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
      // Disconnect collab event handler
      runtime.registry?.setCollabEventHandler(undefined);

      // Wait for the inner agent loop (executeLoop) to fully settle
      // before clearing state — prevents zombie loop from mutating leafId
      await stream.waitForInnerWork(wasAborted ? 5_000 : undefined).catch(() => {});

      runtime.abortController = null;
      runtime.isRunning = false;
      console.log("[AppServer] consumeStream: thread %s now idle (wasAborted=%s)", runtime.id, wasAborted);
      await this.emit({
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_STATUS_CHANGED,
        params: { threadId: runtime.id, status: "idle" },
      });

      // Auto-submit pending messages only if not aborted
      if (!wasAborted) {
        const pendingMessages = runtime.manager.popPendingMessages();
        if (pendingMessages && pendingMessages.length > 0) {
          const message = pendingMessages.join("\n");
          await this.handleTurnStart(runtime.id, message);
        }
      }
    }
  }

  private async emitFromAgentEvent(threadId: string, turnId: string, event: AgentEvent): Promise<void> {
    switch (event.type) {
      case "turn_start":
        if (event.childThreadId) {
          await this.emit({
            method: DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_STARTED,
            params: {
              threadId,
              turnId: event.turnId,
              childThreadId: event.childThreadId,
              nickname: event.nickname,
              turnNumber: event.turnNumber,
            },
          });
        }
        return;
      case "turn_end":
        return;

      case "message_start":
        await this.emit({
          method: DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_STARTED,
          params: { threadId, turnId, item: { type: "agentMessage", itemId: event.itemId, message: event.message } },
        });
        return;

      case "message_delta":
        await this.emit({
          method: DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_DELTA,
          params: {
            threadId,
            turnId,
            itemId: event.itemId,
            delta: {
              type: event.delta.type === "text_delta" ? "messageText" : "messageThinking",
              itemId: event.itemId,
              delta: event.delta.delta,
            },
          },
        });
        return;

      case "message_end":
        await this.emit({
          method: DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_COMPLETED,
          params: { threadId, turnId, item: { type: "agentMessage", itemId: event.itemId, message: event.message } },
        });
        return;

      case "tool_start":
        await this.emit({
          method: DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_STARTED,
          params: {
            threadId,
            turnId,
            item: {
              type: "toolCall",
              itemId: event.itemId,
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              input: event.input,
            },
            ...(event.childThreadId ? { childThreadId: event.childThreadId, nickname: event.nickname } : {}),
          },
        });
        return;

      case "tool_update":
        await this.emit({
          method: DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_DELTA,
          params: {
            threadId,
            turnId,
            itemId: event.itemId,
            delta: { type: "toolOutput", itemId: event.itemId, delta: event.partialResult },
            ...(event.childThreadId ? { childThreadId: event.childThreadId, nickname: event.nickname } : {}),
          },
        });
        return;

      case "tool_end":
        await this.emit({
          method: DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_COMPLETED,
          params: {
            threadId,
            turnId,
            item: {
              type: "toolCall",
              itemId: event.itemId,
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              input: {},
              output: event.output,
              isError: event.isError,
            },
            ...(event.childThreadId ? { childThreadId: event.childThreadId, nickname: event.nickname } : {}),
          },
        });
        return;

      case "status_change":
        await this.emit({
          method: DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_STATUS_CHANGED,
          params: { threadId, status: event.status, retry: event.retry },
        });
        return;

      case "knowledge_saved":
        await this.emit({
          method: DILIGENT_SERVER_NOTIFICATION_METHODS.KNOWLEDGE_SAVED,
          params: { threadId, knowledgeId: event.knowledgeId, content: event.content },
        });
        return;

      case "loop_detected":
        await this.emit({
          method: DILIGENT_SERVER_NOTIFICATION_METHODS.LOOP_DETECTED,
          params: { threadId, patternLength: event.patternLength, toolName: event.toolName },
        });
        return;

      case "error":
        await this.emit({
          method: DILIGENT_SERVER_NOTIFICATION_METHODS.ERROR,
          params: { threadId, error: event.error, fatal: event.fatal },
        });
        return;

      case "usage":
        await this.emit({
          method: DILIGENT_SERVER_NOTIFICATION_METHODS.USAGE_UPDATED,
          params: { threadId, usage: event.usage, cost: event.cost },
        });
        return;

      case "steering_injected":
        await this.emit({
          method: DILIGENT_SERVER_NOTIFICATION_METHODS.STEERING_INJECTED,
          params: { threadId, messageCount: event.messageCount },
        });
        return;

      // Collab — sub-agent orchestration boundary events
      case "collab_spawn_begin":
        await this.emit({
          method: DILIGENT_SERVER_NOTIFICATION_METHODS.COLLAB_SPAWN_BEGIN,
          params: { threadId, callId: event.callId, prompt: event.prompt },
        });
        return;

      case "collab_spawn_end":
        await this.emit({
          method: DILIGENT_SERVER_NOTIFICATION_METHODS.COLLAB_SPAWN_END,
          params: {
            threadId,
            callId: event.callId,
            childThreadId: event.childThreadId,
            nickname: event.nickname,
            description: event.description,
            prompt: event.prompt,
            status: event.status,
            message: event.message,
          },
        });
        return;

      case "collab_wait_begin":
        await this.emit({
          method: DILIGENT_SERVER_NOTIFICATION_METHODS.COLLAB_WAIT_BEGIN,
          params: { threadId, callId: event.callId, agents: event.agents },
        });
        return;

      case "collab_wait_end":
        await this.emit({
          method: DILIGENT_SERVER_NOTIFICATION_METHODS.COLLAB_WAIT_END,
          params: {
            threadId,
            callId: event.callId,
            agentStatuses: event.agentStatuses,
            timedOut: event.timedOut,
          },
        });
        return;

      case "collab_close_begin":
        await this.emit({
          method: DILIGENT_SERVER_NOTIFICATION_METHODS.COLLAB_CLOSE_BEGIN,
          params: { threadId, callId: event.callId, childThreadId: event.childThreadId, nickname: event.nickname },
        });
        return;

      case "collab_close_end":
        await this.emit({
          method: DILIGENT_SERVER_NOTIFICATION_METHODS.COLLAB_CLOSE_END,
          params: {
            threadId,
            callId: event.callId,
            childThreadId: event.childThreadId,
            nickname: event.nickname,
            status: event.status,
            message: event.message,
          },
        });
        return;

      case "collab_interaction_begin":
        await this.emit({
          method: DILIGENT_SERVER_NOTIFICATION_METHODS.COLLAB_INTERACTION_BEGIN,
          params: {
            threadId,
            callId: event.callId,
            receiverThreadId: event.receiverThreadId,
            receiverNickname: event.receiverNickname,
            prompt: event.prompt,
          },
        });
        return;

      case "collab_interaction_end":
        await this.emit({
          method: DILIGENT_SERVER_NOTIFICATION_METHODS.COLLAB_INTERACTION_END,
          params: {
            threadId,
            callId: event.callId,
            receiverThreadId: event.receiverThreadId,
            receiverNickname: event.receiverNickname,
            prompt: event.prompt,
            status: event.status,
          },
        });
        return;

      default:
        return;
    }
  }

  private async createThreadRuntime(
    threadId: string,
    cwd: string,
    mode: Mode,
    createNew: boolean,
  ): Promise<ThreadRuntime> {
    const runtime: ThreadRuntime = {
      id: threadId,
      cwd,
      mode,
      manager: null as unknown as SessionManager,
      abortController: null,
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
          signal,
          approve: (request) => this.requestApproval(runtime.id, request),
          ask: (request) => this.requestUserInput(runtime.id, request),
          getSessionId: () => runtime.manager.sessionId,
        });
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
      const runtime = await this.createThreadRuntime(id, cwd, "default", false);
      const resumed = await runtime.manager.resume({ sessionId: id });
      if (!resumed) continue;

      this.threads.set(id, runtime);
      this.activeThreadId = id;
      return runtime;
    }

    throw new Error(`Thread not found: ${id}`);
  }

  private async requestApproval(threadId: string, request: ApprovalRequest): Promise<ApprovalResponse> {
    if (!this.serverRequestHandler) {
      return "once";
    }

    const response = await this.serverRequestHandler({
      method: DILIGENT_SERVER_REQUEST_METHODS.APPROVAL_REQUEST,
      params: { threadId, request },
    });

    const parsed = DiligentServerRequestResponseSchema.safeParse(response);
    if (!parsed.success || parsed.data.method !== DILIGENT_SERVER_REQUEST_METHODS.APPROVAL_REQUEST) {
      return "reject";
    }
    return parsed.data.result.decision;
  }

  private async requestUserInput(threadId: string, request: UserInputRequest): Promise<UserInputResponse> {
    if (!this.serverRequestHandler) {
      return { answers: {} };
    }

    const response = await this.serverRequestHandler({
      method: DILIGENT_SERVER_REQUEST_METHODS.USER_INPUT_REQUEST,
      params: { threadId, request },
    });

    const parsed = DiligentServerRequestResponseSchema.safeParse(response);
    if (!parsed.success || parsed.data.method !== DILIGENT_SERVER_REQUEST_METHODS.USER_INPUT_REQUEST) {
      return { answers: {} };
    }
    return parsed.data.result;
  }

  private async emit(notification: DiligentServerNotification): Promise<void> {
    if (!this.notificationListener) {
      return;
    }
    await this.notificationListener(notification);
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
