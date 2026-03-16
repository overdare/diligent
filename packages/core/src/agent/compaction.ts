// @summary Agent-layer compaction helpers — shouldCompact, message selection, runCompaction

import { compact as llmCompact } from "../llm/compaction";
import type { NativeCompactFn } from "../llm/provider/native-compaction";
import { estimateTokens } from "../llm/tokens";
import type { Model, StreamFunction, SystemSection } from "../llm/types";
import type { AssistantMessage, Message } from "../types";
import type { AgentStream, CompactionConfig } from "./types";

export type { CompactionPrompts, CompactMessagesResult } from "../llm/compaction";
// Re-export estimateTokens and LLM-layer compaction types so consumers can import from either location
export { estimateTokens } from "../llm/tokens";

/**
 * Prefix injected before a compaction summary so the resuming model understands
 * that a prior model produced the summary (codex-style handoff framing).
 */
export const COMPACTION_SUMMARY_PREFIX =
  "Another language model started to solve this problem and produced a summary of its thinking process. You also have access to the state of the tools that were used by that language model. Use this to build on the work that has already been done and avoid duplicating work. Here is the summary produced by the other language model, use the information in this summary to assist with your own analysis:";

/**
 * Check if compaction should trigger.
 * D038: contextTokens > contextWindow * (1 - reservePercent / 100)
 */
export interface CompactionDecision {
  estimatedTokens: number;
  reserveTokens: number;
  thresholdTokens: number;
  shouldCompact: boolean;
  source: "assistant_usage" | "estimated_messages";
}

function getLastAssistantMessage(messages: Message[]): AssistantMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role === "assistant") {
      return message;
    }
  }
  return undefined;
}

function getAssistantContextWindowUsage(message: AssistantMessage | undefined): number | undefined {
  if (!message) return undefined;
  const usage = message.usage;
  const total = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  return Number.isFinite(total) ? total : undefined;
}

export function getCompactionDecision(
  allMessages: Message[],
  contextWindow: number,
  reservePercent: number,
): CompactionDecision {
  const assistantUsageTokens = getAssistantContextWindowUsage(getLastAssistantMessage(allMessages));
  const messageEstimatedTokens = estimateTokens(allMessages);
  const estimatedTokens =
    assistantUsageTokens !== undefined
      ? Math.max(assistantUsageTokens, messageEstimatedTokens)
      : messageEstimatedTokens;
  const reserveTokens = Math.floor(contextWindow * (reservePercent / 100));
  const thresholdTokens = contextWindow - reserveTokens;
  return {
    estimatedTokens,
    reserveTokens,
    thresholdTokens,
    shouldCompact: estimatedTokens > thresholdTokens,
    source:
      assistantUsageTokens !== undefined && assistantUsageTokens >= messageEstimatedTokens
        ? "assistant_usage"
        : "estimated_messages",
  };
}

export function shouldCompact(allMessages: Message[], contextWindow: number, reservePercent: number): boolean {
  return getCompactionDecision(allMessages, contextWindow, reservePercent).shouldCompact;
}

function truncateUserMessage(msg: Message, maxTokens: number): Message {
  if (msg.role !== "user") return msg;
  if (typeof msg.content !== "string") return msg;
  const maxChars = maxTokens * 4;
  if (msg.content.length <= maxChars) return msg;
  return { ...msg, content: `${msg.content.slice(0, maxChars)}\n[... truncated]` };
}

/**
 * Select messages to summarize and recent user messages to retain.
 */
