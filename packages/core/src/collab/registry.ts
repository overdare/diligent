// @summary AgentRegistry — spawn/wait/send_input/close lifecycle for non-blocking multi-agent collab
import { BUILTIN_AGENT_TYPES } from "../agent/agent-types";
import { PLAN_MODE_ALLOWED_TOOLS } from "../agent/types";
import type { ModelClass } from "../provider/models";
import { agentTypeToModelClass, resolveModelForClass } from "../provider/models";
import { SessionManager } from "../session/manager";
import type { TextBlock } from "../types";
import { NicknamePool } from "./nicknames";
import type { AgentEntry, AgentStatus, CollabAgentEvent, CollabToolDeps } from "./types";
import { isFinal } from "./types";

type CollabStatusString = "pending" | "running" | "completed" | "errored" | "shutdown";

function toCollabStatus(s: AgentStatus): CollabStatusString {
  return s.kind;
}

function statusMessage(s: AgentStatus): string | undefined {
  if (s.kind === "completed") return s.output ?? undefined;
  if (s.kind === "errored") return s.error;
  return undefined;
}

/** Tool names that belong to the collab layer — excluded from child agents. */
export const COLLAB_TOOL_NAMES = new Set(["spawn_agent", "wait", "send_input", "close_agent"]);

/** Subset of CollabToolDeps that can safely be mutated between turns (excludes structural fields). */
export type MutableCollabDeps = Omit<
  CollabToolDeps,
  "cwd" | "paths" | "parentTools" | "maxAgents" | "sessionManagerFactory"
>;

export class AgentRegistry {
  private agents = new Map<string, AgentEntry>();
  private pool = new NicknamePool();
  private maxAgents: number;
  private collabEventHandler?: (event: CollabAgentEvent) => void;

  constructor(private deps: CollabToolDeps) {
    this.maxAgents = deps.maxAgents ?? 8;
    this.collabEventHandler = deps.onCollabEvent;
  }

  /**
   * Update the mutable fields of CollabToolDeps in-place.
   * Called at the start of each turn when the registry is reused across turns.
   * Does NOT touch structural fields (cwd, paths, parentTools, maxAgents, sessionManagerFactory).
   */
  updateDeps(next: MutableCollabDeps): void {
    this.deps = {
      ...this.deps,
      model: next.model,
      systemPrompt: next.systemPrompt,
      streamFunction: next.streamFunction,
      getParentSessionId: next.getParentSessionId,
      ask: next.ask,
      onCollabEvent: next.onCollabEvent,
    };
    // Sync the collab event handler if it was updated
    if (next.onCollabEvent !== undefined) {
      this.collabEventHandler = next.onCollabEvent;
    }
  }

  /** Set or replace the collab event handler. Used by SessionManager to wire events into the active stream. */
  setCollabEventHandler(handler: ((event: CollabAgentEvent) => void) | undefined): void {
    this.collabEventHandler = handler;
  }

  private emit(event: CollabAgentEvent): void {
    // Collab debugging: always-on log at the source of truth.
    // This runs even if no handler is currently wired, which helps detect dropped events.
    const base = {
      type: event.type,
      // Narrow common fields for easier grepping
      callId: (event as { callId?: string }).callId,
      childThreadId: (event as { childThreadId?: string }).childThreadId,
      receiverThreadId: (event as { receiverThreadId?: string }).receiverThreadId,
    };
    const hasHandler = Boolean(this.collabEventHandler);
    console.log("[CollabRegistry] emit", { ...base, hasHandler });

    this.collabEventHandler?.(event);
  }

