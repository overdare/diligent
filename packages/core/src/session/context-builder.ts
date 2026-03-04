// @summary Builds linear message context from tree-structured session entries with compaction support
import type { Message, ToolResultMessage } from "../types";
import { formatFileOperations, SUMMARY_PREFIX } from "./compaction";
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
export function buildSessionContext(
  entries: SessionEntry[],
  leafId?: string | null,
  options?: { skipRepair?: boolean },
): SessionContext {
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
    // 1. Inject recent user messages (chronological, stored on CompactionEntry)
    // Guard: v4 sessions may lack recentUserMessages
    for (const msg of lastCompaction.recentUserMessages ?? []) {
      messages.push(msg);
    }

    // 2. Inject summary with SUMMARY_PREFIX (last in prefix = stable for cache)
    const summaryWithFiles = lastCompaction.details
      ? lastCompaction.summary + formatFileOperations(lastCompaction.details)
      : lastCompaction.summary;

    messages.push({
      role: "user",
      content: `${SUMMARY_PREFIX}\n\n${summaryWithFiles}`,
      timestamp: Date.parse(lastCompaction.timestamp),
    });

    // 3. Process entries AFTER compactionIndex only (new turns)
    for (let i = compactionIndex + 1; i < path.length; i++) {
      const entry = path[i];
      if (entry.type === "compaction") continue;
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

  return {
    messages: options?.skipRepair ? messages : deduplicateUserMessages(normalizeToolMessages(messages)),
    currentModel,
  };
}

/**
 * Remove consecutive duplicate user messages.
 * Keeps the LAST occurrence so the most recent timestamp is preserved.
 * JSONL retains all entries for UI history; this only affects API-bound messages.
 */
function deduplicateUserMessages(messages: Message[]): Message[] {
  if (messages.length <= 1) return messages;

  const result: Message[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const next = messages[i + 1];
    // Skip if next message is same role=user with identical content
    if (
      msg.role === "user" &&
      next?.role === "user" &&
      typeof msg.content === "string" &&
      typeof next.content === "string" &&
      msg.content === next.content
    ) {
      continue;
    }
    result.push(msg);
  }
  return result;
}

/**
 * Normalize tool message ordering for API compatibility.
 *
 * Handles two problems:
 * 1. **Interleaved messages**: Steering messages persisted between tool_use and
 *    tool_result (user steered while approval was pending). These get moved
 *    AFTER the tool_results so the API sees: assistant(tool_use) → tool_results → steering.
 * 2. **Orphaned tool_calls**: Session interrupted before tool_result arrived.
 *    Synthetic "interrupted" tool_results are injected.
 */
function normalizeToolMessages(messages: Message[]): Message[] {
  if (messages.length === 0) return messages;

  const result: Message[] = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];
    result.push(msg);
    i++;

    if (msg.role !== "assistant") continue;

    // Collect tool_call ids from this assistant message
    const pendingIds = new Set(
      msg.content.filter((b) => b.type === "tool_call").map((b) => (b as { type: "tool_call"; id: string }).id),
    );

    if (pendingIds.size === 0) continue;

    // Scan ahead: separate tool_results from interleaved messages
    const toolResults: ToolResultMessage[] = [];
    const deferred: Message[] = [];

    while (i < messages.length && pendingIds.size > 0) {
      const next = messages[i];
      if (next.role === "tool_result" && pendingIds.has((next as ToolResultMessage).toolCallId)) {
        toolResults.push(next as ToolResultMessage);
        pendingIds.delete((next as ToolResultMessage).toolCallId);
        i++;
      } else if (next.role === "assistant") {
        // Next assistant turn — stop scanning
        break;
      } else {
        // Non-tool_result (e.g., steering user message) — defer it
        deferred.push(next);
        i++;
      }
    }

    // Push tool_results first (API requires them adjacent to tool_use)
    for (const tr of toolResults) result.push(tr);

    // Inject synthetic results for any truly orphaned tool_calls
    for (const id of pendingIds) {
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

    // Push deferred messages after tool_results
    for (const d of deferred) result.push(d);
  }

  return result;
}
