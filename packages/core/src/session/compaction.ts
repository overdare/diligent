// @summary Session compaction with LLM summarization, recent user message selection, and file operation tracking

import type { Model, StreamContext, StreamFunction } from "../provider/types";
import { resolveMaxTokens } from "../provider/types";
import type { Message, TextBlock } from "../types";
import type { CompactionDetails, SessionEntry } from "./types";

/**
 * Estimate token count from message content.
 * Uses chars/4 heuristic (D038 — matches pi-agent).
 */
export function estimateTokens(messages: Message[]): number {
  let chars = 0;
  for (const msg of messages) {
    if (msg.role === "user") {
      chars += typeof msg.content === "string" ? msg.content.length : JSON.stringify(msg.content).length;
    } else if (msg.role === "assistant") {
      for (const block of msg.content) {
        if (block.type === "text") chars += block.text.length;
        else if (block.type === "thinking") chars += block.thinking.length;
        else if (block.type === "tool_call") chars += JSON.stringify(block.input).length + block.name.length;
      }
    } else if (msg.role === "tool_result") {
      chars += msg.output.length;
    }
  }
  return Math.ceil(chars / 4);
}

/**
 * Check if compaction should trigger.
 * D038: contextTokens > contextWindow * (1 - reservePercent / 100)
 */
export function shouldCompact(estimatedTokens: number, contextWindow: number, reservePercent: number): boolean {
  const reserveTokens = Math.floor(contextWindow * (reservePercent / 100));
  return estimatedTokens > contextWindow - reserveTokens;
}

/**
 * Codex-rs SUMMARY_PREFIX — distinguishes summary injections from real user messages.
 * Prevents summary accumulation when collecting recent user messages in iterative compactions.
 */
export const SUMMARY_PREFIX =
  "Another language model started to solve this problem and produced a summary " +
  "of its thinking process. You also have access to the state of the tools that " +
  "were used by that language model. Use this to build on the work that has " +
  "already been done and avoid duplicating work. Here is the summary produced " +
  "by the other language model, use the information in this summary to assist " +
  "with your own analysis:";

/** Check if a message is a summary injection (to filter during user message collection). */
export function isSummaryMessage(msg: Message): boolean {
  if (msg.role !== "user" || typeof msg.content !== "string") return false;
  return msg.content.startsWith(`${SUMMARY_PREFIX}\n`);
}

export interface RecentUserMessagesResult {
  recentUserMessages: Message[];
  entriesToSummarize: SessionEntry[];
}

/**
 * Collect recent user messages within a token budget, and identify all entries to summarize.
 * Codex-rs approach: summarize ALL entries; independently select recent user messages.
 */
export function findRecentUserMessages(
  pathEntries: SessionEntry[],
  keepRecentTokens: number,
): RecentUserMessagesResult {
  if (pathEntries.length === 0) {
    return { recentUserMessages: [], entriesToSummarize: [] };
  }

  // Find startIndex after last compaction
  let startIndex = 0;
  for (let i = pathEntries.length - 1; i >= 0; i--) {
    if (pathEntries[i].type === "compaction") {
      startIndex = i + 1;
      break;
    }
  }

  // All entries after last compaction are summarized
  const entriesToSummarize = pathEntries.slice(startIndex);

  // Collect user messages (excluding summary injections)
  const userMessages: Message[] = [];
  for (const entry of entriesToSummarize) {
    if (entry.type === "message" && entry.message.role === "user" && !isSummaryMessage(entry.message)) {
      userMessages.push(entry.message);
    }
  }

  // Walk backwards within token budget, truncate overlong messages
  const selected: Message[] = [];
  let accumulatedTokens = 0;

  for (let i = userMessages.length - 1; i >= 0; i--) {
    const msg = userMessages[i];
    const tokens = estimateTokens([msg]);
    if (accumulatedTokens + tokens > keepRecentTokens && selected.length > 0) {
      break;
    }
    // Truncate overlong individual messages
    const truncated = truncateUserMessage(msg, keepRecentTokens);
    selected.push(truncated);
    accumulatedTokens += Math.min(tokens, keepRecentTokens);
  }

  // Reverse to chronological order
  selected.reverse();

  return { recentUserMessages: selected, entriesToSummarize };
}

function truncateUserMessage(msg: Message, maxTokens: number): Message {
  if (msg.role !== "user" || typeof msg.content !== "string") return msg;
  const maxChars = maxTokens * 4;
  if (msg.content.length <= maxChars) return msg;
  return { ...msg, content: `${msg.content.slice(0, maxChars)}\n[... truncated]` };
}

