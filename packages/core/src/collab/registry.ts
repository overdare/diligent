// @summary AgentRegistry — spawn/wait/send_input/close lifecycle for non-blocking multi-agent collab
import { BUILTIN_AGENT_TYPES } from "../agent/agent-types";
import { PLAN_MODE_ALLOWED_TOOLS } from "../agent/types";
import { SessionManager } from "../session/manager";
import type { TextBlock } from "../types";
import { NicknamePool } from "./nicknames";
import type { AgentEntry, AgentStatus, CollabToolDeps } from "./types";
import { isFinal } from "./types";

/** Tool names that belong to the collab layer — excluded from child agents. */
export const COLLAB_TOOL_NAMES = new Set(["spawn_agent", "wait", "send_input", "close_agent"]);

let _nextId = 1;
function nextId(): string {
  return `agent-${(_nextId++).toString().padStart(4, "0")}`;
}

export class AgentRegistry {
  private agents = new Map<string, AgentEntry>();
  private pool = new NicknamePool();
  private maxAgents: number;

  constructor(private deps: CollabToolDeps) {
    this.maxAgents = deps.maxAgents ?? 8;
  }

  /**
   * Spawn a new sub-agent in the background.
   * Synchronous — returns immediately with {agentId, nickname}.
   */
  spawn(params: { prompt: string; description: string; agentType: string; resumeId?: string }): {
    agentId: string;
    nickname: string;
  } {
    if (this.agents.size >= this.maxAgents) {
      throw new Error(`Max agents reached (${this.maxAgents}). Close some agents first.`);
    }

    const agentType = BUILTIN_AGENT_TYPES[params.agentType] ?? BUILTIN_AGENT_TYPES.general;
    const agentId = nextId();
    const nickname = this.pool.reserve();
    const abortController = new AbortController();

    // Build child tool list
    let childTools = this.deps.parentTools;
    if (agentType.toolFilter === "readonly") {
      childTools = this.deps.parentTools.filter((t) => PLAN_MODE_ALLOWED_TOOLS.has(t.name));
    } else {
      // general: exclude collab tools (prevent nesting) + task tool (deprecated, also nested)
      childTools = this.deps.parentTools.filter((t) => !COLLAB_TOOL_NAMES.has(t.name) && t.name !== "task");
    }

    const childSystemPrompt = agentType.systemPromptPrefix
      ? [{ label: "agent_role", content: agentType.systemPromptPrefix }, ...this.deps.systemPrompt]
      : [...this.deps.systemPrompt];

    const factory = this.deps.sessionManagerFactory ?? ((cfg) => new SessionManager(cfg));
    const childManager = factory({
      cwd: this.deps.cwd,
      paths: this.deps.paths,
      agentConfig: {
        model: this.deps.model,
        systemPrompt: childSystemPrompt,
        tools: childTools,
        streamFunction: this.deps.streamFunction,
        maxTurns: agentType.maxTurns,
        signal: abortController.signal,
      },
      compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
      parentSession: this.deps.getParentSessionId?.(),
    });

    const entry: AgentEntry = {
      id: agentId,
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

      for await (const event of stream) {
        if (event.type === "message_end") {
          const textBlocks = event.message.content.filter((b): b is TextBlock => b.type === "text");
          output = textBlocks.map((b) => b.text).join("\n") || null;
        } else if (event.type === "error" && event.fatal) {
          await childManager.waitForWrites();
          const status: AgentStatus = { kind: "errored", error: event.error.message };
          entry.status = status;
          return status;
        }
      }

      await childManager.waitForWrites();
      const status: AgentStatus = { kind: "completed", output };
      entry.status = status;
      return status;
    })().catch((err: unknown): AgentStatus => {
      const status: AgentStatus = { kind: "errored", error: String(err) };
      entry.status = status;
      return status;
    });

    entry.promise = promise;
    this.agents.set(agentId, entry);
    return { agentId, nickname };
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
    const validIds = ids.filter((id) => this.agents.has(id));
    const unknownIds = ids.filter((id) => !this.agents.has(id));

    if (unknownIds.length > 0) {
      throw new Error(`Unknown agent IDs: ${unknownIds.join(", ")}`);
    }

    // Collect already-final entries
    const result: Record<string, AgentStatus> = {};
    const pending: AgentEntry[] = [];

    for (const id of validIds) {
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
      const parts = validIds.map((id) => {
        const e = this.agents.get(id)!;
        const s = e.status.kind;
        const done = isFinal(e.status);
        return `${e.nickname} ${done ? "✓" : s}`;
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
        result[entry.id] = status;
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

    // Collect final statuses for all known agents and auto-cleanup completed ones
    for (const id of validIds) {
      if (!(id in result)) {
        const entry = this.agents.get(id)!;
        result[id] = entry.status;
      }
      if (isFinal(result[id])) {
        this.agents.delete(id);
      }
    }

    return { status: result, timedOut };
  }

  /** Send a steering message to a running agent. */
  async sendInput(agentId: string, message: string): Promise<void> {
    const entry = this.agents.get(agentId);
    if (!entry) throw new Error(`Unknown agent: ${agentId}`);
    if (isFinal(entry.status)) throw new Error(`Agent ${entry.nickname} is not running (${entry.status.kind})`);
    entry.sessionManager.steer(message);
  }

  /** Abort an agent and wait for it to settle. Returns final status. */
  async close(agentId: string): Promise<AgentStatus> {
    const entry = this.agents.get(agentId);
    if (!entry) throw new Error(`Unknown agent: ${agentId}`);

    if (!isFinal(entry.status)) {
      entry.abortController.abort();
    }

    const finalStatus = await entry.promise;
    const shutdownStatus: AgentStatus = { kind: "shutdown" };
    entry.status = shutdownStatus;
    this.agents.delete(agentId);
    return finalStatus;
  }

  getStatus(agentId: string): AgentStatus {
    const entry = this.agents.get(agentId);
    if (!entry) throw new Error(`Unknown agent: ${agentId}`);
    return entry.status;
  }

  getNickname(agentId: string): string | undefined {
    return this.agents.get(agentId)?.nickname;
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
