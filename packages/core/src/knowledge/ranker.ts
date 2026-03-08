// @summary Ranks knowledge entries by confidence only
import type { KnowledgeEntry } from "./types";

/**
 * Rank knowledge entries by confidence only.
 * Filters out superseded entries.
 */
export function rankKnowledge(entries: KnowledgeEntry[]): KnowledgeEntry[] {
  const supersededIds = new Set(entries.filter((e) => e.supersedes).map((e) => e.supersedes as string));
  const active = entries.filter((e) => !supersededIds.has(e.id));

  return active
    .map((entry) => ({ entry, score: entry.confidence }))
    .sort((a, b) => b.score - a.score)
    .map(({ entry }) => entry);
}