  /**
   * Spawn a new sub-agent in the background.
   * Synchronous — returns immediately with {threadId, nickname}.
   */
  spawn(params: {
    prompt: string;
    description: string;
    agentType: string;
    resumeId?: string;
    modelClass?: ModelClass;
  }): {
    threadId: string;
    nickname: string;
  } {
    const activeCount = [...this.agents.values()].filter((e) => !isFinal(e.status)).length;
    if (activeCount >= this.maxAgents) {
      throw new Error(`Max active agents reached (${this.maxAgents}). Close some agents first.`);
    }

    const agentType =
      params.agentType in BUILTIN_AGENT_TYPES
        ? BUILTIN_AGENT_TYPES[params.agentType as keyof typeof BUILTIN_AGENT_TYPES]
        : BUILTIN_AGENT_TYPES.general;
    const nickname = this.pool.reserve();
    const abortController = new AbortController();

    // Build child tool list
    let childTools = this.deps.parentTools;
    if (agentType.toolFilter === "readonly") {
      childTools = this.deps.parentTools.filter((t) => PLAN_MODE_ALLOWED_TOOLS.has(t.name));
    } else {
      // general: exclude collab tools (prevent nesting)
      childTools = this.deps.parentTools.filter((t) => !COLLAB_TOOL_NAMES.has(t.name));
    }

    const childSystemPrompt = agentType.systemPromptPrefix
      ? [{ label: "agent_role", content: agentType.systemPromptPrefix }, ...this.deps.systemPrompt]
      : [...this.deps.systemPrompt];

    // Resolve model class: explicit override > agent_type-based default
    const targetClass: ModelClass = params.modelClass ?? agentTypeToModelClass(params.agentType, this.deps.model);
    const childModel = resolveModelForClass(this.deps.model, targetClass);

    const factory = this.deps.sessionManagerFactory ?? ((cfg) => new SessionManager(cfg));
    const childManager = factory({
      cwd: this.deps.cwd,
      paths: this.deps.paths,
      agentConfig: {
        model: childModel,
        systemPrompt: childSystemPrompt,
        tools: childTools,
        streamFunction: this.deps.streamFunction,
        maxTurns: agentType.maxTurns,
        signal: abortController.signal,
        // Wrap the parent ask callback to inject source attribution (threadId + nickname).
        ask: this.deps.ask
          ? (request: import("../tool/types").UserInputRequest) =>
              this.deps.ask!({ ...request, source: { threadId: childManager.sessionId, nickname } })
          : undefined,
      },
      compaction: { enabled: true, reservePercent: 16, keepRecentTokens: 20000 },
      parentSession: this.deps.getParentSessionId?.(),
      collabMeta: {
        nickname,
        description: params.description || undefined,
      },
    });

    // Use child sessionId as the canonical threadId
    const threadId = childManager.sessionId;
    const callId = threadId;

    this.emit({
      type: "collab_spawn_begin",
      callId,
      prompt: params.prompt,
    });

    const entry: AgentEntry = {
      threadId,
      nickname,
      agentType: params.agentType,
      description: params.description,
      sessionManager: childManager,
      promise: Promise.resolve({ kind: "pending" as const }), // replaced below
      status: { kind: "pending" },
      abortController,
      createdAt: Date.now(),
    };

    // Background promise — always resolves, never rejects
    const emitErroredSpawnEnd = (message: string): void => {
      this.emit({
        type: "collab_spawn_end",
        callId,
        childThreadId: threadId,
        nickname,
        description: params.description || undefined,
        prompt: params.prompt,
        status: "errored",
        message,
      });
    };

    const promise = (async (): Promise<AgentStatus> => {
      entry.status = { kind: "running" };

      // Create or resume session
      if (params.resumeId) {
        const resumed = await childManager.resume({ sessionId: params.resumeId });
        if (!resumed) await childManager.create();
      } else {
        await childManager.create();
      }

      const userMessage = {
        role: "user" as const,
        content: params.prompt,
        timestamp: Date.now(),
      };

      const stream = childManager.run(userMessage);
      let output: string | null = null;
      let turnNumber = 0;

      for await (const event of stream) {
        if (event.type === "turn_start") {
          turnNumber++;
          this.emit({
            type: "turn_start",
            turnId: event.turnId,
            childThreadId: threadId,
            nickname,
            turnNumber,
          });
        } else if (event.type === "tool_start") {
          this.emit({
            ...event,
            childThreadId: threadId,
            nickname,
          });
        } else if (event.type === "tool_update") {
          this.emit({
            ...event,
            childThreadId: threadId,
            nickname,
          });
        } else if (event.type === "tool_end") {
          this.emit({
            ...event,
            childThreadId: threadId,
            nickname,
          });
        } else if (event.type === "message_end") {
          const textBlocks = event.message.content.filter((b): b is TextBlock => b.type === "text");
          output = textBlocks.map((b) => b.text).join("\n") || null;
        } else if (event.type === "error" && event.fatal) {
          await childManager.waitForWrites();
          const status: AgentStatus = { kind: "errored", error: event.error.message };
          entry.status = status;
          emitErroredSpawnEnd(event.error.message);
          return status;
        }
      }

      await childManager.waitForWrites();
      const status: AgentStatus = { kind: "completed", output };
      entry.status = status;
      return status;
    })().catch((err: unknown): AgentStatus => {
      const message = String(err);
      const status: AgentStatus = { kind: "errored", error: message };
      entry.status = status;
      emitErroredSpawnEnd(message);
      return status;
    });

    entry.promise = promise;
    this.agents.set(threadId, entry);

    this.emit({
      type: "collab_spawn_end",
      callId,
      childThreadId: threadId,
      nickname,
      description: params.description || undefined,
      prompt: params.prompt,
      status: "running",
    });

    return { threadId, nickname };
  }

