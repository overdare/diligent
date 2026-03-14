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

export interface ToolContext {
  toolCallId: string;
  signal: AbortSignal;
  abort: () => void;
  onUpdate?: (partialResult: string) => void;
}

// D020: Tool result
export interface ToolResult {
  output: string;
  abortRequested?: boolean; // When true, tool signals the agent loop to stop after this result
  metadata?: Record<string, unknown>;
  truncateDirection?: "head" | "tail" | "head_tail"; // D025: hint for auto-truncation. Default: "tail"
}

// D014: Registry type
export type ToolRegistry = Map<string, Tool>;
