// @summary Builds linear message context from tree-structured session entries with compaction support
import type { Message } from "../types";
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
        case "model_change":
          currentModel = { provider: entry.provider, modelId: entry.modelId };
          break;
      }
    }
  }

  return {
    messages,
    currentModel,
  };
}
