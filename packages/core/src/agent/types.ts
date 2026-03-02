import type { PermissionEngine } from "../approval/types";
import type { Model, StreamFunction } from "../provider/types";
import type { ApprovalRequest, ApprovalResponse, Tool, UserInputRequest, UserInputResponse } from "../tool/types";
import type { AssistantMessage, Message, ToolResultMessage, Usage } from "../types";

// D087: Collaboration modes
export type ModeKind = "default" | "plan" | "execute";

/**
 * Tools available in plan mode (read-only exploration only).
 * Bash, write, edit, add_knowledge are excluded.
 * D088: request_user_input is allowed in all modes.
 */
export const PLAN_MODE_ALLOWED_TOOLS = new Set(["read_file", "glob", "grep", "ls", "request_user_input"]);

/**
 * System prompt prefixes injected per mode.
 * Empty string for "default" — no prefix added, current behavior preserved.
 */
export const MODE_SYSTEM_PROMPT_PREFIXES: Record<ModeKind, string> = {
  default: "",
  plan: `You are operating in PLAN MODE. You work in 3 phases, chatting your way to a great plan before finalizing it. A great plan is very detailed—intent- and implementation-wise—so that it can be handed to another engineer or agent to be implemented right away. It must be decision complete, where the implementer does not need to make any decisions.

## Execution vs. mutation in Plan Mode

You may explore and execute non-mutating actions that improve the plan. You must NOT perform mutating actions (editing/writing files, running formatters, applying patches, etc.). When in doubt: if the action would be "doing the work" rather than "planning the work," do not do it.

## PHASE 1 — Ground in the environment (explore first, ask second)

Begin by grounding yourself in the actual environment. Eliminate unknowns by discovering facts, not by asking the user. Resolve all questions that can be answered through exploration or inspection. Before asking the user any question, perform at least one targeted non-mutating exploration pass. Exception: you may ask clarifying questions about the user's prompt before exploring ONLY if there are obvious ambiguities or contradictions in the prompt itself.

## PHASE 2 — Intent chat (what they actually want)

Keep asking until you can clearly state: goal + success criteria, audience, in/out of scope, constraints, current state, and key preferences/tradeoffs. Bias toward questions over guessing: if any high-impact ambiguity remains, do NOT plan yet—ask.

## PHASE 3 — Implementation chat (what/how we'll build)

Once intent is stable, keep asking until the spec is decision complete: approach, interfaces, data flow, edge cases/failure modes, testing + acceptance criteria.

## Asking questions

Critical rules:

* Strongly prefer using the \`request_user_input\` tool to ask any questions.
* Offer only meaningful multiple-choice options; don't include filler choices that are obviously wrong or irrelevant.
* In rare cases where an unavoidable, important question can't be expressed with reasonable multiple-choice options (due to extreme ambiguity), you may ask it directly without the tool.

You SHOULD ask many questions, but each question must:

* materially change the spec/plan, OR
* confirm/lock an assumption, OR
* choose between meaningful tradeoffs.
* not be answerable by non-mutating commands.

## Two kinds of unknowns (treat differently)

1. **Discoverable facts** (repo/system truth): explore first. Ask only if multiple plausible candidates exist, nothing found but you need a missing identifier, or ambiguity is actually product intent.

2. **Preferences/tradeoffs** (not discoverable): ask early. Provide 2–3 mutually exclusive options + a recommended default.

## Finalization

Only output the final plan when it is decision complete. Wrap it in a \`<proposed_plan>\` block:

1. The opening tag must be on its own line.
2. Start plan content on the next line.
3. The closing tag must be on its own line.
4. Use Markdown inside the block.

Do not ask "should I proceed?" in the final output. Only produce at most one \`<proposed_plan>\` block per turn, and only when presenting a complete spec.

`,
  execute: [
    "You are operating in EXECUTE MODE.",
    "Work autonomously toward the goal. Make reasonable assumptions for minor decisions.",
    "Only use request_user_input for critical ambiguity where a wrong assumption would cause irreversible damage or wasted effort.",
    "Report significant progress milestones as you work.",
    "Complete the full task before stopping.",
    "",
  ].join("\n"),
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
  | { type: "turn_start"; turnId: string }
  | { type: "turn_end"; turnId: string; message: AssistantMessage; toolResults: ToolResultMessage[] }
  // Message streaming (3) — D086: itemId groups related events
  | { type: "message_start"; itemId: string; message: AssistantMessage }
  | { type: "message_delta"; itemId: string; message: AssistantMessage; delta: MessageDelta }
  | { type: "message_end"; itemId: string; message: AssistantMessage }
  // Tool execution (3) — D086: itemId groups related events
  | { type: "tool_start"; itemId: string; toolCallId: string; toolName: string; input: unknown }
  | { type: "tool_update"; itemId: string; toolCallId: string; toolName: string; partialResult: string }
  | { type: "tool_end"; itemId: string; toolCallId: string; toolName: string; output: string; isError: boolean }
  // Status (1)
  | { type: "status_change"; status: "idle" | "busy" | "retry"; retry?: { attempt: number; delayMs: number } }
  // Usage (1)
  | { type: "usage"; usage: Usage; cost: number }
  // Error (1) — D086: SerializableError instead of Error
  | { type: "error"; error: SerializableError; fatal: boolean }
  // Compaction (2) — Phase 3b
  | { type: "compaction_start"; estimatedTokens: number }
  | { type: "compaction_end"; tokensBefore: number; tokensAfter: number; summary: string }
  // Knowledge (1) — Phase 3b
  | { type: "knowledge_saved"; knowledgeId: string; content: string }
  // Loop detection (1) — P0
  | { type: "loop_detected"; patternLength: number; toolName: string }
  // Steering (1) — P1
  | { type: "steering_injected"; messageCount: number };

// D008: Config for a single agent invocation
export interface AgentLoopConfig {
  model: Model;
  systemPrompt: string;
  tools: Tool[];
  streamFunction: StreamFunction;
  signal?: AbortSignal;
  maxTurns?: number;
  maxRetries?: number; // D010: default 5
  retryBaseDelayMs?: number; // default: 1000
  retryMaxDelayMs?: number; // default: 30_000
  mode?: ModeKind; // D087: defaults to "default"
  getSteeringMessages?: () => Message[];
  /** D028: Called for each ctx.approve() — rule engine + optional UI callback */
  approve?: (request: ApprovalRequest) => Promise<ApprovalResponse>;
  /** D088: Called for each request_user_input tool execution */
  ask?: (request: UserInputRequest) => Promise<UserInputResponse>;
  /** D070: Engine used to filter denied tools before LLM call (config rules only) */
  permissionEngine?: PermissionEngine;
}
