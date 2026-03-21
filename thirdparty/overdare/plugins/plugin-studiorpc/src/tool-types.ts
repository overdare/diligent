import type { z } from "zod";

export type ToolRenderPayload = {
  version: 2;
  inputSummary?: string;
  outputSummary?: string;
  blocks: Array<Record<string, unknown>>;
};

export interface ApprovalRequest {
  permission: "read" | "write" | "execute";
  toolName: string;
  description: string;
  details?: Record<string, unknown>;
}

export type ApprovalResponse = "once" | "always" | "reject";

export interface ToolContext {
  toolCallId: string;
  signal: AbortSignal;
  approve: (request: ApprovalRequest) => Promise<ApprovalResponse>;
  onUpdate?: (partialResult: string) => void;
}

export interface ToolResult {
  output: string;
  render?: ToolRenderPayload;
  metadata?: Record<string, unknown>;
}

export interface Tool {
  name: string;
  description: string;
  parameters: z.ZodType;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
  supportParallel?: boolean;
}

export interface MethodModule {
  method: string;
  description: string;
  params: z.ZodType;
  resolveMethod?: (args: Record<string, unknown>) => string;
  normalizeArgs?: (args: Record<string, unknown>) => Record<string, unknown>;
}

export type RenderBuilderContext = {
  normalizedArgs: Record<string, unknown>;
  output: string;
  result: unknown;
};

export type RenderBuilder = (ctx: RenderBuilderContext) => ToolRenderPayload | undefined;
