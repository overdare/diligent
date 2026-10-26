// @summary Browser-safe merging for progressive session discovery and chronological history pages

import type { SessionSummary, ThreadItem } from "@diligent/protocol";

type ToolItem = Extract<ThreadItem, { type: "toolCall" }>;

function mergeToolItem(older: ToolItem, newer: ToolItem): ToolItem {
  // A result-only page does not know the original input/start/render fields.
  // Keep the start's position and data while taking completion data from the result.
  const start =
    newer.startedAt !== undefined && (older.startedAt === undefined || newer.startedAt < older.startedAt)
      ? newer
      : older;
  const completed = newer.output !== undefined ? newer : older.output !== undefined ? older : newer;
  return {
    ...older,
    ...newer,
    input: start.input ?? (start === older ? newer.input : older.input),
    timestamp: completed.timestamp ?? newer.timestamp ?? older.timestamp,
    startedAt: start.startedAt ?? older.startedAt ?? newer.startedAt,
    render:
      start.render && completed.render
        ? {
            ...completed.render,
            inputSummary: start.render.inputSummary ?? completed.render.inputSummary,
            outputSummary: completed.render.outputSummary ?? start.render.outputSummary,
          }
        : (start.render ?? completed.render),
    parentToolCallId: older.parentToolCallId ?? newer.parentToolCallId,
    output: newer.output ?? older.output,
    outputImages: newer.outputImages ?? older.outputImages,
    isError: newer.isError ?? older.isError,
    durationMs: newer.durationMs ?? older.durationMs,
    metadata: older.metadata || newer.metadata ? { ...older.metadata, ...newer.metadata } : undefined,
  };
}

/** Merge chronological pages, keeping a split tool at its original start position. */
export function mergeHistoryItems(older: readonly ThreadItem[], newer: readonly ThreadItem[]): ThreadItem[] {
  const items: ThreadItem[] = [];
  const positions = new Map<string, number>();
  for (const page of [older, newer]) {
    for (const item of page) {
      const position = positions.get(item.itemId);
      if (position === undefined) {
        positions.set(item.itemId, items.length);
        items.push(item);
        continue;
      }
      const previous = items[position];
      items[position] = previous.type === "toolCall" && item.type === "toolCall" ? mergeToolItem(previous, item) : item;
    }
  }
  return items;
}

/** Discovery pages are not globally sorted; every arriving batch updates the visible list. */
export function mergeSessionSummaries(
  existing: readonly SessionSummary[],
  incoming: readonly SessionSummary[],
): SessionSummary[] {
  const sessions = new Map(existing.map((session) => [session.id, session]));
  for (const session of incoming) sessions.set(session.id, session);
  return [...sessions.values()].sort((a, b) => b.modified.localeCompare(a.modified) || a.id.localeCompare(b.id));
}
