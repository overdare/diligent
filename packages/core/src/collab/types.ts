// @summary AgentStatus, AgentEntry, CollabToolDeps, and CollabEvent types for non-blocking multi-agent collab
import type { AgentEvent } from "../agent/types";
import type { DiligentPaths } from "../infrastructure";
import type { Model, StreamFunction, SystemSection, ThinkingEffort } from "../provider/types";
import type { SessionManager } from "../session/manager";
import type { Tool, UserInputRequest, UserInputResponse } from "../tool/types";

export type AgentStatus =
  | { kind: "pending" }
  | { kind: "running" }
  | { kind: "completed"; output: string | null }
  | { kind: "errored"; error: string }
  | { kind: "shutdown" };

export function isFinal(s: AgentStatus): boolean {
  return s.kind !== "pending" && s.kind !== "running";
}

export interface AgentEntry {
  threadId: string;
  nickname: string;
  agentType: string;
  description: string;
  sessionManager: SessionManager;
  promise: Promise<AgentStatus>; // always resolves, never rejects
  status: AgentStatus;
  abortController: AbortController;
  createdAt: number;
}

/** Events emitted by the collab layer — collab boundary events + child tool/turn events with childThreadId. */
export type CollabAgentEvent =
  | Extract<AgentEvent, { type: `collab_${string}` }>
  | (Extract<AgentEvent, { type: "turn_start" }> & { childThreadId: string })
  | (Extract<AgentEvent, { type: "tool_start" }> & { childThreadId: string })
  | (Extract<AgentEvent, { type: "tool_update" }> & { childThreadId: string })
  | (Extract<AgentEvent, { type: "tool_end" }> & { childThreadId: string });

export interface CollabToolDeps {
  cwd: string;
  paths: DiligentPaths;
  model: Model;
  effort: ThinkingEffort;
  systemPrompt: SystemSection[];
  streamFunction: StreamFunction;
  parentTools: Tool[];
  maxAgents?: number; // default 8
  getParentSessionId?: () => string | undefined;
  sessionManagerFactory?: (config: import("../session/manager").SessionManagerConfig) => SessionManager;
  /** Called when collab boundary events fire (spawn/wait/close begin+end). */
  onCollabEvent?: (event: CollabAgentEvent) => void;
  /** Routes sub-agent user input requests up to the parent session's ask handler. */
  ask?: (request: UserInputRequest) => Promise<UserInputResponse>;
}
