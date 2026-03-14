// @summary Session manager orchestrating agent loop, persistence, compaction, and steering

import type { CoreAgentEvent } from "@diligent/core/agent";
import {
  type Agent,
  buildMessagesFromCompaction,
  selectForCompaction,
  toSerializableError,
} from "@diligent/core/agent";
import type { Message } from "@diligent/core/types";
import type { ModeKind } from "../agent/mode";
import type { AgentEvent } from "../agent-event";
import { calculateUsageCost } from "../cost";
import type { DiligentPaths } from "../infrastructure";
import { buildSessionContext, buildSessionTranscript } from "./context-builder";
import { listSessions, readSessionFile, SessionWriter } from "./persistence";
import type {
  CollabSessionMeta,
  CompactionEntry,
  EffortChangeEntry,
  ErrorEntry,
  ModeChangeEntry,
  ModelChangeEntry,
  SessionEntry,
  SessionInfo,
} from "./types";
import { generateEntryId } from "./types";

export interface SessionManagerConfig {
  cwd: string;
  paths: DiligentPaths;
  // D087: Factory allows per-run config (e.g. collaboration mode, mid-session knowledge refresh)
  agent: Agent | (() => Agent | Promise<Agent>);
  compaction?: {
    enabled: boolean;
    reservePercent: number;
    keepRecentTokens: number;
  };
  knowledgePath?: string;
  sessionId?: string;
  parentSession?: string;
  /** When spawned as a sub-agent, identity info persisted in session header */
  collabMeta?: CollabSessionMeta;
}

export interface ResumeSessionOptions {
  sessionId?: string;
  mostRecent?: boolean;
}

export class SessionManager {
  private entries: SessionEntry[] = [];
  private leafId: string | null = null;
  private pendingEntries: SessionEntry[] = [];
  private pendingLeafId: string | null = null;
  private writer: SessionWriter;
  private byId = new Map<string, SessionEntry>();
  private writeQueue: Promise<void> = Promise.resolve();
  /** Pre-agent steering queue — drained into agent at start of run() */
  private pendingMessages: Message[] = [];
  private memoryErrors: ErrorEntry[] = [];
  private listeners = new Set<(event: AgentEvent) => void>();
  /** Cached agent instance — persists between runs for the session lifetime */
  private _agent: Agent | null = null;
  private prevCacheReadBySession = new Map<string, number>();
  /** Track which agent instance has been restored with session history */
  private _initializedAgent: Agent | null = null;

  constructor(private config: SessionManagerConfig) {
    this.writer = new SessionWriter(
      config.paths.sessions,
      config.cwd,
      undefined,
      config.parentSession,
      config.collabMeta,
      config.sessionId,
    );
  }

  /** Create a new session */
  async create(): Promise<void> {
    this.entries = [];
    this.leafId = null;
    this.clearPendingEntries();
    this.byId.clear();
    this.prevCacheReadBySession.clear();
    this.writeQueue = Promise.resolve();
    this._initializedAgent = null;
    this.writer = new SessionWriter(
      this.config.paths.sessions,
      this.config.cwd,
      undefined,
      this.config.parentSession,
      this.config.collabMeta,
      this.config.sessionId ?? this.writer.id,
    );
    await this.writer.create();
  }

  /** Resume an existing session */
  async resume(options: ResumeSessionOptions): Promise<boolean> {
    this.prevCacheReadBySession.clear();
    let sessionPath: string | undefined;

    if (options.sessionId) {
      const sessions = await listSessions(this.config.paths.sessions);
      const session = sessions.find((s) => s.id === options.sessionId);
      sessionPath = session?.path;
    } else if (options.mostRecent) {
      const sessions = await listSessions(this.config.paths.sessions);
      sessionPath = sessions.find((s) => !s.parentSession)?.path;
    }

    if (!sessionPath) return false;

    const { entries } = await readSessionFile(sessionPath);
    this.entries = entries;
    this.byId.clear();
    for (const entry of entries) {
      this.byId.set(entry.id, entry);
    }
    this.leafId = entries.length > 0 ? entries[entries.length - 1].id : null;
    this.writeQueue = Promise.resolve();
    this.clearPendingEntries();
    this._initializedAgent = null;
    this.writer = new SessionWriter(this.config.paths.sessions, this.config.cwd, sessionPath);

    this.repairEntries();

    return true;
  }

