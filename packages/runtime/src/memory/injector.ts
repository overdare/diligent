// @summary Builds ranked memory section for system prompt with top-K and token budget constraints
import { rankMemory } from "./ranker";
import { readMemory } from "./store";
import type { MemoryEntry } from "./types";

const DEFAULT_MAX_MEMORY_ITEMS = 50;
const DEFAULT_INJECTION_BUDGET = 8192;

export interface MemoryInjectionConfig {
  enabled?: boolean;
  injectionBudget?: number;
  maxItems?: number;
}

/**
 * Build "Project Memory" system prompt section.
 * Selects up to top-K ranked entries that fit the token budget (chars/4 estimation).
 */
export function buildMemorySection(entries: MemoryEntry[], budgetTokens: number, maxItems?: number): string {
  if (entries.length === 0) return "";

  const cappedItems = maxItems ?? DEFAULT_MAX_MEMORY_ITEMS;
  const ranked = rankMemory(entries);
  const header = "## Project Memory\nThe following memory was accumulated from previous sessions:\n\n";
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

/** Read the store and build the memory section, or "" when memory injection is disabled. */
export async function loadMemorySection(
  memoryPath: string,
  config: MemoryInjectionConfig | undefined,
): Promise<string> {
  if (config?.enabled === false) return "";
  const entries = await readMemory(memoryPath);
  return buildMemorySection(entries, config?.injectionBudget ?? DEFAULT_INJECTION_BUDGET, config?.maxItems);
}
