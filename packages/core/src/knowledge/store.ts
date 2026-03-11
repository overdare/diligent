// @summary Persistent JSONL-based knowledge store with append and read operations
import { join } from "node:path";
import type { KnowledgeEntry } from "./types";

const KNOWLEDGE_FILENAME = "knowledge.jsonl";

/** Append a knowledge entry to the store. */
export async function appendKnowledge(knowledgePath: string, entry: KnowledgeEntry): Promise<void> {
  const filePath = join(knowledgePath, KNOWLEDGE_FILENAME);
  const line = `${JSON.stringify(entry)}\n`;

  const file = Bun.file(filePath);
  if (await file.exists()) {
    const existing = await file.text();
    await Bun.write(filePath, existing + line);
  } else {
    await Bun.write(filePath, line);
  }
}

/** Read all knowledge entries from the store. */
export async function readKnowledge(knowledgePath: string): Promise<KnowledgeEntry[]> {
  const filePath = join(knowledgePath, KNOWLEDGE_FILENAME);
  const file = Bun.file(filePath);
  if (!(await file.exists())) return [];

  const text = await file.text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as KnowledgeEntry);
}

/** Overwrite the full knowledge store with provided entries. */
export async function writeKnowledge(knowledgePath: string, entries: KnowledgeEntry[]): Promise<void> {
  const filePath = join(knowledgePath, KNOWLEDGE_FILENAME);
  if (entries.length === 0) {
    await Bun.write(filePath, "");
    return;
  }
  const text = `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
  await Bun.write(filePath, text);
}
