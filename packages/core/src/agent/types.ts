import type { PermissionEngine } from "../approval/types";
import type { Model, StreamFunction, SystemSection } from "../provider/types";
import type { ApprovalRequest, ApprovalResponse, Tool, UserInputRequest, UserInputResponse } from "../tool/types";
import type { AssistantMessage, Message, ToolResultMessage, Usage } from "../types";
import executePrompt from "./templates/execute.md" with { type: "text" };
import planPrompt from "./templates/plan.md" with { type: "text" };

// D087: Collaboration modes
export type ModeKind = "default" | "plan" | "execute";

/**
 * Tools available in plan mode (read-only exploration only).
 * Bash, write, apply_patch, add_knowledge are excluded.
 * D088: request_user_input is allowed in all modes.
 */
export const PLAN_MODE_ALLOWED_TOOLS = new Set(["read_file", "glob", "grep", "ls", "request_user_input"]);

/**
 * System prompt suffixes injected per mode.
 * Empty string for "default" — no suffix added, current behavior preserved.
 */
export const MODE_SYSTEM_PROMPT_SUFFIXES: Record<ModeKind, string> = {
  default: "",
  plan: planPrompt,
  execute: executePrompt,
};

export type MessageDelta = { type: "text_delta"; delta: string } | { type: "thinking_delta"; delta: string };

// D086: Serializable error representation for events crossing core↔consumer boundary
export interface SerializableError {
  message: string;
  name: string;
  stack?: string;
}

// D004: 15 AgentEvent types — D086: itemId on grouped subtypes, SerializableError
export type AgentEvent =
  // Lifecycle (2)
  | { type: "agent_start" }
  | { type: "agent_end"; messages: Message[] }
  // Turn (2)
  | { type: "turn_start"; turnId: string; childThreadId?: string; nickname?: string; turnNumber?: number }
  | { type: "turn_end"; turnId: string; message: AssistantMessage; toolResults: ToolResultMessage[] }
  // Message streaming (3) — D086: itemId groups related events
  | { type: "message_start"; itemId: string; message: AssistantMessage }
  | { type: "message_delta"; itemId: string; message: AssistantMessage; delta: MessageDelta }
  | { type: "message_end"; itemId: string; message: AssistantMessage }
  // Tool execution (3) — D086: itemId groups related events
  | {
      type: "tool_start";
      itemId: string;
      toolCallId: string;
      toolName: string;
      input: unknown;
      childThreadId?: string;
      nickname?: string;
    }
  | {
      type: "tool_update";
      itemId: string;
      toolCallId: string;
      toolName: string;
      partialResult: string;
      childThreadId?: string;
      nickname?: string;
    }
  | {
      type: "tool_end";
      itemId: string;
      toolCallId: string;
      toolName: string;
      output: string;
      isError: boolean;
      render?: import("@diligent/protocol").ToolRenderPayload;
      childThreadId?: string;
      nickname?: string;
    }
  // Status (1)
  | { type: "status_change"; status: "idle" | "busy" | "retry"; retry?: { attempt: number; delayMs: number } }
  // Usage (1)
  | { type: "usage"; usage: Usage; cost: number }
  // Error (1) — D086: SerializableError instead of Error
  | { type: "error"; error: SerializableError; fatal: boolean }
  // Compaction (2) — Phase 3b
  | { type: "compaction_start"; estimatedTokens: number }
  | {
      type: "compaction_end";
      tokensBefore: number;
      tokensAfter: number;
      summary: string;
      tailMessages?: Array<{ role: string; preview: string }>;
    }
  // Knowledge (1) — Phase 3b
  | { type: "knowledge_saved"; knowledgeId: string; content: string }
  // Loop detection (1) — P0
  | { type: "loop_detected"; patternLength: number; toolName: string }
  // Steering (1) — P1
  | { type: "steering_injected"; messageCount: number; messages: Message[] }
  // Collab — sub-agent orchestration boundary events (3 begin/end pairs)
  | { type: "collab_spawn_begin"; callId: string; prompt: string }
  | {
      type: "collab_spawn_end";
      callId: string;
      childThreadId: string;
      nickname?: string;
      description?: string;
      prompt: string;
      status: "pending" | "running" | "completed" | "errored" | "shutdown";
      message?: string;
    }
  | {
      type: "collab_wait_begin";
      callId: string;
      agents: Array<{ threadId: string; nickname?: string; description?: string }>;
    }
  | {
      type: "collab_wait_end";
      callId: string;
      agentStatuses: Array<{
        threadId: string;
        nickname?: string;
        status: "pending" | "running" | "completed" | "errored" | "shutdown";
        message?: string;
      }>;
      timedOut: boolean;
    }
  | { type: "collab_close_begin"; callId: string; childThreadId: string; nickname?: string }
  | {
      type: "collab_close_end";
      callId: string;
      childThreadId: string;
      nickname?: string;
      status: "pending" | "running" | "completed" | "errored" | "shutdown";
      message?: string;
    }
  // Collab — interaction events (send_input)
  | {
      type: "collab_interaction_begin";
      callId: string;
      receiverThreadId: string;
      receiverNickname?: string;
      prompt: string;
    }
  | {
      type: "collab_interaction_end";
      callId: string;
      receiverThreadId: string;
      receiverNickname?: string;
      prompt: string;
      status: "pending" | "running" | "completed" | "errored" | "shutdown";
    };

// D008: Config for a single agent invocation
export interface AgentLoopConfig {
  model: Model;
  systemPrompt: SystemSection[];
  tools: Tool[];
  streamFunction: StreamFunction;
  signal?: AbortSignal;
  reservePercent?: number;
  /** Optional debug identifiers for correlating AgentLoop logs with outer thread/turn logs. */
  debugThreadId?: string;
  debugTurnId?: string;
  maxTurns?: number;
  maxRetries?: number; // D010: default 5
  retryBaseDelayMs?: number; // default: 1000
  retryMaxDelayMs?: number; // default: 30_000
  mode?: ModeKind; // D087: defaults to "default"
  effort?: "low" | "medium" | "high" | "max"; // thinking effort; defaults to "medium"
  getSteeringMessages?: () => Message[];
  hasPendingMessages?: () => boolean;
  /** D028: Called for each ctx.approve() — rule engine + optional UI callback */
  approve?: (request: ApprovalRequest) => Promise<ApprovalResponse>;
  /** D088: Called for each request_user_input tool execution */
  ask?: (request: UserInputRequest) => Promise<UserInputResponse>;
  /** D070: Engine used to filter denied tools before LLM call (config rules only) */
  permissionEngine?: PermissionEngine;
}