export function selectForCompaction(
  messages: Message[],
  keepRecentTokens: number,
): { messagesToSummarize: Message[]; recentUserMessages: Message[] } {
  const messagesToSummarize = [...messages];
  const userMessages = messages.filter((msg) => msg.role === "user");

  // Walk backwards within token budget
  const selected: Message[] = [];
  let accumulatedTokens = 0;

  for (let i = userMessages.length - 1; i >= 0; i--) {
    const msg = userMessages[i];
    const tokens = estimateTokens([msg]);
    if (accumulatedTokens + tokens > keepRecentTokens && selected.length > 0) {
      break;
    }
    const truncated = truncateUserMessage(msg, keepRecentTokens);
    selected.push(truncated);
    accumulatedTokens += Math.min(tokens, keepRecentTokens);
  }

  selected.reverse();

  return { messagesToSummarize, recentUserMessages: selected };
}

export interface RunCompactionInput {
  messages: Message[];
  model: Model;
  systemPrompt: SystemSection[];
  sessionId?: string;
  compactionConfig: CompactionConfig;
  llmMsgStreamFn: StreamFunction;
  llmCompactionFn?: NativeCompactFn;
  stream: AgentStream;
  signal?: AbortSignal;
}

export interface RunCompactionResult {
  summary: string;
  messages: Message[];
}

/**
 * Build the summary-based compacted conversation shape used for persisted session replay.
 */
export function buildMessagesFromCompaction(
  recentUserMessages: Message[],
  summary: string,
  timestamp: number,
): Message[] {
  return [...recentUserMessages, { role: "user" as const, content: summary, timestamp }];
}

/**
 * Split a compacted conversation shape back into the retained user tail and summary message.
 * The canonical compacted shape is [recentUserMessages..., summaryUserMessage].
 */
export function splitCompactionMessages(messages: Message[]): { recentUserMessages: Message[]; summary: string } {
  const summaryMessage = messages[messages.length - 1];
  if (!summaryMessage || summaryMessage.role !== "user" || typeof summaryMessage.content !== "string") {
    throw new Error("Compaction messages must end with a string user summary message");
  }

  const recentUserMessages = messages.slice(0, -1);
  return { recentUserMessages, summary: summaryMessage.content };
}

/**
 * Run compaction unconditionally: selects messages, calls LLM compact, applies summary prefix,
 * and emits compaction_start/end events. Returns the compacted message array — does not mutate in-place.
 */
export async function runCompaction(input: RunCompactionInput): Promise<RunCompactionResult> {
  const { messagesToSummarize, recentUserMessages } = selectForCompaction(
    input.messages,
    input.compactionConfig.keepRecentTokens,
  );
  const tokensBefore = estimateTokens(input.messages);
  const recentUserTokens = estimateTokens(recentUserMessages);
  console.info(
    `[compaction:debug] run=start session=${input.sessionId ?? "-"} provider=${input.model.provider} model=${input.model.id} messages=${input.messages.length} summarize_messages=${messagesToSummarize.length} recent_user_messages=${recentUserMessages.length} tokens_before=${tokensBefore} keep_recent_tokens=${input.compactionConfig.keepRecentTokens} recent_user_tokens=${recentUserTokens}`,
  );
  input.stream.emit({ type: "compaction_start", estimatedTokens: tokensBefore });
  const result = await llmCompact({
    model: input.model,
    messages: messagesToSummarize,
    systemPrompt: input.systemPrompt,
    sessionId: input.sessionId,
    config: input.compactionConfig,
    signal: input.signal,
    streamFn: input.llmMsgStreamFn,
    llmCompactionFn: input.llmCompactionFn,
  });
  const summary = `${COMPACTION_SUMMARY_PREFIX}\n\n${result}`;
  const messages = buildMessagesFromCompaction(recentUserMessages, summary, Date.now());
  const tokensAfter = estimateTokens(messages);
  console.info(
    `[compaction:debug] run=end session=${input.sessionId ?? "-"} provider=${input.model.provider} model=${input.model.id} tokens_before=${tokensBefore} tokens_after=${tokensAfter} summary_chars=${summary.length}`,
  );
  input.stream.emit({
    type: "compaction_end",
    tokensBefore: tokensBefore,
    tokensAfter,
    summary,
  });
  return { summary, messages };
}
