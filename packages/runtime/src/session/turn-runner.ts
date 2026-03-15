// @summary Executes a single session turn by wiring agent events into staged and committed session entries

import type { CoreAgentEvent, SerializableError } from "@diligent/core/agent";
import { type Agent, toSerializableError } from "@diligent/core/agent";
import type { Message } from "@diligent/core/types";
import { buildSessionContext } from "./context-builder";
import type { SessionStateStore } from "./state-store";
import { TurnStager } from "./turn-stager";
import type { SessionEntry } from "./types";

export interface SessionTurnRunnerConfig {
  state: SessionStateStore;
  resolveAgent: () => Agent | Promise<Agent>;
  sessionId: string;
  compaction?: {
    enabled: boolean;
    reservePercent: number;
    keepRecentTokens: number;
  };
  drainPendingMessages: () => Message[];
  getInitializedAgent: () => Agent | null;
  setInitializedAgent: (agent: Agent | null) => void;
  setActiveAgent: (agent: Agent) => void;
  emitEvent: (event: CoreAgentEvent) => void;
  handleUsage: (usage: { cacheReadTokens: number }) => void;
  commitEntries: (entries: SessionEntry[]) => void;
  onFatalError: (error: SerializableError, options?: { fatal?: boolean; turnId?: string }) => void;
  summarizeLastPersistedMessage: () => string;
}

export class SessionTurnRunner {
  constructor(private readonly config: SessionTurnRunnerConfig) {}

  async run(userMessage: Message, opts?: { signal?: AbortSignal }): Promise<void> {
    const context = buildSessionContext(
      this.config.state.getCommittedEntries(),
      this.config.state.getCommittedLeafId(),
      {},
    );
    const turnStager = new TurnStager(this.config.state.getCommittedLeafId(), context.messages, userMessage);
    let snapshot = turnStager.getSnapshot();
    this.config.state.setPending(snapshot.entries, snapshot.leafId);

    const agentResult = this.config.resolveAgent();
    const agent = agentResult instanceof Promise ? await agentResult : agentResult;
    this.config.setActiveAgent(agent);

    agent.setSessionId(this.config.sessionId);

    for (const msg of this.config.drainPendingMessages()) {
      agent.steer(msg);
    }

    const compactionConfig = this.config.compaction;
    if (compactionConfig?.enabled) {
      agent.setCompactionConfig({
        reservePercent: compactionConfig.reservePercent,
        keepRecentTokens: compactionConfig.keepRecentTokens,
      });
    }

    if (agent !== this.config.getInitializedAgent()) {
      agent.restore(context.messages);
      this.config.setInitializedAgent(agent);
    }

    let currentTurnId: string | undefined;
    const unsub = agent.subscribe((event: CoreAgentEvent) => {
      if (event.type === "turn_start") currentTurnId = event.turnId;
      if (event.type === "usage") {
        this.config.handleUsage(event.usage);
      }
      const keepRecentTokens = compactionConfig?.keepRecentTokens ?? 20_000;
      turnStager.handleEvent(event, keepRecentTokens);
      this.config.emitEvent(event);
      snapshot = turnStager.getSnapshot();
      this.config.state.setPending(snapshot.entries, snapshot.leafId);
    });

    try {
      await agent.prompt(userMessage, opts?.signal);
      this.config.commitEntries(turnStager.getSnapshot().entries);
    } catch (err) {
      const serializable = toSerializableError(err);
      console.error(
        "[SessionManager] Run error session=%s name=%s message=%s lastPersisted=%s",
        this.config.sessionId,
        serializable.name,
        serializable.message,
        this.config.summarizeLastPersistedMessage(),
      );
      this.config.onFatalError(serializable, { fatal: true, turnId: currentTurnId });
    } finally {
      this.config.state.clearPending();
      unsub();
    }

    if (opts?.signal?.aborted) {
      throw new Error("Aborted");
    }
  }
}
