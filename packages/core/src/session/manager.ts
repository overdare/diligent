// @summary Session manager orchestrating agent loop, persistence, compaction, and steering
import {
  calculateCost,
  createTurnRuntime,
  drainSteering,
  executeToolCalls,
  streamAssistantResponse,
  toSerializableError,
} from "../agent/loop";
import { LoopDetector } from "../agent/loop-detector";
import type { AgentEvent, AgentLoopConfig, ModeKind } from "../agent/types";
import { EventStream } from "../event-stream";
import type { DiligentPaths } from "../infrastructure/diligent-dir";
import { ProviderError } from "../provider/types";
import type { AssistantMessage, Message, ToolCallBlock } from "../types";
import {
  estimateTokens,
  extractFileOperations,
  findRecentUserMessages,
  generateSummary,
  shouldCompact,
} from "./compaction";
import { buildSessionContext } from "./context-builder";
import { listSessions, readSessionFile, SessionWriter } from "./persistence";
import type {
  CollabSessionMeta,
  CompactionEntry,
  EffortChangeEntry,
  ModeChangeEntry,
  SessionEntry,
  SessionInfo,
} from "./types";
import { generateEntryId } from "./types";

export interface SessionManagerConfig {
  cwd: string;
  paths: DiligentPaths;
  // D087: Factory allows per-run config (e.g. collaboration mode, mid-session knowledge refresh)
  agentConfig: AgentLoopConfig | (() => AgentLoopConfig | Promise<AgentLoopConfig>);
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
  private writer: SessionWriter;
  private byId = new Map<string, SessionEntry>();
  private writeQueue: Promise<void> = Promise.resolve();
  private pendingMessages: Message[] = [];
  private lastApiInputTokens = 0;

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
    this.byId.clear();
    this.writeQueue = Promise.resolve();
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

