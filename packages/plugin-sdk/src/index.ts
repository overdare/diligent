// @summary Exports the public plugin-facing SDK types for external tool packages.
import type { ApprovalRequest, ApprovalResponse, UserInputRequest, UserInputResponse } from "@diligent/protocol";
import type { z } from "zod";

export type { ApprovalRequest, ApprovalResponse, UserInputRequest, UserInputResponse };

export interface ToolRenderPayload {
  version: 2;
  inputSummary?: string;
  outputSummary?: string;
  blocks: Array<Record<string, unknown>>;
}

export interface ToolContext {
  toolCallId: string;
  signal: AbortSignal;
  abort: () => void;
  approve: (request: ApprovalRequest) => Promise<ApprovalResponse>;
  ask: (request: UserInputRequest) => Promise<UserInputResponse | null>;
  onUpdate?: (partialResult: string) => void;
}

export interface ToolResult {
  output: string;
  render?: ToolRenderPayload;
  metadata?: Record<string, unknown>;
}

// biome-ignore lint/suspicious/noExplicitAny: generic default requires any for unparameterized Tool references
export interface Tool<TParams extends z.ZodType = any> {
  name: string;
  description: string;
  parameters: TParams;
  execute: (args: z.infer<TParams>, ctx: ToolContext) => Promise<ToolResult>;
  supportParallel?: boolean;
}
