// @summary Ranks active knowledge by confidence, then recency
import type { KnowledgeEntry } from "./types";

/**
 * Rank knowledge entries by confidence, preferring recent entries on ties.
 * Filters out superseded entries.
 */
export function rankKnowledge(entries: KnowledgeEntry[]): KnowledgeEntry[] {
  const supersededIds = new Set(entries.filter((e) => e.supersedes).map((e) => e.supersedes as string));
  const active = entries.filter((e) => !supersededIds.has(e.id));

  return active.sort((a, b) => b.confidence - a.confidence || Date.parse(b.timestamp) - Date.parse(a.timestamp));
}
