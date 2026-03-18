// @summary Session manager orchestrating agent loop, persistence, compaction, and steering

import type { CoreAgentEvent } from "@diligent/core/agent";
import { type Agent, selectForCompaction, toSerializableError } from "@diligent/core/agent";
import type { Message } from "@diligent/core/types";
import type { Mode } from "../agent/mode";
import type { AgentEvent } from "../agent-event";
import { calculateUsageCost } from "../cost";
import type { DiligentPaths } from "../infrastructure";
import { createToolStartRenderPayload } from "../tools/render-payload";
import { buildSessionContext, buildSessionTranscript } from "./context-builder";
import { SessionPersistence, type SessionReconcileResult } from "./persistence";
import { SessionStateStore } from "./state-store";
import { TurnStager } from "./turn-stager";
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
  private state = new SessionStateStore();
  private persistence: SessionPersistence;
  /** Pre-agent steering queue — drained into agent at start of run() */
  private pendingMessages: Message[] = [];
  private memoryErrors: ErrorEntry[] = [];
  private listeners = new Set<(event: AgentEvent) => void>();
  /** Cached agent instance — persists between runs for the session lifetime */
  private _agent: Agent | null = null;
  private prevCacheReadBySession = new Map<string, number>();
  private prevPromptHashesBySession = new Map<string, string[]>();
  private currPromptHashesBySession = new Map<string, string[]>();
  /** Track which agent instance has been restored with session history */
  private _initializedAgent: Agent | null = null;

  constructor(private config: SessionManagerConfig) {
    this.persistence = new SessionPersistence({
      sessionsDir: config.paths.sessions,
      cwd: config.cwd,
      parentSession: config.parentSession,
      collabMeta: config.collabMeta,
      sessionId: config.sessionId,
    });
  }

  /** Create a new session */
  async create(): Promise<void> {
    this.state.reset();
    this.prevCacheReadBySession.clear();
    this._initializedAgent = null;
    this.persistence.resetForCreate();
    await this.persistence.create();
  }

  /** Resume an existing session */
  async resume(options: ResumeSessionOptions): Promise<boolean> {
    this.prevCacheReadBySession.clear();
    const entries = await this.persistence.resume(options);
    if (!entries) return false;

    this.state.replaceCommitted(entries);
    this._initializedAgent = null;

    this.repairEntries();

    return true;
  }

  /** Repair orphaned tool_calls on resume — inject synthetic "interrupted" tool_results. */
  private repairEntries(): void {
    const path = this.state.getPathEntries();
    if (path.length === 0) return;

    const last = path[path.length - 1];
    if (last.type !== "message" || last.message.role !== "assistant") return;

    const assistantMsg = last.message;
    const toolCalls = assistantMsg.content.filter((b) => b.type === "tool_call");
    if (toolCalls.length === 0) return;

    const toolCallIds = new Set(toolCalls.map((b) => (b as { id: string }).id));
    for (const entry of path) {
      if (entry.type === "message" && entry.message.role === "tool_result") {
        toolCallIds.delete((entry.message as { toolCallId: string }).toolCallId);
      }
    }

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
    return this.persistence.list();
  }

  /** Scan session entries for spawn_agent tool results to restore collab thread IDs on resume. */
  getHistoricalCollabAgents(): Array<{ threadId: string; nickname: string }> {
    const results: Array<{ threadId: string; nickname: string }> = [];
    for (const entry of this.state.getCommittedEntries()) {
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
    const { entries, leafId } = this.state.getVisibleState();
    const context = buildSessionContext(entries, leafId, {});
    return context.messages;
  }

  /** Get the full raw transcript for human-facing UIs. */
  getTranscript() {
    const { entries, leafId } = this.state.getVisibleState();
    return buildSessionTranscript(entries, leafId);
  }

  getErrors(): ErrorEntry[] {
    return this.memoryErrors;
  }

  getCurrentModel(): { provider: string; modelId: string } | undefined {
    return buildSessionContext(this.state.getCommittedEntries(), this.state.getCommittedLeafId(), {}).currentModel;
  }

  /**
   * Reconcile in-memory entries with the persisted session file.
   */
  async reconcileFromDisk(): Promise<SessionReconcileResult> {
    const reconciled = await this.persistence.reconcile({
      committedEntries: this.state.getCommittedEntries(),
      committedLeafId: this.state.getCommittedLeafId(),
      summarizeTailEntryIds,
      summarizeLastPersistedMessage,
    });

    if (reconciled.entries) {
      this.state.replaceCommitted(reconciled.entries);
    }

    return reconciled.result;
  }

  getCurrentEffort(): "none" | "low" | "medium" | "high" | "max" | undefined {
    return buildSessionContext(this.state.getCommittedEntries(), this.state.getCommittedLeafId(), {}).currentEffort;
  }

  async compactNow(): Promise<{ compacted: boolean; entryCount: number; tokensBefore: number; tokensAfter: number }> {
    await this.waitForWrites();
    const context = buildSessionContext(this.state.getCommittedEntries(), this.state.getCommittedLeafId(), {});
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
      parentId: this.state.getCommittedLeafId(),
      timestamp: new Date().toISOString(),
      provider,
      modelId,
    };
    this.appendAndPersist(entry);
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
    this.emitBusyStatus();

    const prepared = await this.prepareRun(userMessage);
    const { unsubscribe, getCurrentTurnId } = this.subscribeRunEvents(prepared);

    try {
      await this.executeRun(prepared.agent, userMessage, opts?.signal);
      this.commitRun(prepared.turnStager);
    } catch (err) {
      this.handleRunError(err, getCurrentTurnId());
    } finally {
      this.finishRun(unsubscribe);
    }

    this.throwIfAborted(opts?.signal);
  }

  /** Wait for all pending writes to complete. */
  async waitForWrites(): Promise<void> {
    await this.persistence.waitForWrites();
  }

  private emitBusyStatus(): void {
    for (const fn of this.listeners) fn({ type: "status_change", status: "busy" });
  }

  private async prepareRun(userMessage: Message): Promise<{ agent: Agent; turnStager: TurnStager }> {
    this.repairEntries();

    const context = buildSessionContext(this.state.getCommittedEntries(), this.state.getCommittedLeafId(), {});
    const turnStager = new TurnStager(this.state.getCommittedLeafId(), context.messages, userMessage);
    const snapshot = turnStager.getSnapshot();
    this.state.setPending(snapshot.entries, snapshot.leafId);

    const agentResult = this.resolveAgent();
    const agent = agentResult instanceof Promise ? await agentResult : agentResult;
    this._agent = agent;

    agent.setSessionId(this.persistence.sessionId);

    for (const msg of this.pendingMessages.splice(0)) {
      agent.steer(msg);
    }

    const compactionConfig = this.config.compaction;
    if (compactionConfig?.enabled) {
      agent.setCompactionConfig({
        reservePercent: compactionConfig.reservePercent,
        keepRecentTokens: compactionConfig.keepRecentTokens,
      });
    }

    if (agent !== this._initializedAgent) {
      agent.restore(context.messages);
      this._initializedAgent = agent;
    }

    return { agent, turnStager };
  }

  private subscribeRunEvents(prepared: { agent: Agent; turnStager: TurnStager }): {
    unsubscribe: () => void;
    getCurrentTurnId: () => string | undefined;
  } {
    const { agent, turnStager } = prepared;
    let currentTurnId: string | undefined;

    const unsubscribe = agent.subscribe((event: CoreAgentEvent) => {
      if (event.type === "turn_start") currentTurnId = event.turnId;
      if (event.type === "usage") {
        this.handleUsageEvent(event.usage);
      }
      if (event.type === "prompt_signature") {
        this.handlePromptSignatureEvent(event.hashes);
      }

      const keepRecentTokens = this.config.compaction?.keepRecentTokens ?? 20_000;
      turnStager.handleEvent(event, keepRecentTokens);
      this.emitToListeners(event);

      const snapshot = turnStager.getSnapshot();
      this.state.setPending(snapshot.entries, snapshot.leafId);
    });

    return {
      unsubscribe,
      getCurrentTurnId: () => currentTurnId,
    };
  }

  private async executeRun(agent: Agent, userMessage: Message, signal?: AbortSignal): Promise<void> {
    await agent.prompt(userMessage, signal);
  }

  private commitRun(turnStager: TurnStager): void {
    this.appendEntries(turnStager.getSnapshot().entries);
  }

  private handleRunError(err: unknown, turnId?: string): void {
    const serializable = toSerializableError(err);
    console.error(
      "[SessionManager] Run error session=%s name=%s message=%s lastPersisted=%s",
      this.persistence.sessionId,
      serializable.name,
      serializable.message,
      summarizeLastPersistedMessage(this.state.getCommittedEntries()),
    );
    this.appendError(serializable, { fatal: true, turnId });
  }

  private finishRun(unsubscribe: () => void): void {
    this.state.clearPending();
    unsubscribe();
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new Error("Aborted");
    }
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
      parentId: this.state.getCommittedLeafId(),
      timestamp: new Date().toISOString(),
      summary: event.summary,
      recentUserMessages: event.recentUserMessages,
      tokensBefore: event.tokensBefore,
      tokensAfter: event.tokensAfter,
    };
    this.appendAndPersist(entry);
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

    if (this._agent) {
      msgs.push(...this._agent.drainPendingMessages());
    }

    msgs.push(...this.pendingMessages.splice(0));

    if (msgs.length === 0) return null;
    return msgs.map((m) => (m.role === "user" && typeof m.content === "string" ? m.content : ""));
  }

  appendModeChange(mode: Mode, changedBy: ModeChangeEntry["changedBy"] = "command"): void {
    const entry: ModeChangeEntry = {
      type: "mode_change",
      id: generateEntryId(),
      parentId: this.state.getCommittedLeafId(),
      timestamp: new Date().toISOString(),
      mode,
      changedBy,
    };
    this.appendAndPersist(entry);
  }

  appendEffortChange(
    effort: "none" | "low" | "medium" | "high" | "max",
    changedBy: EffortChangeEntry["changedBy"] = "command",
  ): void {
    const entry: EffortChangeEntry = {
      type: "effort_change",
      id: generateEntryId(),
      parentId: this.state.getCommittedLeafId(),
      timestamp: new Date().toISOString(),
      effort,
      changedBy,
    };
    this.appendAndPersist(entry);
  }

  appendError(error: ErrorEntry["error"], options?: { fatal?: boolean; turnId?: string }): void {
    const entry: ErrorEntry = {
      type: "error",
      id: generateEntryId(),
      parentId: this.state.getCommittedLeafId(),
      timestamp: new Date().toISOString(),
      turnId: options?.turnId,
      fatal: options?.fatal ?? false,
      error,
    };
    this.memoryErrors.push(entry);
  }

  private appendMessageEntry(message: Message): SessionEntry {
    const entry = this.createMessageEntry(message, this.state.getCommittedLeafId());
    this.appendEntries([entry]);
    return entry;
  }

  private handleUsageEvent(usage: { cacheReadTokens: number }): void {
    const prevCacheRead = this.prevCacheReadBySession.get(this.persistence.sessionId) ?? 0;
    if (usage.cacheReadTokens < prevCacheRead) {
      const sessionEntryCount = this.state.getCommittedEntries().length;
      const prevPromptHashes = this.prevPromptHashesBySession.get(this.persistence.sessionId) ?? [];
      const currPromptHashes = this.currPromptHashesBySession.get(this.persistence.sessionId) ?? [];
      const sharedPrefixCount = sharedPrefixLength(prevPromptHashes, currPromptHashes);
      const fullyMatchedPrefix = sharedPrefixCount === Math.min(prevPromptHashes.length, currPromptHashes.length);
      if (fullyMatchedPrefix) {
        console.error(
          "[SessionManager] Cache drop session=%s entries=%d: %d -> %d",
          this.persistence.sessionId,
          sessionEntryCount,
          prevCacheRead,
          usage.cacheReadTokens,
        );
      } else {
        console.error(
          "[SessionManager] Cache drop session=%s entries=%d: %d -> %d prefix=partial(%d/%d,%d) prevSig=%s currSig=%s",
          this.persistence.sessionId,
          sessionEntryCount,
          prevCacheRead,
          usage.cacheReadTokens,
          sharedPrefixCount,
          prevPromptHashes.length,
          currPromptHashes.length,
          prevPromptHashes.join("|"),
          currPromptHashes.join("|"),
        );
      }
    }
    this.prevCacheReadBySession.set(this.persistence.sessionId, usage.cacheReadTokens);
  }

  private handlePromptSignatureEvent(hashes: string[]): void {
    const sessionId = this.persistence.sessionId;
    const prev = this.currPromptHashesBySession.get(sessionId);
    if (prev) {
      this.prevPromptHashesBySession.set(sessionId, prev);
    }
    this.currPromptHashesBySession.set(sessionId, hashes);
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

  private appendAndPersist(entry: SessionEntry): void {
    this.state.appendCommitted([entry]);
    this.persistence.append(entry, (error) => {
      const detail = entry.type === "message" ? entry.message.role : entry.type;
      console.error(
        "[SessionManager] Failed to persist %s for session=%s: %s",
        detail,
        this.persistence.sessionId,
        error instanceof Error ? error.message : String(error),
      );
    });
  }

  private appendEntries(entries: SessionEntry[]): void {
    this.state.appendCommitted(entries);
    this.persistence.appendMany(entries, (error, entry) => {
      const detail = entry.type === "message" ? entry.message.role : entry.type;
      console.error(
        "[SessionManager] Failed to persist %s for session=%s: %s",
        detail,
        this.persistence.sessionId,
        error instanceof Error ? error.message : String(error),
      );
    });
  }

  private emitToListeners(event: CoreAgentEvent): void {
    const enriched: AgentEvent =
      event.type === "usage" && this._agent
        ? { ...event, cost: calculateUsageCost(this._agent.model, event.usage) }
        : event.type === "tool_start"
          ? {
              ...event,
              render: createToolStartRenderPayload(event.toolName, event.input),
            }
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

  get sessionPath(): string | null {
    return this.persistence.sessionPath;
  }

  get sessionId(): string {
    return this.persistence.sessionId;
  }

  get entryCount(): number {
    return this.state.entryCount;
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

function sharedPrefixLength(a: readonly string[], b: readonly string[]): number {
  const max = Math.min(a.length, b.length);
  let index = 0;
  while (index < max && a[index] === b[index]) {
    index += 1;
  }
  return index;
}
