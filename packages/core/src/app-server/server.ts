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
import type { DiligentPaths } from "../infrastructure/diligent-dir";
import { readKnowledge } from "../knowledge/store";
import { SessionManager, type SessionManagerConfig } from "../session/manager";
import { deleteSession, listSessions } from "../session/persistence";
import type { ApprovalRequest, ApprovalResponse, UserInputRequest, UserInputResponse } from "../tool/types";

export interface DiligentAppServerConfig {
  serverName?: string;
  serverVersion?: string;
  resolvePaths: (cwd: string) => Promise<DiligentPaths>;
  buildAgentConfig: (args: {
    cwd: string;
    mode: Mode;
    signal: AbortSignal;
    approve: (request: ApprovalRequest) => Promise<ApprovalResponse>;
    ask: (request: UserInputRequest) => Promise<UserInputResponse>;
  }) => AgentLoopConfig;
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
}

export class DiligentAppServer {
  private readonly serverName: string;
  private readonly serverVersion: string;
  private readonly threads = new Map<string, ThreadRuntime>();
  private readonly knownCwds = new Set<string>();
  private activeThreadId: string | null = null;
  private notificationListener: NotificationListener | null = null;
  private serverRequestHandler: ServerRequestHandler | null = null;

  constructor(private readonly config: DiligentAppServerConfig) {
    this.serverName = config.serverName ?? "diligent-app-server";
    this.serverVersion = config.serverVersion ?? "0.0.1";
    this.knownCwds.add(process.cwd());
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
        return this.handleThreadList(request.params.limit);

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
    const threadId = `thread-${crypto.randomUUID().slice(0, 8)}`;
    const runtime = await this.createThreadRuntime(threadId, params.cwd, mode, true);

    this.threads.set(threadId, runtime);
    this.activeThreadId = threadId;
    this.knownCwds.add(params.cwd);

    await this.emit({ method: DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_STARTED, params: { threadId } });
    return { threadId };
  }

  private async handleThreadResume(params: {
    threadId?: string;
    mostRecent?: boolean;
  }): Promise<{ found: boolean; threadId?: string; context?: unknown[] }> {
    const candidateCwds = Array.from(this.knownCwds);

    for (const cwd of candidateCwds) {
      const runtime = await this.createThreadRuntime(
        params.threadId ?? `thread-${crypto.randomUUID().slice(0, 8)}`,
        cwd,
        "default",
        false,
      );

      const resumed = await runtime.manager.resume({
        sessionId: params.threadId,
        mostRecent: params.mostRecent,
      });
      if (!resumed) continue;

      const context = runtime.manager.getContext();
      const actualThreadId = params.threadId ?? (await this.mostRecentSessionId(cwd)) ?? runtime.id;

      runtime.id = actualThreadId;
      this.threads.set(actualThreadId, runtime);
      this.activeThreadId = actualThreadId;

      await this.emit({
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_RESUMED,
        params: {
          threadId: actualThreadId,
          restoredMessages: context.length,
        },
      });

      return { found: true, threadId: actualThreadId, context };
    }

    return { found: false };
  }

  private async handleThreadList(limit?: number): Promise<{ data: SessionSummary[] }> {
    const all = [] as SessionSummary[];

    for (const cwd of this.knownCwds) {
      const paths = await this.config.resolvePaths(cwd);
      const sessions = await listSessions(paths.sessions);
      all.push(
        ...sessions.map((session) => ({
          id: session.id,
          path: session.path,
          cwd: session.cwd,
          name: session.name,
          created: session.created.toISOString(),
          modified: session.modified.toISOString(),
          messageCount: session.messageCount,
          firstUserMessage: session.firstUserMessage,
        })),
      );
    }

    const deduped = new Map<string, SessionSummary>();
    for (const entry of all) deduped.set(entry.id, entry);

    return { data: Array.from(deduped.values()).slice(0, limit ?? 100) };
  }

  private async handleThreadRead(
    threadId?: string,
  ): Promise<{ messages: unknown[]; hasFollowUp: boolean; entryCount: number }> {
    const runtime = await this.resolveThreadRuntime(threadId);
    return {
      messages: runtime.manager.getContext(),
      hasFollowUp: runtime.manager.hasFollowUp(),
      entryCount: runtime.manager.entryCount,
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

    const stream = runtime.manager.run(userMessage);
    void this.consumeStream(runtime, stream, turnId);

    return { accepted: true };
  }

  private async handleTurnInterrupt(threadId?: string): Promise<{ interrupted: boolean }> {
    const runtime = await this.resolveThreadRuntime(threadId);
    if (!runtime.isRunning || !runtime.abortController) return { interrupted: false };

    runtime.abortController.abort();
    return { interrupted: true };
  }

  private async handleTurnSteer(
    threadId: string | undefined,
    content: string,
    followUp: boolean,
  ): Promise<{ queued: true }> {
    const runtime = await this.resolveThreadRuntime(threadId);
    if (followUp) runtime.manager.followUp(content);
    else runtime.manager.steer(content);

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

    let deleted = false;
    for (const cwd of this.knownCwds) {
      const paths = await this.config.resolvePaths(cwd);
      const result = await deleteSession(paths.sessions, threadId);
      if (result) {
        deleted = true;
        break;
      }
    }

    if (deleted) {
      this.threads.delete(threadId);
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
    try {
      for await (const event of stream) {
        await this.emitFromAgentEvent(runtime.id, turnId, event);
      }
      await stream.result();
      await this.emit({
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED,
        params: { threadId: runtime.id, turnId },
      });
    } catch (error) {
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
    } finally {
      runtime.abortController = null;
      runtime.isRunning = false;
      await this.emit({
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_STATUS_CHANGED,
        params: { threadId: runtime.id, status: "idle" },
      });
    }
  }

  private async emitFromAgentEvent(threadId: string, turnId: string, event: AgentEvent): Promise<void> {
    switch (event.type) {
      case "turn_start":
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
      agentConfig: () => {
        const signal = runtime.abortController?.signal ?? new AbortController().signal;
        return this.config.buildAgentConfig({
          cwd,
          mode: runtime.mode,
          signal,
          approve: (request) => this.requestApproval(runtime.id, request),
          ask: (request) => this.requestUserInput(runtime.id, request),
        });
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

  private async mostRecentSessionId(cwd: string): Promise<string | null> {
    const paths = await this.config.resolvePaths(cwd);
    const sessions = await listSessions(paths.sessions);
    return sessions[0]?.id ?? null;
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
