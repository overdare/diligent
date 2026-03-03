// @summary AgentStatus, AgentEntry, and CollabToolDeps types for non-blocking multi-agent collab
import type { DiligentPaths } from "../infrastructure/diligent-dir";
import type { Model, StreamFunction, SystemSection } from "../provider/types";
import type { SessionManager } from "../session/manager";
import type { Tool } from "../tool/types";

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
  id: string;
  nickname: string;
  agentType: string;
  description: string;
  sessionManager: SessionManager;
  promise: Promise<AgentStatus>; // always resolves, never rejects
  status: AgentStatus;
  abortController: AbortController;
  createdAt: number;
}

export interface CollabToolDeps {
  cwd: string;
  paths: DiligentPaths;
  model: Model;
  systemPrompt: SystemSection[];
  streamFunction: StreamFunction;
  parentTools: Tool[];
  maxAgents?: number; // default 8
  getParentSessionId?: () => string | undefined;
  sessionManagerFactory?: (config: import("../session/manager").SessionManagerConfig) => SessionManager;
}