  /**
   * Wait for one or more agents to reach a final state.
   * Returns once any of the ids are done (or timeout fires).
   * onUpdate is called with a status summary string on each change.
   */
  async wait(
    ids: string[],
    timeoutMs: number,
    onUpdate?: (s: string) => void,
    signal?: AbortSignal,
  ): Promise<{ status: Record<string, AgentStatus>; timedOut: boolean }> {
    const unknownIds = ids.filter((id) => !this.agents.has(id));
    if (unknownIds.length > 0) {
      throw new Error(`Unknown agent IDs: ${unknownIds.join(", ")}`);
    }

    const waitCallId = `wait-${Date.now()}`;
    this.emit({
      type: "collab_wait_begin",
      callId: waitCallId,
      agents: ids.map((id) => {
        const entry = this.agents.get(id)!;
        return { threadId: id, nickname: entry.nickname, description: entry.description || undefined };
      }),
    });

    const result: Record<string, AgentStatus> = {};
    const pending: AgentEntry[] = [];

    for (const id of ids) {
      const entry = this.agents.get(id)!;
      if (isFinal(entry.status)) {
        result[id] = entry.status;
      } else {
        pending.push(entry);
      }
    }

    if (pending.length === 0) {
      return { status: result, timedOut: false };
    }

    // Wait for the first batch of pending to finish or timeout
    const statusSummary = () => {
      const parts = ids.map((id) => {
        const e = this.agents.get(id)!;
        const done = isFinal(e.status);
        return `${e.nickname} ${done ? "✓" : e.status.kind}`;
      });
      return parts.join(" | ");
    };

    let timedOut = false;
    let resolved = false;

    const timeoutPromise = new Promise<void>((resolve) =>
      setTimeout(() => {
        if (!resolved) {
          timedOut = true;
          resolve();
        }
      }, timeoutMs),
    );

    const racers = pending.map((entry) =>
      entry.promise.then((status) => {
        result[entry.threadId] = status;
        onUpdate?.(statusSummary());
      }),
    );

    const abortPromise = signal
      ? new Promise<void>((resolve) => {
          if (signal.aborted) {
            timedOut = true;
            resolve();
            return;
          }
          signal.addEventListener(
            "abort",
            () => {
              if (!resolved) {
                timedOut = true;
                resolve();
              }
            },
            { once: true },
          );
        })
      : new Promise<void>(() => {}); // never resolves

    await Promise.race([Promise.all(racers), timeoutPromise, abortPromise]);
    resolved = true;

    // Collect final statuses — agents are retained (not deleted) for later reference
    for (const id of ids) {
      if (!(id in result)) {
        const entry = this.agents.get(id)!;
        result[id] = entry.status;
      }
    }

    this.emit({
      type: "collab_wait_end",
      callId: waitCallId,
      agentStatuses: ids.map((id) => {
        const entry = this.agents.get(id)!;
        const status = result[id] ?? entry.status;
        return {
          threadId: id,
          nickname: entry.nickname,
          status: toCollabStatus(status),
          message: statusMessage(status),
        };
      }),
      timedOut,
    });

    return { status: result, timedOut };
  }

