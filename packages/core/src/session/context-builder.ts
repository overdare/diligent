// @summary Builds linear message context from tree-structured session entries with compaction support
import type { Message, ToolResultMessage } from "../types";
import { formatFileOperations } from "./compaction";
import type { CompactionEntry, SessionEntry } from "./types";

export interface SessionContext {
  messages: Message[];
  currentModel?: { provider: string; modelId: string };
}

/**
 * Build linear context from tree-structured entries.
 *
 * Algorithm:
 * 1. Build byId index
 * 2. Walk from leafId to root via parentId chain
 * 3. Reverse to chronological order
 * 4. If a CompactionEntry exists, inject summary and skip older entries
 * 5. Extract messages + track latest model setting
 */
export function buildSessionContext(entries: SessionEntry[], leafId?: string | null): SessionContext {
  if (entries.length === 0) {
    return { messages: [] };
  }

  const byId = new Map<string, SessionEntry>();
  for (const entry of entries) {
    byId.set(entry.id, entry);
  }

  // Find leaf: specified leafId, or last entry
  const leaf = leafId ? byId.get(leafId) : entries[entries.length - 1];

  if (!leaf) {
    return { messages: [] };
  }

  // Walk from leaf to root
  const path: SessionEntry[] = [];
  let current: SessionEntry | undefined = leaf;
  while (current) {
    path.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  path.reverse();

  // Find the latest CompactionEntry on the path
  let lastCompaction: CompactionEntry | undefined;
  let compactionIndex = -1;
  for (let i = path.length - 1; i >= 0; i--) {
    if (path[i].type === "compaction") {
      lastCompaction = path[i] as CompactionEntry;
      compactionIndex = i;
      break;
    }
  }

  const messages: Message[] = [];
  let currentModel: { provider: string; modelId: string } | undefined;

  if (lastCompaction) {
    // Inject summary as first user message
    const summaryWithFiles = lastCompaction.details
      ? lastCompaction.summary + formatFileOperations(lastCompaction.details)
      : lastCompaction.summary;

    messages.push({
      role: "user",
      content: `[Session Summary]\n${summaryWithFiles}`,
      timestamp: Date.parse(lastCompaction.timestamp),
    });

    // Only process entries AFTER the compaction entry
    for (let i = compactionIndex + 1; i < path.length; i++) {
      const entry = path[i];
      switch (entry.type) {
        case "message":
          messages.push(entry.message);
          break;
        case "steering":
          messages.push(entry.message);
          break;
        case "model_change":
          currentModel = { provider: entry.provider, modelId: entry.modelId };
          break;
      }
    }
  } else {
    // No compaction — existing behavior
    for (const entry of path) {
      switch (entry.type) {
        case "message":
          messages.push(entry.message);
          break;
        case "steering":
          messages.push(entry.message);
          break;
        case "model_change":
          currentModel = { provider: entry.provider, modelId: entry.modelId };
          break;
      }
    }
  }

  return { messages: repairOrphanedToolUse(messages), currentModel };
}

/**
 * Ensure every tool_use in assistant messages has a matching tool_result.
 * When a session is interrupted mid-tool-execution, the assistant message
 * with tool_call blocks is persisted but the tool_result never arrives.
 * The Anthropic API rejects such histories. We inject synthetic "interrupted"
 * tool_result messages so the conversation can resume cleanly.
 */
function repairOrphanedToolUse(messages: Message[]): Message[] {
  if (messages.length === 0) return messages;

  const result: Message[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    result.push(msg);

    if (msg.role !== "assistant") continue;

    // Collect tool_call ids from this assistant message
    const toolCallIds = msg.content
      .filter((b) => b.type === "tool_call")
      .map((b) => (b as { type: "tool_call"; id: string }).id);

    if (toolCallIds.length === 0) continue;

    // Collect tool_result ids that follow before the next non-tool_result message
    const followingResultIds = new Set<string>();
    for (let j = i + 1; j < messages.length; j++) {
      if (messages[j].role === "tool_result") {
        followingResultIds.add((messages[j] as ToolResultMessage).toolCallId);
      } else {
        break;
      }
    }

    // Inject synthetic results for any orphaned tool_calls
    for (const id of toolCallIds) {
      if (!followingResultIds.has(id)) {
        const toolCallBlock = msg.content.find((b) => b.type === "tool_call" && (b as { id: string }).id === id);
        result.push({
          role: "tool_result",
          toolCallId: id,
          toolName: (toolCallBlock as { name: string })?.name ?? "unknown",
          output: "Session interrupted before tool execution completed.",
          isError: true,
          timestamp: msg.timestamp,
        });
      }
    }
  }

  return result;
}