  /** Repair orphaned tool_calls on resume — inject synthetic "interrupted" tool_results. */
  private repairEntries(): void {
    const path = this.getPathEntries();
    if (path.length === 0) return;

    const last = path[path.length - 1];
    if (last.type !== "message" || last.message.role !== "assistant") return;

    const assistantMsg = last.message;
    const toolCalls = assistantMsg.content.filter((b) => b.type === "tool_call");
    if (toolCalls.length === 0) return;

    // Check which tool_calls have matching tool_results
    const toolCallIds = new Set(toolCalls.map((b) => (b as { id: string }).id));
    for (const entry of path) {
      if (entry.type === "message" && entry.message.role === "tool_result") {
        toolCallIds.delete((entry.message as { toolCallId: string }).toolCallId);
      }
    }

    // Inject synthetic cancel results for orphaned tool_calls
    for (const id of toolCallIds) {
      const block = toolCalls.find((b) => (b as { id: string }).id === id);
      this.appendMessageEntry({
        role: "tool_result",
        toolCallId: id,
        toolName: (block as { name: string })?.name ?? "unknown",
        output: "[Cancelled]",
        isError: false,
        timestamp: assistantMsg.timestamp,
      });
    }
  }

  /** List available sessions */
  async list(): Promise<SessionInfo[]> {
    return listSessions(this.config.paths.sessions);
  }

  /** Scan session entries for spawn_agent tool results to restore collab thread IDs on resume. */
  getHistoricalCollabAgents(): Array<{ threadId: string; nickname: string }> {
    const results: Array<{ threadId: string; nickname: string }> = [];
    for (const entry of this.entries) {
      if (
        entry.type === "message" &&
        entry.message.role === "tool_result" &&
        (entry.message as { toolName?: string }).toolName === "spawn_agent" &&
        !(entry.message as { isError?: boolean }).isError
      ) {
        try {
          const parsed = JSON.parse((entry.message as { output: string }).output);
          if (parsed.thread_id && parsed.nickname) {
            results.push({ threadId: parsed.thread_id, nickname: parsed.nickname });
          }
        } catch {
          // skip malformed output
        }
      }
    }
    return results;
  }

  /** Get the current message context for display (e.g., after resume) */
  getContext(): Message[] {
    const { entries, leafId } = this.getVisibleSessionState();
    const context = buildSessionContext(entries, leafId, {});
    return context.messages;
  }

  /** Get the full raw transcript for human-facing UIs. */
  getTranscript() {
    const { entries, leafId } = this.getVisibleSessionState();
    return buildSessionTranscript(entries, leafId);
  }

  getErrors(): ErrorEntry[] {
    return this.memoryErrors;
  }

  getCurrentModel(): { provider: string; modelId: string } | undefined {
    return buildSessionContext(this.entries, this.leafId, {}).currentModel;
  }

