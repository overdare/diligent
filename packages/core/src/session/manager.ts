// @summary Session manager orchestrating agent loop, persistence, compaction, and steering
import { agentLoop } from "../agent/loop";
import type { AgentEvent, AgentLoopConfig, ModeKind } from "../agent/types";
import { EventStream } from "../event-stream";
import type { DiligentPaths } from "../infrastructure/diligent-dir";
import { ProviderError } from "../provider/types";
import type { Message } from "../types";
import {
  estimateTokens,
  extractFileOperations,
  findRecentUserMessages,
  generateSummary,
  shouldCompact,
} from "./compaction";
import { buildSessionContext } from "./context-builder";
import { DeferredWriter, listSessions, readSessionFile } from "./persistence";
import type { CollabSessionMeta, CompactionEntry, ModeChangeEntry, SessionEntry, SessionInfo } from "./types";
import { generateEntryId } from "./types";

export interface SessionManagerConfig {
  cwd: string;
  paths: DiligentPaths;
  // D087: Factory allows per-run config (e.g. collaboration mode, mid-session knowledge refresh)
  agentConfig: AgentLoopConfig | (() => AgentLoopConfig);
  compaction?: {
    enabled: boolean;
    reserveTokens: number;
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
  private writer: DeferredWriter;
  private byId = new Map<string, SessionEntry>();
  private writeQueue: Promise<void> = Promise.resolve();
  private pendingMessages: Message[] = [];
  private lastApiInputTokens = 0;

  constructor(private config: SessionManagerConfig) {
    this.writer = new DeferredWriter(
      config.paths.sessions,
      config.cwd,
      undefined,
      config.parentSession,
      config.collabMeta,
    );
  }

  /** Create a new session */
  async create(): Promise<void> {
    this.entries = [];
    this.leafId = null;
    this.byId.clear();
    this.writeQueue = Promise.resolve();
    this.writer = new DeferredWriter(
      this.config.paths.sessions,
      this.config.cwd,
      undefined,
      this.config.parentSession,
      this.config.collabMeta,
    );
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
    this.writer = new DeferredWriter(this.config.paths.sessions, this.config.cwd, sessionPath);

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
      reserveTokens: 16384,
      keepRecentTokens: 20000,
    };

    // 4. Create outer stream that wraps the agent loop
    const outerStream = new EventStream<AgentEvent, Message[]>(
      (event) => event.type === "agent_end",
      (event) => (event as { type: "agent_end"; messages: Message[] }).messages,
    );

    const signal = this.resolveAgentConfig().signal;
    if (signal) outerStream.attachSignal(signal);

    const innerWork = this.runSession(context.messages, compactionConfig, outerStream).catch((err) => {
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
    compactionConfig: { enabled: boolean; reserveTokens: number; keepRecentTokens: number },
    outerStream: EventStream<AgentEvent, Message[]>,
  ): Promise<void> {
    let currentMessages = messages;

    // Proactive compaction
    if (compactionConfig.enabled) {
      const heuristicTokens = estimateTokens(currentMessages);
      const tokens = Math.max(heuristicTokens, this.lastApiInputTokens);
      if (shouldCompact(tokens, this.resolveAgentConfig().model.contextWindow, compactionConfig.reserveTokens)) {
        currentMessages = await this.performCompaction(tokens, compactionConfig, outerStream);
      }
    }

    outerStream.push({ type: "agent_start" });

    while (true) {
      let result: Message[];

      try {
        const innerStream = agentLoop(currentMessages, this.resolveAgentConfig());

        let fatalError: AgentEvent | null = null;

        for await (const event of innerStream) {
          this.handleEvent(event);

          if (event.type === "error" && event.fatal) {
            fatalError = event;
            continue;
          }
          if (event.type === "agent_start" || event.type === "agent_end") continue;
          outerStream.push(event);
        }

        if (fatalError && fatalError.type === "error") {
          const msg = fatalError.error.message.toLowerCase();
          const isContextOverflow =
            msg.includes("context") ||
            msg.includes("too many tokens") ||
            msg.includes("maximum") ||
            msg.includes("context_overflow");
          const isAbort = fatalError.error.name === "AbortError" || msg === "aborted";

          if (isContextOverflow) {
            throw new ProviderError(fatalError.error.message, "context_overflow", false);
          }
          if (isAbort) {
            outerStream.error(new Error("Aborted"));
            return;
          }
          outerStream.push(fatalError);
        }

        result = await innerStream.result();
      } catch (err) {
        if (err instanceof ProviderError && err.errorType === "context_overflow" && compactionConfig.enabled) {
          const tokens = Math.max(estimateTokens(currentMessages), this.lastApiInputTokens);
          currentMessages = await this.performCompaction(tokens, compactionConfig, outerStream);
          continue;
        }
        throw err;
      }

      // On abort, stop immediately even if pending queue is non-empty.
      // Otherwise we can re-enter agentLoop with an already-aborted signal forever
      // (agentLoop exits at top-of-loop before draining pending steering messages).
      if (this.resolveAgentConfig().signal?.aborted) {
        return;
      }

      // Check unified queue — pending messages trigger next iteration
      if (this.pendingMessages.length === 0) {
        outerStream.push({ type: "agent_end", messages: result });
        outerStream.end(result);
        return;
      }

      // Rebuild context for next iteration
      const context = buildSessionContext(this.entries, this.leafId);
      currentMessages = context.messages;
    }
  }

  private async performCompaction(
    tokensBefore: number,
    compactionConfig: { reserveTokens: number; keepRecentTokens: number },
    stream: EventStream<AgentEvent, Message[]>,
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

    // Generate summary (D037)
    const summary = await generateSummary(
      messagesToSummarize,
      this.resolveAgentConfig().streamFunction,
      this.resolveAgentConfig().model,
      { previousSummary: previousCompaction?.summary, signal: this.resolveAgentConfig().signal },
    );

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

  private handleEvent(event: AgentEvent): void {
    if (event.type === "message_end") {
      this.appendMessageEntry(event.message);
      if (event.message.usage.inputTokens > 0) {
        this.lastApiInputTokens = event.message.usage.inputTokens;
      }
    } else if (event.type === "turn_end") {
      for (const toolResult of event.toolResults) {
        this.appendMessageEntry(toolResult);
      }
    } else if (event.type === "steering_injected") {
      // Event-Ordered Persistence: consumer persists steering messages
      for (const msg of event.messages) {
        this.appendMessageEntry(msg);
      }
    }
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
    this.writeQueue = this.writeQueue.then(() => this.writer.write(entry)).catch(() => {});

    return entry;
  }

  private resolveAgentConfig(): AgentLoopConfig {
    const base = typeof this.config.agentConfig === "function" ? this.config.agentConfig() : this.config.agentConfig;
    return {
      ...base,
      getSteeringMessages: () => this.drainPendingMessages(),
      hasPendingMessages: () => this.pendingMessages.length > 0,
    };
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
