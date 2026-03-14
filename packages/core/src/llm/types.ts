import type { EventStream } from "../event-stream";
import type { AssistantMessage, Message, StopReason, Usage } from "../types";

export interface SystemSection {
  tag?: string; // XML wrapper: "knowledge", "user_instructions", "collaboration_mode"
  tagAttributes?: Record<string, string>; // e.g. { path: "/p/AGENTS.md" }
  label: string; // debug label: "base", "knowledge", "mode"
  content: string; // raw text content
  cacheControl?: "ephemeral"; // hint for Anthropic cache breakpoints
}

export type ThinkingEffort = "none" | "low" | "medium" | "high" | "max";

export type ProviderName = "anthropic" | "openai" | "chatgpt" | "gemini";

export interface ModelInfo {
  id: string;
  provider: string;
  contextWindow: number;
  maxOutputTokens: number;
  inputCostPer1M?: number;
  outputCostPer1M?: number;
  supportsThinking: boolean;
  supportedEfforts?: ThinkingEffort[];
  supportsVision?: boolean;
}

export interface Model {
  id: string;
  provider: string;
  contextWindow: number;
  maxOutputTokens: number;
  inputCostPer1M?: number; // cost per 1M input tokens in USD
  outputCostPer1M?: number; // cost per 1M output tokens in USD
  cacheReadCostPer1M?: number; // cost per 1M cache-read tokens in USD
  cacheWriteCostPer1M?: number; // cost per 1M cache-write tokens in USD
  supportsThinking: boolean;
  supportedEfforts?: ThinkingEffort[];
  supportsVision?: boolean;
  defaultBudgetTokens?: number; // fallback when thinkingBudgets absent
  supportsAdaptiveThinking?: boolean; // claude-opus-4-6, sonnet-4-6: model decides budget
  thinkingBudgets?: {
    // effort-level budgets for non-adaptive models
    low: number;
    medium: number;
    high: number;
    max: number;
  };
}

export function resolveMaxTokens(model: Model, reservePercent = 16): number {
  const normalizedReservePercent = Number.isFinite(reservePercent) ? Math.min(Math.max(reservePercent, 0), 100) : 16;
  const bufferedContextTokens = Math.floor(model.contextWindow * (normalizedReservePercent / 100));
  return Math.max(1, Math.min(model.maxOutputTokens, bufferedContextTokens));
}

// D003: StreamFunction — the provider contract
export type StreamFunction = (
  model: Model,
  context: StreamContext,
  options: StreamOptions,
) => EventStream<ProviderEvent, ProviderResult>;

export interface StreamContext {
  systemPrompt: SystemSection[];
  messages: Message[];
  tools: ToolDefinition[];
}

export interface StreamOptions {
  signal?: AbortSignal;
  maxTokens?: number;
  temperature?: number;
  sessionId?: string;
  effort?: ThinkingEffort;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// Provider error classification (D010)
export type ProviderErrorType =
  | "rate_limit" // 429 — retryable, respect retry-after
  | "overloaded" // 529 — retryable
  | "context_overflow" // 400 with "context length" — NOT retryable, triggers compaction
  | "auth" // 401/403 — NOT retryable, fatal
  | "network" // ECONNREFUSED, timeout — retryable
  | "unknown"; // everything else — NOT retryable

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly errorType: ProviderErrorType,
    public readonly isRetryable: boolean,
    public readonly retryAfterMs?: number,
    public readonly statusCode?: number,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

// Provider events — 11 types
export type ProviderEvent =
  | { type: "start" }
  | { type: "text_delta"; delta: string }
  | { type: "text_end"; text: string }
  | { type: "thinking_delta"; delta: string }
  | { type: "thinking_end"; thinking: string }
  | { type: "tool_call_start"; id: string; name: string }
  | { type: "tool_call_delta"; id: string; delta: string }
  | { type: "tool_call_end"; id: string; name: string; input: Record<string, unknown> }
  | { type: "usage"; usage: Usage }
  | { type: "done"; stopReason: StopReason; message: AssistantMessage }
  | { type: "error"; error: Error };

export interface ProviderResult {
  message: AssistantMessage;
}