  /**
   * Reconcile in-memory entries with the persisted session file.
   */
  async reconcileFromDisk(): Promise<{
    changed: boolean;
    reason: "no_session_path" | "memory_newer" | "already_equal" | "updated_from_disk";
    sessionPath: string | null;
    memoryEntries: number;
    diskEntries: number;
    memoryLeafId: string | null;
    diskLeafId: string | null;
    memoryTailEntryIds: string;
    diskTailEntryIds: string;
    memoryTailMessage: string;
    diskTailMessage: string;
  }> {
    const sessionPath = this.writer.path;
    const memoryEntries = this.entries.length;
    const memoryLeafId = this.leafId;
    const memoryTailEntryIds = summarizeTailEntryIds(this.entries);
    const memoryTailMessage = summarizeLastPersistedMessage(this.entries);

    if (!sessionPath) {
      return {
        changed: false,
        reason: "no_session_path",
        sessionPath: null,
        memoryEntries,
        diskEntries: 0,
        memoryLeafId,
        diskLeafId: null,
        memoryTailEntryIds,
        diskTailEntryIds: "-",
        memoryTailMessage,
        diskTailMessage: "-",
      };
    }

    await this.writeQueue.catch(() => {});

    const { entries } = await readSessionFile(sessionPath);
    const diskLeafId = entries.length > 0 ? entries[entries.length - 1].id : null;
    const diskTailEntryIds = summarizeTailEntryIds(entries);
    const diskTailMessage = summarizeLastPersistedMessage(entries);

    if (entries.length < this.entries.length) {
      return {
        changed: false,
        reason: "memory_newer",
        sessionPath,
        memoryEntries,
        diskEntries: entries.length,
        memoryLeafId,
        diskLeafId,
        memoryTailEntryIds,
        diskTailEntryIds,
        memoryTailMessage,
        diskTailMessage,
      };
    }
    if (entries.length === this.entries.length && diskLeafId === this.leafId) {
      return {
        changed: false,
        reason: "already_equal",
        sessionPath,
        memoryEntries,
        diskEntries: entries.length,
        memoryLeafId,
        diskLeafId,
        memoryTailEntryIds,
        diskTailEntryIds,
        memoryTailMessage,
        diskTailMessage,
      };
    }

    this.entries = entries;
    this.byId.clear();
    for (const entry of entries) {
      this.byId.set(entry.id, entry);
    }
    this.leafId = diskLeafId;
    return {
      changed: true,
      reason: "updated_from_disk",
      sessionPath,
      memoryEntries,
      diskEntries: entries.length,
      memoryLeafId,
      diskLeafId,
      memoryTailEntryIds,
      diskTailEntryIds,
      memoryTailMessage,
      diskTailMessage,
    };
  }

  getCurrentEffort(): "none" | "low" | "medium" | "high" | "max" | undefined {
    return buildSessionContext(this.entries, this.leafId, {}).currentEffort;
  }

  async compactNow(): Promise<{ compacted: boolean; entryCount: number; tokensBefore: number; tokensAfter: number }> {
    await this.waitForWrites();
    const context = buildSessionContext(this.entries, this.leafId, {});
    const compactionConfig = this.config.compaction ?? { enabled: true, reservePercent: 16, keepRecentTokens: 20000 };

    const agentResult = this.resolveAgent();
    const agent = agentResult instanceof Promise ? await agentResult : agentResult;
    agent.restore(context.messages);
    agent.setCompactionConfig({
      reservePercent: compactionConfig.reservePercent,
      keepRecentTokens: compactionConfig.keepRecentTokens,
    });
    this._initializedAgent = agent;

    let tokensBefore = 0;
    let tokensAfter = 0;
    const unsub = agent.agentStream.subscribe((event: CoreAgentEvent) => {
      this.emitToListeners(event);
      if (event.type === "compaction_end") {
        tokensBefore = event.tokensBefore;
        tokensAfter = event.tokensAfter;
        this.persistCompactionEntry({
          summary: event.summary,
          recentUserMessages: selectForCompaction(context.messages, compactionConfig.keepRecentTokens)
            .recentUserMessages,
          tokensBefore: event.tokensBefore,
          tokensAfter: event.tokensAfter,
        });
      }
    });

    try {
      await agent.compact();
    } finally {
      unsub();
    }

    await this.waitForWrites();
    return { compacted: true, entryCount: this.entryCount, tokensBefore, tokensAfter };
  }

  appendModelChange(provider: string, modelId: string): void {
    const entry: ModelChangeEntry = {
      type: "model_change",
      id: generateEntryId(),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      provider,
      modelId,
    };
    this.entries.push(entry);
    this.byId.set(entry.id, entry);
    this.leafId = entry.id;
    this.writeQueue = this.writeQueue.then(() => this.writer.write(entry)).catch(() => {});
  }