    // Inject synthetic results for orphaned tool_calls
    for (const id of toolCallIds) {
      const block = toolCalls.find((b) => (b as { id: string }).id === id);
      this.appendMessageEntry({
        role: "tool_result",
        toolCallId: id,
        toolName: (block as { name: string })?.name ?? "unknown",
        output: "Session interrupted before tool execution completed.",
        isError: true,
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
    const context = buildSessionContext(this.entries, this.leafId);
    return context.messages;
  }

  /**
   * Reconcile in-memory entries with the persisted session file.
   *
   * This protects long-lived runtimes from stale in-memory state (for example,
   * if a runtime instance got out-of-sync while the canonical JSONL on disk has
   * newer entries). Existing in-memory state wins when it is already newer.
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

    // Ensure this manager's queued writes are settled before comparing snapshots.
    await this.writeQueue.catch(() => {});

    const { entries } = await readSessionFile(sessionPath);
    const diskLeafId = entries.length > 0 ? entries[entries.length - 1].id : null;
    const diskTailEntryIds = summarizeTailEntryIds(entries);
    const diskTailMessage = summarizeLastPersistedMessage(entries);

    // Keep current in-memory state if it is already newer than disk.
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

  getCurrentEffort(): "low" | "medium" | "high" | "max" | undefined {
    return buildSessionContext(this.entries, this.leafId).currentEffort;
  }

  /**
   * Run the agent loop with the current session context.
   * Persists user message and agent response to session.
   * Handles proactive and reactive compaction.
   */
  run(userMessage: Message): EventStream<AgentEvent, Message[]> {
    // 1. Add user message to entries (queued persistence)
    this.appendMessageEntry(userMessage);

    // 2. Build context from tree
    const context = buildSessionContext(this.entries, this.leafId);

    // 3. Compaction config
    const compactionConfig = this.config.compaction ?? {
      enabled: true,
      reservePercent: 16,
      keepRecentTokens: 20000,
    };

    // 4. Create outer stream that wraps the session loop
    const outerStream = new EventStream<AgentEvent, Message[]>(
      (event) => event.type === "agent_end",
      (event) => (event as { type: "agent_end"; messages: Message[] }).messages,
    );

    // Resolve config — may be sync or async depending on whether factory returns a Promise.
    // When sync, we preserve the original microtask timing: runSession starts in the same
    // synchronous execution frame as run(), which is critical for steering message delivery.
    const configResult = this.resolveAgentConfig();
    const startSession = (initialConfig: AgentLoopConfig) => {
      if (initialConfig.signal) outerStream.attachSignal(initialConfig.signal);
      return this.runSession(context.messages, compactionConfig, outerStream, initialConfig);
    };
    const innerWork = (
      configResult instanceof Promise ? configResult.then(startSession) : startSession(configResult)
    ).catch((err) => {
      outerStream.push({
        type: "error",
        error: { message: String(err), name: err?.name ?? "Error" },
        fatal: true,
      });
      outerStream.push({ type: "agent_end", messages: context.messages });
      outerStream.end(context.messages);
    });
    outerStream.setInnerWork(innerWork);

    return outerStream;
  }

  /** Wait for all pending writes to complete. */
  async waitForWrites(): Promise<void> {
    await this.writeQueue;
  }

  private async runSession(
    messages: Message[],
    compactionConfig: { enabled: boolean; reservePercent: number; keepRecentTokens: number },
    outerStream: EventStream<AgentEvent, Message[]>,
    initialConfig: AgentLoopConfig,
  ): Promise<void> {
    let currentMessages = [...messages];
    let currentConfig = initialConfig;
    let turnCount = 0;
    const maxTurns = initialConfig.maxTurns;
    let itemCounter = 0;
    const generateItemId = () => `item-${++itemCounter}`;
    const loopDetector = new LoopDetector();

    outerStream.push({ type: "agent_start" });

    while (maxTurns === undefined || turnCount < maxTurns) {
      if (turnCount > 0) {
        const nextConfigResult = this.resolveAgentConfig();
        currentConfig = nextConfigResult instanceof Promise ? await nextConfigResult : nextConfigResult;
      }

      if (currentConfig.signal?.aborted) {
        console.log("[SessionManager] signal aborted at top-of-loop, breaking after %d turns", turnCount);
        return;
      }

      if (compactionConfig.enabled) {
        const heuristicTokens = estimateTokens(currentMessages);
        const tokens = Math.max(heuristicTokens, this.lastApiInputTokens);
        if (shouldCompact(tokens, currentConfig.model.contextWindow, compactionConfig.reservePercent)) {
          currentMessages = await this.performCompaction(tokens, compactionConfig, outerStream, currentConfig);
        }
      }

      turnCount++;
      const turnId = `turn-${turnCount}`;
      outerStream.push({ type: "turn_start", turnId });

      const drainedSteering = drainSteering(currentConfig, currentMessages, outerStream);
      for (const msg of drainedSteering) {
        this.appendMessageEntry(msg);
      }

      let assistantMessage: AssistantMessage;
      try {
        const turnRuntime = createTurnRuntime(currentConfig, outerStream);
        assistantMessage = await streamAssistantResponse(
          currentMessages,
          currentConfig,
          turnRuntime,
          outerStream,
          generateItemId,
        );

        currentMessages.push(assistantMessage);
        this.appendMessageEntry(assistantMessage);
        if (assistantMessage.usage.inputTokens > 0) {
          this.lastApiInputTokens = assistantMessage.usage.inputTokens;
        }

        outerStream.push({
          type: "usage",
          usage: assistantMessage.usage,
          cost: calculateCost(currentConfig.model, assistantMessage.usage),
        });

        const toolCalls = assistantMessage.content.filter((b): b is ToolCallBlock => b.type === "tool_call");

        if (toolCalls.length === 0) {
          const hasPending = currentConfig.hasPendingMessages?.() ?? false;
          outerStream.push({ type: "turn_end", turnId, message: assistantMessage, toolResults: [] });
          if (!hasPending) {
            outerStream.push({ type: "agent_end", messages: currentMessages });
            outerStream.end(currentMessages);
            return;
          }
        } else {
          const { executions, abortAfterTurn } = await executeToolCalls(
            toolCalls,
            currentConfig,
            turnRuntime,
            outerStream,
            generateItemId,
          );
          const toolResults = executions.map((execution) => execution.toolResult);

          for (const execution of executions) {
            this.appendMessageEntry(execution.toolResult);
            if (!execution.includeInConversation) continue;
            currentMessages.push(execution.toolResult);
            loopDetector.record(execution.toolCall.name, execution.toolCall.input);
          }

          if (abortAfterTurn) {
            const abortingTools = executions
              .filter((execution) => !execution.includeInConversation)
              .map((execution) => execution.toolCall.name);
            console.log(
              "[SessionManager]%s Ending run after tool-requested stop; session may legitimately end on tool_result (abortingTools=%s toolResults=%d)",
              buildSessionDebugScope(currentConfig, turnId, this.writer.id),
              abortingTools.length > 0 ? abortingTools.join(",") : "-",
              toolResults.length,
            );
          }

          const loopResult = loopDetector.check();
          if (loopResult.detected) {
            outerStream.push({
              type: "loop_detected",
              patternLength: loopResult.patternLength!,
              toolName: loopResult.toolName!,
            });
            currentMessages.push({
              role: "user",
              content: `[WARNING: Loop detected — tool "${loopResult.toolName}" is being called in a repeating pattern (length ${loopResult.patternLength}). Try a different approach.]`,
              timestamp: Date.now(),
            });
          }

          outerStream.push({ type: "turn_end", turnId, message: assistantMessage, toolResults });

          if (abortAfterTurn) {
            outerStream.push({ type: "agent_end", messages: currentMessages });
            outerStream.end(currentMessages);
            return;
          }
        }
      } catch (err) {
        const serializable = toSerializableError(err);
        const msg = serializable.message.toLowerCase();
        const isContextOverflow =
          err instanceof ProviderError
            ? err.errorType === "context_overflow"
            : msg.includes("context") ||
              msg.includes("too many tokens") ||
              msg.includes("maximum") ||
              msg.includes("context_overflow");
        const isAbort =
          serializable.name === "AbortError" || msg === "aborted" || (currentConfig.signal?.aborted ?? false);

        if (isContextOverflow && compactionConfig.enabled) {
          const tokens = Math.max(estimateTokens(currentMessages), this.lastApiInputTokens);
          currentMessages = await this.performCompaction(tokens, compactionConfig, outerStream, currentConfig);
          turnCount--;
          continue;
        }

        if (isAbort) {
          console.log(
            "[SessionManager]%s Run aborted after last persisted message=%s",
            buildSessionDebugScope(currentConfig, turnId, this.writer.id),
            summarizeLastPersistedMessage(this.entries),
          );
          outerStream.error(new Error("Aborted"));
          return;
        }

        outerStream.push({ type: "error", error: serializable, fatal: true });
        outerStream.push({ type: "agent_end", messages: currentMessages });
        outerStream.end(currentMessages);
        return;
      }

      if (currentConfig.signal?.aborted) {
        return;
      }
    }

    outerStream.push({ type: "agent_end", messages: currentMessages });
    outerStream.end(currentMessages);
  }

  private async performCompaction(
    tokensBefore: number,
    compactionConfig: { reservePercent: number; keepRecentTokens: number },
    stream: EventStream<AgentEvent, Message[]>,
    currentConfig?: AgentLoopConfig,
  ): Promise<Message[]> {
    stream.push({ type: "compaction_start", estimatedTokens: tokensBefore });

    // Find recent user messages and entries to summarize
    const pathEntries = this.getPathEntries();
    const result = findRecentUserMessages(pathEntries, compactionConfig.keepRecentTokens);

    if (result.entriesToSummarize.length === 0) {
      // Nothing to compact — no entries after last compaction
      const context = buildSessionContext(this.entries, this.leafId);
      stream.push({
        type: "compaction_end",
        tokensBefore,
        tokensAfter: tokensBefore,
        summary: "(no compaction needed)",
      });
      return context.messages;
    }

    // Find previous compaction for iterative updating
    const previousCompaction = this.findPreviousCompaction();

    // Summarize ALL entries (not a subset)
    const messagesToSummarize: Message[] = [];
    for (const entry of result.entriesToSummarize) {
      if (entry.type === "message") messagesToSummarize.push(entry.message);
    }

    // Extract file operations (D039)
    const details = extractFileOperations(messagesToSummarize, previousCompaction?.details);

    // Generate summary (D037) using the current turn config when available
    const cfg = currentConfig ?? (await this.resolveAgentConfig());
    const summary = await generateSummary(messagesToSummarize, cfg.streamFunction, cfg.model, {
      previousSummary: previousCompaction?.summary,
      signal: cfg.signal,
      reservePercent: cfg.reservePercent,
    });

    // Save CompactionEntry
    const compactionEntry: CompactionEntry = {
      type: "compaction",
      id: generateEntryId(),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      summary,
      recentUserMessages: result.recentUserMessages,
      tokensBefore,
      tokensAfter: 0, // will be calculated after rebuild
      details,
    };

    this.entries.push(compactionEntry);
    this.byId.set(compactionEntry.id, compactionEntry);
    this.leafId = compactionEntry.id;
    this.writeQueue = this.writeQueue.then(() => this.writer.write(compactionEntry)).catch(() => {});

    // Rebuild context with compaction
    const newContext = buildSessionContext(this.entries, this.leafId);
    const tokensAfter = estimateTokens(newContext.messages);

    // Update tokensAfter in the entry
    compactionEntry.tokensAfter = tokensAfter;

    // Build tail preview for debugging and UI display
    const tail = newContext.messages.slice(-5);
    const tailMessages = tail.map((m) => {
      if (m.role === "user")
        return { role: "user", preview: typeof m.content === "string" ? m.content.slice(0, 80) : "(blocks)" };
      if (m.role === "assistant") {
        const types = m.content.map((b) => b.type).join(", ");
        return { role: "assistant", preview: `[${types}] stop=${m.stopReason}` };
      }
      if (m.role === "tool_result") return { role: "tool_result", preview: `${m.toolName} err=${m.isError}` };
      return { role: (m as { role: string }).role, preview: "" };
    });

    console.log(
      "[Compaction] Rebuilt %d messages (%dk → %dk), last 5: %s",
      newContext.messages.length,
      Math.round(tokensBefore / 1000),
      Math.round(tokensAfter / 1000),
      JSON.stringify(tailMessages),
    );

    stream.push({
      type: "compaction_end",
      tokensBefore,
      tokensAfter,
      summary: summary.length > 200 ? `${summary.slice(0, 200)}...` : summary,
      tailMessages,
    });

    return newContext.messages;
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

  /** Find the most recent CompactionEntry in the current path */
  private findPreviousCompaction(): CompactionEntry | undefined {
    const path = this.getPathEntries();
    for (let i = path.length - 1; i >= 0; i--) {
      if (path[i].type === "compaction") {
        return path[i] as CompactionEntry;
      }
    }
    return undefined;
  }

  /** Queue a steering message into the unified pending queue.
   * Memory-only — persisted via event-ordered persistence when drained. */
  steer(content: string): void {
    this.pendingMessages.push({
      role: "user",
      content,
      timestamp: Date.now(),
    });
  }

  /** Check if pending messages exist (steering or follow-up). */
  hasPendingMessages(): boolean {
    return this.pendingMessages.length > 0;
  }

  /** Pop any undrained pending messages. Returns null if empty. */
  popPendingMessages(): string[] | null {
    if (this.pendingMessages.length === 0) return null;
    const contents = this.pendingMessages.map((m) =>
      m.role === "user" && typeof m.content === "string" ? m.content : "",
    );
    this.pendingMessages.length = 0;
    return contents;
  }

  private drainPendingMessages(): Message[] {
    return this.pendingMessages.splice(0);
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
    effort: "low" | "medium" | "high" | "max",
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

  private appendMessageEntry(message: Message): SessionEntry {
    const entry: SessionEntry = {
      type: "message",
      id: generateEntryId(),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      message,
    };

    this.entries.push(entry);
    this.byId.set(entry.id, entry);
    this.leafId = entry.id;

    // Chain writes to avoid concurrent file access
    this.writeQueue = this.writeQueue
      .then(async () => {
        await this.writer.write(entry);
        if (message.role === "tool_result") {
          console.log(
            "[SessionManager] Persisted tool_result session=%s tool=%s callId=%s isError=%s",
            this.writer.id,
            message.toolName,
            message.toolCallId,
            message.isError,
          );
        }
      })
      .catch((error) => {
        console.error(
          "[SessionManager] Failed to persist %s for session=%s: %s",
          message.role,
          this.writer.id,
          error instanceof Error ? error.message : String(error),
        );
      });

    return entry;
  }

  /**
   * Resolve the agent config. When the factory returns a Promise, this returns a Promise.
   * When it returns synchronously, this returns synchronously — preserving microtask timing
   * for the run() flow where steering message delivery depends on execution order.
   */
  private resolveAgentConfig(): AgentLoopConfig | Promise<AgentLoopConfig> {
    const baseOrPromise =
      typeof this.config.agentConfig === "function" ? this.config.agentConfig() : this.config.agentConfig;
    const wrap = (base: AgentLoopConfig): AgentLoopConfig => ({
      ...base,
      reservePercent: base.reservePercent ?? this.config.compaction?.reservePercent ?? 16,
      getSteeringMessages: () => this.drainPendingMessages(),
      hasPendingMessages: () => this.pendingMessages.length > 0,
    });
    if (baseOrPromise instanceof Promise) {
      return baseOrPromise.then(wrap);
    }
    return wrap(baseOrPromise);
  }

  get sessionPath(): string | null {
    return this.writer.path;
  }

  get sessionId(): string {
    return this.writer.id;
  }

  get entryCount(): number {
    return this.entries.length;
  }
}

function buildSessionDebugScope(config: AgentLoopConfig, turnId: string, sessionId: string): string {
  const effort = config.effort ?? "high";
  return ` session=${sessionId} thread=${config.debugThreadId ?? "-"} turn=${turnId} effort=${effort}`;
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
