// @summary Builds the Project Memory system prompt section from the MEMORY.md index within line and token budgets
import { readMemoryIndex } from "./store";

/** Claude Code loads the same number of MEMORY.md lines at session start. */
const DEFAULT_MAX_INDEX_LINES = 200;
const DEFAULT_INJECTION_BUDGET = 8192;

export interface MemoryInjectionConfig {
  enabled?: boolean;
  injectionBudget?: number;
  /** Maximum MEMORY.md lines injected. */
  maxItems?: number;
}

/**
 * Build the "Project Memory" section: the memory directory and the leading MEMORY.md lines that fit
 * `maxLines` and the token budget (chars/4 estimation). Memory files themselves are read on demand.
 */
export function buildMemorySection(
  index: string,
  memoryPath: string,
  budgetTokens = DEFAULT_INJECTION_BUDGET,
  maxLines = DEFAULT_MAX_INDEX_LINES,
): string {
  const lines = index.replace(/\s+$/, "").split("\n");
  if (!lines.some((line) => line.trim())) return "";

  const header = [
    "## Project Memory",
    `Memory directory: ${memoryPath}`,
    "MEMORY.md, shown below, indexes memory that earlier sessions saved for this project, one Markdown file per memory in that directory. Read a linked file when its entry is relevant. Memory can be outdated; check it against the current project before relying on it.",
    "",
    "",
  ].join("\n");
  const budgetChars = budgetTokens * 4 - header.length - 1;
  const included: string[] = [];
  let usedChars = 0;
  for (const line of lines) {
    if (included.length >= maxLines || usedChars + line.length + 1 > budgetChars) break;
    included.push(line);
    usedChars += line.length + 1;
  }
  let note = continuationNote(lines.length - included.length);
  while (note && included.length > 0 && usedChars + note.length > budgetChars) {
    usedChars -= (included.pop() as string).length + 1;
    note = continuationNote(lines.length - included.length);
  }
  if (!included.some((line) => line.trim())) return "";
  return `${header}${included.join("\n")}${note}\n`;
}

function continuationNote(omittedLines: number): string {
  return omittedLines > 0 ? `\n\n(MEMORY.md continues; ${omittedLines} more lines are not shown.)` : "";
}

/** Read MEMORY.md and build the memory section, or "" when memory injection is disabled. */
export async function loadMemorySection(
  memoryPath: string,
  config: MemoryInjectionConfig | undefined,
): Promise<string> {
  if (config?.enabled === false) return "";
  return buildMemorySection(await readMemoryIndex(memoryPath), memoryPath, config?.injectionBudget, config?.maxItems);
}
