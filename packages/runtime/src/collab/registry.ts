// @summary AgentRegistry — spawn/wait/send_input/close lifecycle for non-blocking multi-agent collab

import type { ModelClass } from "@diligent/core/llm/models";
import { agentTypeToModelClass, resolveModel, resolveModelForClass } from "@diligent/core/llm/models";
import type { TextBlock } from "@diligent/core/types";
import { PLAN_MODE_ALLOWED_TOOLS } from "../agent/mode";
import { resolveAgentDefinition } from "../agent/resolved-agent";
import { RuntimeAgent } from "../agent/runtime-agent";
import { SessionManager } from "../session/manager";
import { buildDefaultTools } from "../tools/defaults";
import { COLLAB_TOOL_NAMES } from "../tools/tool-metadata";
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
export { COLLAB_TOOL_NAMES };

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
      modelId: next.modelId,
      systemPrompt: next.systemPrompt,
      getParentSessionId: next.getParentSessionId,
      approve: next.approve,
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
    allowedTools?: string[];
  }): {
    threadId: string;
    nickname: string;
  } {
    const activeCount = [...this.agents.values()].filter((e) => !isFinal(e.status)).length;
    if (activeCount >= this.maxAgents) {
      throw new Error(`Max active agents reached (${this.maxAgents}). Close some agents first.`);
    }

    const agentDefinition =
      resolveAgentDefinition(this.deps.agentDefinitions, params.agentType) ??
      resolveAgentDefinition(this.deps.agentDefinitions, "general");
    if (!agentDefinition) {
      throw new Error("Missing built-in general agent definition");
    }
    const nickname = this.pool.reserve();
    const abortController = new AbortController();

    // Build child tool list
    let childTools = this.deps.parentTools.filter((tool) => !COLLAB_TOOL_NAMES.has(tool.name));
    if (agentDefinition.readonly) {
      childTools = childTools.filter((tool) => PLAN_MODE_ALLOWED_TOOLS.has(tool.name));
    }
    if (agentDefinition.allowedTools) {
      const allowedSet = new Set(agentDefinition.allowedTools);
      childTools = childTools.filter((tool) => allowedSet.has(tool.name));
    }
    if (params.allowedTools) {
      const allowedSet = new Set(params.allowedTools);
      childTools = childTools.filter((tool) => allowedSet.has(tool.name));
    }

    if (childTools.length === 0) {
      const parentToolNames = this.deps.parentTools.map((t) => t.name).join(", ");
      const requestedNames = [...(agentDefinition.allowedTools ?? []), ...(params.allowedTools ?? [])];
      const requested = requestedNames.length > 0 ? requestedNames.join(", ") : "(inherit all)";
      console.warn(
        `[collab] Spawning agent '${params.agentType}' with zero tools after filtering. ` +
          `Parent tools: [${parentToolNames}]. Requested: [${requested}].`,
      );
    }

    const childSystemPrompt = agentDefinition.systemPromptPrefix
      ? [{ label: "agent_role", content: agentDefinition.systemPromptPrefix }, ...this.deps.systemPrompt]
      : [...this.deps.systemPrompt];

    // Resolve model class: explicit override > agent_type-based default
    const parentModel = resolveModel(this.deps.modelId);
    const targetClass: ModelClass =
      params.modelClass ?? agentDefinition.defaultModelClass ?? agentTypeToModelClass(params.agentType, parentModel);
    const childModel = resolveModelForClass(parentModel, targetClass);

    const factory = this.deps.sessionManagerFactory ?? ((cfg) => new SessionManager(cfg));
    const childManager = factory({
      cwd: this.deps.cwd,
      paths: this.deps.paths,
      agent: async (): Promise<RuntimeAgent> => {
        const childAsk = this.deps.ask
          ? (request: import("../tools/user-input-types").UserInputRequest) =>
              this.deps.ask!({
                ...request,
                source: { threadId: childManager.sessionId, nickname },
              })
          : undefined;

        const childDeps = { ...this.deps, parentTools: childTools, ask: childAsk };
        const result = await buildDefaultTools(
          this.deps.cwd,
          this.deps.paths,
          childDeps,
          undefined,
          [],
          childTools,
          undefined,
          {
            approve: this.deps.approve,
            ask: childAsk,
          },
        );

        return new RuntimeAgent(
          childModel.id,
          childSystemPrompt,
          result.tools,
          { effort: this.deps.effort, llmMsgStreamFn: this.deps.streamFn },
          result.registry,
        );
      },
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
      agentType: params.agentType,
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
        agentType: params.agentType,
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

      let output: string | null = null;
      let turnNumber = 0;
      let fatalError: string | null = null;

      const unsub = childManager.subscribe((event) => {
        if (event.type === "turn_start") {
          turnNumber++;
          this.emit({
            type: "turn_start",
            turnId: event.turnId,
            childThreadId: threadId,
            nickname,
            turnNumber,
          });
        } else if (event.type === "message_start") {
          this.emit({ ...event, childThreadId: threadId, nickname });
        } else if (event.type === "message_delta") {
          this.emit({ ...event, childThreadId: threadId, nickname });
        } else if (event.type === "tool_start") {
          this.emit({ ...event, childThreadId: threadId, nickname });
        } else if (event.type === "tool_update") {
          this.emit({ ...event, childThreadId: threadId, nickname });
        } else if (event.type === "tool_end") {
          this.emit({ ...event, childThreadId: threadId, nickname });
        } else if (event.type === "message_end") {
          this.emit({ ...event, childThreadId: threadId, nickname });
          const textBlocks = event.message.content.filter((b): b is TextBlock => b.type === "text");
          output = textBlocks.map((b) => b.text).join("\n") || null;
        } else if (event.type === "error" && event.fatal) {
          fatalError = event.error.message;
        }
      });

      try {
        await childManager.run(userMessage, { signal: abortController.signal });
      } catch {
        // Abort or run error — handled below via fatalError or entry.status
      } finally {
        unsub();
      }

      if (fatalError !== null) {
        await childManager.waitForWrites();
        const status: AgentStatus = { kind: "errored", error: fatalError };
        entry.status = status;
        emitErroredSpawnEnd(fatalError);
        return status;
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
      agentType: params.agentType,
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