  /**
   * Subscribe to session events (CoreAgentEvent relayed from agent + RuntimeAgentEvent from manager).
   * Returns an unsubscribe function.
   */
  subscribe(fn: (event: AgentEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Run the agent loop with the current session context.
   * Persists user message and agent response to session.
   * Compaction is handled by the Agent internally.
   */
  async run(userMessage: Message, opts?: { signal?: AbortSignal }): Promise<void> {
    for (const fn of this.listeners) fn({ type: "status_change", status: "busy" });

    // 0. Repair orphaned tool_calls from a previous abort
    this.repairEntries();

    // 1. Build context from tree BEFORE persisting user message (for agent restore)
    const context = buildSessionContext(this.entries, this.leafId, {});
    const stagedEntries: SessionEntry[] = [];
    let stagedLeafId = this.leafId;
    let stagedConversation = [...context.messages, userMessage];
    const stageEntry = (entry: SessionEntry) => {
      stagedEntries.push(entry);
      stagedLeafId = entry.id;
    };
    const stageMessageEntry = (message: Message) => stageEntry(this.createMessageEntry(message, stagedLeafId));
    const stageCompaction = (event: {
      summary: string;
      recentUserMessages: Message[];
      tokensBefore: number;
      tokensAfter: number;
    }) => stageEntry(this.createCompactionEntry(event, stagedLeafId));
    stageMessageEntry(userMessage);
    this.setPendingEntries(stagedEntries, stagedLeafId);

    // 3. Resolve agent — may be sync or async
    const agentResult = this.resolveAgent();
    const agent = agentResult instanceof Promise ? await agentResult : agentResult;
    this._agent = agent;

    agent.setSessionId(this.writer.id);

    // 4. Drain pre-agent pending messages into agent steering queue
    for (const msg of this.pendingMessages.splice(0)) {
      agent.steer(msg);
    }

    // 5. Apply compaction config to agent
    const compactionConfig = this.config.compaction;
    if (compactionConfig?.enabled) {
      agent.setCompactionConfig({
        reservePercent: compactionConfig.reservePercent,
        keepRecentTokens: compactionConfig.keepRecentTokens,
      });
    }

    // 6. Restore historical context once per agent instance
    if (agent !== this._initializedAgent) {
      agent.restore(context.messages);
      this._initializedAgent = agent;
    }

    // 6. Subscribe to agent events — persist + relay, handle compaction_end for persistence
    let currentTurnId: string | undefined;
    const unsub = agent.subscribe((event: CoreAgentEvent) => {
      if (event.type === "turn_start") currentTurnId = event.turnId;
      if (event.type === "usage") {
        this.handleUsageEvent(event.usage);
      }
      this.stageAgentEvent(event, (message) => {
        stagedConversation.push(message);
        stageMessageEntry(message);
      });
      this.emitToListeners(event);

      if (event.type === "compaction_end") {
        const keepRecentTokens = compactionConfig?.keepRecentTokens ?? 20_000;
        const recentUserMessages = selectForCompaction(stagedConversation, keepRecentTokens).recentUserMessages;
        stagedConversation = buildMessagesFromCompaction(recentUserMessages, event.summary, Date.now());
        stageCompaction({
          summary: event.summary,
          recentUserMessages,
          tokensBefore: event.tokensBefore,
          tokensAfter: event.tokensAfter,
        });
      }
      this.setPendingEntries(stagedEntries, stagedLeafId);
    });

    try {
      await agent.prompt(userMessage, opts?.signal);
      this.appendEntries(stagedEntries);
    } catch (err) {
      const serializable = toSerializableError(err);
      console.error(
        "[SessionManager] Run error session=%s name=%s message=%s lastPersisted=%s",
        this.writer.id,
        serializable.name,
        serializable.message,
        summarizeLastPersistedMessage(this.entries),
      );
      this.appendError(serializable, { fatal: true, turnId: currentTurnId });
    } finally {
      this.clearPendingEntries();
      unsub();
    }

    if (opts?.signal?.aborted) {
      const pending = this.popPendingMessages();
      if (pending?.length) {
        const followup: Message = { role: "user", content: pending.join("\n"), timestamp: Date.now() };
        await this.run(followup);
        return;
      }
      throw new Error("Aborted");
    }
  }

  /** Wait for all pending writes to complete. */
  async waitForWrites(): Promise<void> {
    await this.writeQueue;
  }

  private persistCompactionEntry(event: {
    summary: string;
    recentUserMessages: Message[];
    tokensBefore: number;
    tokensAfter: number;
  }): void {
    const entry: CompactionEntry = {
      type: "compaction",
      id: generateEntryId(),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      summary: event.summary,
      recentUserMessages: event.recentUserMessages,
      tokensBefore: event.tokensBefore,
      tokensAfter: event.tokensAfter,
    };
    this.entries.push(entry);
    this.byId.set(entry.id, entry);
    this.leafId = entry.id;
    this.writeQueue = this.writeQueue.then(() => this.writer.write(entry)).catch(() => {});
  }

  /** Get the linear path of entries from root to leaf */
  private getPathEntries(): SessionEntry[] {
    if (this.entries.length === 0 || !this.leafId) return [];

    const path: SessionEntry[] = [];
    let current: SessionEntry | undefined = this.byId.get(this.leafId);
    while (current) {
      path.push(current);
      current = current.parentId ? this.byId.get(current.parentId) : undefined;
    }
    path.reverse();
    return path;
  }

  /** Queue a steering message. If agent is active, steers directly; otherwise queues locally. */
  steer(content: string): void {
    const msg: Message = {
      role: "user",
      content,
      timestamp: Date.now(),
    };
    if (this._agent) {
      this._agent.steer(msg);
    } else {
      this.pendingMessages.push(msg);
    }
  }

  /** Check if pending messages exist (steering or follow-up). */
  hasPendingMessages(): boolean {
    if (this._agent) return this._agent.hasPendingMessages();
    return this.pendingMessages.length > 0;
  }

  /** Pop any undrained pending messages (from agent queue or pre-agent queue). Returns null if empty. */
  popPendingMessages(): string[] | null {
    const msgs: Message[] = [];

    // Drain from agent's steering queue first (unconsumed after last run)
    if (this._agent) {
      msgs.push(...this._agent.drainPendingMessages());
    }

    // Then drain any pre-agent local queue
    msgs.push(...this.pendingMessages.splice(0));

    if (msgs.length === 0) return null;
    return msgs.map((m) => (m.role === "user" && typeof m.content === "string" ? m.content : ""));
  }

  appendModeChange(mode: ModeKind, changedBy: ModeChangeEntry["changedBy"] = "command"): void {
    const entry: ModeChangeEntry = {
      type: "mode_change",
      id: generateEntryId(),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      mode,
      changedBy,
    };
    this.entries.push(entry);
    this.byId.set(entry.id, entry);
    this.leafId = entry.id;
    this.writeQueue = this.writeQueue.then(() => this.writer.write(entry)).catch(() => {});
  }

  appendEffortChange(
    effort: "none" | "low" | "medium" | "high" | "max",
    changedBy: EffortChangeEntry["changedBy"] = "command",
  ): void {
    const entry: EffortChangeEntry = {
      type: "effort_change",
      id: generateEntryId(),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      effort,
      changedBy,
    };
    this.entries.push(entry);
    this.byId.set(entry.id, entry);
    this.leafId = entry.id;
    this.writeQueue = this.writeQueue.then(() => this.writer.write(entry)).catch(() => {});
  }

  appendError(error: ErrorEntry["error"], options?: { fatal?: boolean; turnId?: string }): void {
    const entry: ErrorEntry = {
      type: "error",
      id: generateEntryId(),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      turnId: options?.turnId,
      fatal: options?.fatal ?? false,
      error,
    };
    this.memoryErrors.push(entry);
  }

  private appendMessageEntry(message: Message): SessionEntry {
    const entry = this.createMessageEntry(message, this.leafId);
    this.appendEntries([entry]);
    return entry;
  }

  private handleUsageEvent(usage: { cacheReadTokens: number }): void {
    const prevCacheRead = this.prevCacheReadBySession.get(this.writer.id) ?? 0;
    if (usage.cacheReadTokens < prevCacheRead) {
      console.error(
        "[SessionManager] Cache drop session=%s: %d -> %d",
        this.writer.id,
        prevCacheRead,
        usage.cacheReadTokens,
      );
    }
    this.prevCacheReadBySession.set(this.writer.id, usage.cacheReadTokens);
  }

  /** Stage relevant CoreAgentEvents until the turn commits successfully. */
  private stageAgentEvent(event: CoreAgentEvent, appendMessage: (message: Message) => void): void {
    if (event.type === "turn_end") {
      appendMessage(event.message);

      for (const toolResult of event.toolResults) {
        appendMessage(toolResult);
      }
      // Mirror the live conversation shape so compaction snapshots remain correct mid-run.
      return;
    } else if (event.type === "steering_injected") {
      for (const msg of event.messages) {
        appendMessage(msg);
      }
    }
  }

  private createCompactionEntry(
    event: {
      summary: string;
      recentUserMessages: Message[];
      tokensBefore: number;
      tokensAfter: number;
    },
    parentId: string | null,
  ): CompactionEntry {
    return {
      type: "compaction",
      id: generateEntryId(),
      parentId,
      timestamp: new Date().toISOString(),
      summary: event.summary,
      recentUserMessages: event.recentUserMessages,
      tokensBefore: event.tokensBefore,
      tokensAfter: event.tokensAfter,
    };
  }

  private createMessageEntry(message: Message, parentId: string | null): SessionEntry {
    return {
      type: "message",
      id: generateEntryId(),
      parentId,
      timestamp: new Date().toISOString(),
      message,
    };
  }

  private appendEntries(entries: SessionEntry[]): void {
    for (const entry of entries) {
      this.entries.push(entry);
      this.byId.set(entry.id, entry);
      this.leafId = entry.id;
      this.writeQueue = this.writeQueue
        .then(async () => {
          await this.writer.write(entry);
        })
        .catch((error) => {
          const detail = entry.type === "message" ? entry.message.role : entry.type;
          console.error(
            "[SessionManager] Failed to persist %s for session=%s: %s",
            detail,
            this.writer.id,
            error instanceof Error ? error.message : String(error),
          );
        });
    }
  }

  private emitToListeners(event: CoreAgentEvent): void {
    const enriched: AgentEvent =
      event.type === "usage" && this._agent
        ? { ...event, cost: calculateUsageCost(this._agent.model, event.usage) }
        : (event as AgentEvent);
    for (const fn of this.listeners) fn(enriched);
  }

  /**
   * Resolve the agent. When the factory returns a Promise, this returns a Promise.
   * When it returns synchronously, this returns synchronously.
   */
  private resolveAgent(): Agent | Promise<Agent> {
    return typeof this.config.agent === "function" ? this.config.agent() : this.config.agent;
  }

  private getVisibleSessionState(): { entries: SessionEntry[]; leafId: string | null } {
    if (this.pendingEntries.length === 0) {
      return { entries: this.entries, leafId: this.leafId };
    }
    return { entries: [...this.entries, ...this.pendingEntries], leafId: this.pendingLeafId };
  }

  private setPendingEntries(entries: SessionEntry[], leafId: string | null): void {
    this.pendingEntries = [...entries];
    this.pendingLeafId = leafId;
  }

  private clearPendingEntries(): void {
    this.pendingEntries = [];
    this.pendingLeafId = null;
  }

  get sessionPath(): string | null {
    return this.writer.path;
  }

  get sessionId(): string {
    return this.writer.id;
  }

  get entryCount(): number {
    return this.getVisibleSessionState().entries.length;
  }
}

function summarizeLastPersistedMessage(entries: SessionEntry[]): string {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type !== "message") continue;
    const { message } = entry;
    if (message.role === "tool_result") {
      return `tool_result:${message.toolName}:error=${message.isError}`;
    }
    if (message.role === "assistant") {
      const blockTypes = message.content.map((block) => block.type).join(",") || "-";
      return `assistant:stop=${message.stopReason}:blocks=${blockTypes}`;
    }
    if (message.role === "user") {
      return "user";
    }
  }
  return "none";
}

function summarizeTailEntryIds(entries: SessionEntry[], count = 3): string {
  if (entries.length === 0) return "-";
  return entries
    .slice(Math.max(0, entries.length - count))
    .map((entry) => entry.id)
    .join(",");
}
