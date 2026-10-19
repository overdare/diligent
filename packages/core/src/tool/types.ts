import type { z } from "zod";
import type { ProviderBuiltinToolDefinition } from "../llm/types";
import type { ImageBlock, ToolRenderPayloadLike } from "../types";

// D013: Tool definition
// biome-ignore lint/suspicious/noExplicitAny: generic default requires any for unparameterized Tool references
export interface Tool<TParams extends z.ZodType = any> {
  name: string;
  description: string;
  parameters: TParams;
  /**
   * When set, this raw JSON Schema is advertised to the LLM instead of deriving it
   * from `parameters`. Used by tools whose schema is not Zod-authored (e.g. MCP).
   */
  inputSchema?: Record<string, unknown>;
  /**
   * Overrides the default function-tool advertisement with a provider-native
   * semantic capability. The catalog name remains independent.
   */
  modelExposure?: ProviderBuiltinToolDefinition;
  execute: (args: z.infer<TParams>, ctx: ToolContext) => Promise<ToolResult>;
  supportParallel?: boolean; // D015: When true, tool can run concurrently with other parallel tools
  /** Custom arg parser. When provided, executor uses this instead of parameters.safeParse(). */
  parseArgs?: (raw: unknown) => z.infer<TParams>;
}

export interface ToolContext {
  toolCallId: string;
  /** The session executing this call, including when tools are shared with child agents. */
  sessionId?: string;
  signal: AbortSignal;
  abort: () => void;
  onUpdate?: (partialResult: string) => void;
  /**
   * Emits lifecycle events for tool calls this call executes on behalf of the model
   * (e.g. code mode `exec`). The runner tags each event with this call's id as `parentToolCallId`.
   */
  emitNestedToolEvent?: (event: NestedToolEvent) => void;
}

/** Lifecycle event of a tool call executed inside another tool call. Never persisted as a tool_result. */
export type NestedToolEvent =
  | { type: "tool_start"; itemId: string; toolCallId: string; toolName: string; input: unknown }
  | { type: "tool_update"; itemId: string; toolCallId: string; toolName: string; partialResult: string }
  | {
      type: "tool_end";
      itemId: string;
      toolCallId: string;
      toolName: string;
      output: string;
      outputImages?: ImageBlock[];
      isError: boolean;
      render?: ToolRenderPayloadLike;
      metadata?: Record<string, unknown>;
    };

// D020: Tool result
export interface ToolResult {
  output: string;
  /** Optional image content blocks returned alongside text. Provider support varies — Anthropic embeds them in tool_result content; other providers fall back to text-only. */
  outputImages?: ImageBlock[];
  render?: ToolRenderPayloadLike;
  abortRequested?: boolean; // When true, tool signals the agent loop to stop after this result
  metadata?: Record<string, unknown>;
  truncateDirection?: "head" | "tail" | "head_tail"; // D025: hint for auto-truncation. Default: "tail"
  /**
   * Per-result byte cap for the executor's auto-truncation safety net. When set, overrides the
   * default MAX_OUTPUT_BYTES for this result — letting a tool allow larger legitimate output or
   * enforce a tighter limit (e.g. MCP per-tool `maxResultSizeChars`). Default: MAX_OUTPUT_BYTES.
   */
  maxOutputBytes?: number;
}

// D014: Registry type
export type ToolRegistry = Map<string, Tool>;
