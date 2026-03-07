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
  type ThinkingEffort,
  type TurnStartParams,
} from "@diligent/protocol";
import type { AgentEvent, AgentLoopConfig, ModeKind } from "../agent/types";
import type { AgentRegistry } from "../collab/registry";
import type { DiligentPaths } from "../infrastructure/diligent-dir";
import { readKnowledge } from "../knowledge/store";
import { buildSessionContext } from "../session/context-builder";
import { SessionManager, type SessionManagerConfig } from "../session/manager";
import { deleteSession, listSessions, readChildSessions, readSessionFile } from "../session/persistence";
import { generateSessionId } from "../session/types";
import type { ApprovalRequest, ApprovalResponse, UserInputRequest, UserInputResponse } from "../tool/types";
import { agentEventToNotification } from "./event-mapper";

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
}

export type NotificationListener = (notification: DiligentServerNotification) => void | Promise<void>;
export type ServerRequestHandler = (request: DiligentServerRequest) => Promise<DiligentServerRequestResponse>;

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

      case DILIGENT_CLIENT_REQUEST_METHODS.THREAD_START:
        return this.handleThreadStart(request.params);

      case DILIGENT_CLIENT_REQUEST_METHODS.THREAD_RESUME:
        return this.handleThreadResume(request.params);

      case DILIGENT_CLIENT_REQUEST_METHODS.THREAD_LIST:
        return this.handleThreadList(request.params.limit, request.params.includeChildren);

      case DILIGENT_CLIENT_REQUEST_METHODS.THREAD_READ:
        return this.handleThreadRead(request.params.threadId);

      case DILIGENT_CLIENT_REQUEST_METHODS.TURN_START:
        return this.handleTurnStart(request.params);

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
    }
  }

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

  private async handleTurnStart(params: TurnStartParams): Promise<{ accepted: true }> {
    const runtime = await this.resolveThreadRuntime(params.threadId);
    if (runtime.isRunning) throw new Error("A turn is already running for this thread");

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

  private async consumeStream(
    runtime: ThreadRuntime,
    stream: ReturnType<SessionManager["run"]>,
    turnId: string,
  ): Promise<void> {
    // Wire collab events from the registry into the notification stream.
    // NOTE: runtime.registry may be replaced on each resolveAgentConfig() call,
    // because tool assembly can create a fresh AgentRegistry per iteration.
    // Re-bind whenever the registry instance changes so child collab events
    // are not dropped mid-turn.
    let wiredRegistry: AgentRegistry | undefined;
    const collabEventHandler = (event: AgentEvent) => {
      void this.emitFromAgentEvent(runtime.id, turnId, event);
    };
    const wireCollabHandler = () => {
      const currentRegistry = runtime.registry;
      if (!currentRegistry || currentRegistry === wiredRegistry) return;
      wiredRegistry?.setCollabEventHandler(undefined);
      currentRegistry.setCollabEventHandler(collabEventHandler);
      wiredRegistry = currentRegistry;
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
      // Disconnect collab event handler from the last wired registry instance.
      wiredRegistry?.setCollabEventHandler(undefined);

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
