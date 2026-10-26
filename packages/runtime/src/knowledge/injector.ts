// @summary Builds ranked knowledge section for system prompt with top-K and token budget constraints
import { rankKnowledge } from "./ranker";
import type { KnowledgeEntry } from "./types";

const DEFAULT_MAX_KNOWLEDGE_ITEMS = 50;

/**
 * Build "Project Knowledge" system prompt section.
 * Selects up to top-K ranked entries that fit the token budget (chars/4 estimation).
 */
export function buildKnowledgeSection(entries: KnowledgeEntry[], budgetTokens: number, maxItems?: number): string {
  if (entries.length === 0) return "";

  const cappedItems = maxItems ?? DEFAULT_MAX_KNOWLEDGE_ITEMS;
  const ranked = rankKnowledge(entries);
  const header = "## Project Knowledge\nThe following knowledge was accumulated from previous sessions:\n\n";
  let section = header;
  let estimatedTokens = Math.ceil(header.length / 4);
  let includedItems = 0;

  for (const entry of ranked) {
    if (includedItems >= cappedItems) break;
    const line = `- [${entry.type}] ${entry.content}\n`;
    const lineTokens = Math.ceil(line.length / 4);
    if (estimatedTokens + lineTokens > budgetTokens) continue;
    section += line;
    estimatedTokens += lineTokens;
    includedItems += 1;
  }

  return includedItems > 0 ? section : "";
}
