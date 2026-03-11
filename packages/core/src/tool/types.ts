import type { ToolRenderPayload } from "@diligent/protocol";
import type { z } from "zod";

// D013: Tool definition
// biome-ignore lint/suspicious/noExplicitAny: generic default requires any for unparameterized Tool references
export interface Tool<TParams extends z.ZodType = any> {
  name: string;
  description: string;
  parameters: TParams;
  execute: (args: z.infer<TParams>, ctx: ToolContext) => Promise<ToolResult>;
  supportParallel?: boolean; // D015: When true, tool can run concurrently with other parallel tools
}

// D086: Approval response — "once" (proceed once), "always" (remember), "reject" (deny)
export type ApprovalResponse = "once" | "always" | "reject";

// D088: User input request/response for request_user_input tool
export interface UserInputOption {
  label: string;
  description: string;
}

export interface UserInputQuestion {
  id: string;
  header: string;
  question: string;
  options: UserInputOption[];
  allow_multiple?: boolean;
  is_other?: boolean;
  is_secret?: boolean;
}

export interface UserInputSource {
  threadId: string;
  nickname: string;
}

export interface UserInputRequest {
  questions: UserInputQuestion[];
  /** Present when the request originates from a sub-agent rather than the main agent. */
  source?: UserInputSource;
}

export interface UserInputResponse {
  answers: Record<string, string | string[]>;
}

// D016: Tool context — D086: approve returns ApprovalResponse, D088: ask for user input
export interface ToolContext {
  toolCallId: string;
  signal: AbortSignal;
  approve: (request: ApprovalRequest) => Promise<ApprovalResponse>;
  ask?: (request: UserInputRequest) => Promise<UserInputResponse>;
  onUpdate?: (partialResult: string) => void;
}

// D086: Expanded approval request with toolName + details for pattern matching
export interface ApprovalRequest {
  permission: "read" | "write" | "execute";
  toolName: string;
  description: string;
  details?: Record<string, unknown>;
}

// D020: Tool result
export interface ToolResult {
  output: string;
  render?: ToolRenderPayload;
  metadata?: Record<string, unknown>;
  truncateDirection?: "head" | "tail" | "head_tail"; // D025: hint for auto-truncation. Default: "tail"
  /** When true, the tool result is persisted to the session but NOT sent to the LLM.
   *  The agent loop aborts immediately after this tool completes. */
  abortRequested?: boolean;
}

// D014: Registry type
export type ToolRegistry = Map<string, Tool>;