  /** Send a steering message to a running agent. */
  async sendInput(threadId: string, message: string): Promise<void> {
    const entry = this.agents.get(threadId);
    if (!entry) throw new Error(`Unknown agent: ${threadId}`);
    if (isFinal(entry.status)) throw new Error(`Agent ${entry.nickname} is not running (${entry.status.kind})`);

    const callId = `interaction-${threadId}-${Date.now()}`;
    this.emit({
      type: "collab_interaction_begin",
      callId,
      receiverThreadId: threadId,
      receiverNickname: entry.nickname,
      prompt: message,
    });

    entry.sessionManager.steer(message);

    this.emit({
      type: "collab_interaction_end",
      callId,
      receiverThreadId: threadId,
      receiverNickname: entry.nickname,
      prompt: message,
      status: toCollabStatus(entry.status),
    });
  }

  /** Abort an agent and wait for it to settle. Returns final status. */
  async close(threadId: string): Promise<AgentStatus> {
    const entry = this.agents.get(threadId);
    if (!entry) throw new Error(`Unknown agent: ${threadId}`);

    const closeCallId = `close-${threadId}`;
    this.emit({
      type: "collab_close_begin",
      callId: closeCallId,
      childThreadId: threadId,
      nickname: entry.nickname,
    });

    if (!isFinal(entry.status)) {
      entry.abortController.abort();
    }

    const finalStatus = await entry.promise;
    entry.status = { kind: "shutdown" };

    this.emit({
      type: "collab_close_end",
      callId: closeCallId,
      childThreadId: threadId,
      nickname: entry.nickname,
      status: toCollabStatus(finalStatus),
      message: statusMessage(finalStatus),
    });

    return finalStatus;
  }

  getStatus(threadId: string): AgentStatus {
    const entry = this.agents.get(threadId);
    if (!entry) throw new Error(`Unknown agent: ${threadId}`);
    return entry.status;
  }

  getNickname(threadId: string): string | undefined {
    return this.agents.get(threadId)?.nickname;
  }

  /**
   * Restore a previously-known agent as shutdown.
   * Used on session resume to re-populate the in-memory registry
   * so that thread IDs from a prior server lifetime remain valid.
   */
  restoreAgent(threadId: string, nickname: string): void {
    if (this.agents.has(threadId)) return; // already known
    this.agents.set(threadId, {
      threadId,
      nickname,
      agentType: "unknown",
      description: "",
      sessionManager: null as unknown as import("../session/manager").SessionManager,
      promise: Promise.resolve({ kind: "shutdown" as const }),
      status: { kind: "shutdown" },
      abortController: new AbortController(),
      createdAt: 0,
    });
  }

  /** Abort all agents and wait for them all to settle. */
  async shutdownAll(): Promise<void> {
    const entries = [...this.agents.values()];
    for (const entry of entries) {
      if (!isFinal(entry.status)) {
        entry.abortController.abort();
      }
    }
    await Promise.allSettled(entries.map((e) => e.promise));
    this.agents.clear();
  }
}