// --- Summarization ---

const SUMMARIZATION_PROMPT = `You are performing a CONTEXT CHECKPOINT COMPACTION.
Create a handoff summary for another LLM that will resume this coding task.

Use this exact structure:

## Goal
What the user is trying to accomplish.

## Progress
### Done
- Completed tasks with specific details (file paths, function names).
### In Progress
- Tasks started but not finished.
### Blocked
- Issues preventing progress.

## Key Decisions
- Technical decisions made with brief rationale.

## Next Steps
- What should happen next.

## Critical Context
- Important details that must not be lost (variable names, API endpoints, error messages, etc.).

Be concise, structured, and focused on helping the next LLM seamlessly continue the work.
File paths and code identifiers are critical.`;

const UPDATE_SUMMARIZATION_PROMPT = `You are performing a CONTEXT CHECKPOINT COMPACTION.
Update the existing handoff summary with new information for another LLM that will resume this coding task.

Rules:
- PRESERVE all information from the previous summary
- ADD new progress, decisions, and context
- MOVE "In Progress" items to "Done" when completed
- UPDATE "Next Steps" based on new accomplishments
- Keep the same structure

Be concise, structured, and focused on helping the next LLM seamlessly continue the work.

Previous summary:
{previousSummary}

New conversation to integrate:`;

/**
 * Generate a compaction summary using an LLM call.
 * D037: LLM-based with iterative summary updating.
 */
export async function generateSummary(
  messages: Message[],
  streamFunction: StreamFunction,
  model: Model,
  options: {
    previousSummary?: string;
    signal?: AbortSignal;
    reservePercent?: number;
  },
): Promise<string> {
  const prompt = options.previousSummary
    ? UPDATE_SUMMARIZATION_PROMPT.replace("{previousSummary}", options.previousSummary)
    : SUMMARIZATION_PROMPT;

  // Ensure messages end with a user message — required when extended thinking is enabled
  // (the API rejects assistant-last conversations as "prefill" with thinking mode).
  const summaryMessages =
    messages.length > 0 && messages[messages.length - 1].role !== "user"
      ? [...messages, { role: "user" as const, content: "Please provide the summary now.", timestamp: Date.now() }]
      : messages;

  const context: StreamContext = {
    systemPrompt: [{ label: "system", content: prompt }],
    messages: summaryMessages,
    tools: [],
  };

  const providerStream = streamFunction(model, context, {
    signal: options.signal,
    effort: "low",
    maxTokens: resolveMaxTokens(model, options.reservePercent),
  });

  const result = await providerStream.result();
  const textBlocks = result.message.content.filter((b): b is TextBlock => b.type === "text");
  return textBlocks.map((b) => b.text).join("\n");
}

/**
 * D039: Extract file operations from messages being compacted.
 * Pairs tool_result messages with their preceding tool_call blocks.
 * Cumulative: merges with previous compaction's file ops.
 */
export function extractFileOperations(messages: Message[], previousDetails?: CompactionDetails): CompactionDetails {
  const readFiles = new Set(previousDetails?.readFiles ?? []);
  const modifiedFiles = new Set(previousDetails?.modifiedFiles ?? []);

  // Build a map of toolCallId → tool call info from assistant messages
  const toolCalls = new Map<string, { name: string; input: Record<string, unknown> }>();
  for (const msg of messages) {
    if (msg.role === "assistant") {
      for (const block of msg.content) {
        if (block.type === "tool_call") {
          toolCalls.set(block.id, { name: block.name, input: block.input });
        }
      }
    }
  }

  for (const msg of messages) {
    if (msg.role !== "tool_result") continue;
    const call = toolCalls.get(msg.toolCallId);
    if (!call) continue;

    const filePath = call.input.file_path as string | undefined;
    if (!filePath) continue;

    if (call.name === "read") {
      readFiles.add(filePath);
    } else if (call.name === "write" || call.name === "apply_patch") {
      modifiedFiles.add(filePath);
    }
  }

  return {
    readFiles: [...readFiles],
    modifiedFiles: [...modifiedFiles],
  };
}

/**
 * D039: Append file operation summary to compaction summary.
 */
export function formatFileOperations(details: CompactionDetails): string {
  const lines: string[] = [];
  if (details.readFiles.length > 0) {
    lines.push(`\n## Files Read\n${details.readFiles.map((f) => `- ${f}`).join("\n")}`);
  }
  if (details.modifiedFiles.length > 0) {
    lines.push(`\n## Files Modified\n${details.modifiedFiles.map((f) => `- ${f}`).join("\n")}`);
  }
  return lines.join("\n");
}
