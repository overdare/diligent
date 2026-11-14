// @summary Persistent JSONL knowledge store with tolerant reads and serialized atomic writes
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { KnowledgeEntrySchema } from "../protocol/index";
import type { KnowledgeEntry } from "./types";

const KNOWLEDGE_FILENAME = "knowledge.jsonl";

export interface KnowledgeFile {
  entries: KnowledgeEntry[];
  /** Raw lines that are not valid entries. They are kept on disk so a bad line never costs other entries. */
  invalidLines: string[];
}

export interface KnowledgeMutation<T> {
  /** Next full entry list; omit to leave the store untouched. */
  entries?: KnowledgeEntry[];
  result: T;
}

const writeQueues = new Map<string, Promise<unknown>>();

function knowledgeFilePath(knowledgePath: string): string {
  return join(knowledgePath, KNOWLEDGE_FILENAME);
}

/** Read the store, separating valid entries from unreadable lines instead of failing the whole read. */
export async function readKnowledgeFile(knowledgePath: string): Promise<KnowledgeFile> {
  const file = Bun.file(knowledgeFilePath(knowledgePath));
  if (!(await file.exists())) return { entries: [], invalidLines: [] };

  const entries: KnowledgeEntry[] = [];
  const invalidLines: string[] = [];
  for (const line of (await file.text()).split("\n")) {
    if (!line.trim()) continue;
    const entry = parseEntry(line);
    if (entry) entries.push(entry);
    else invalidLines.push(line);
  }
  return { entries, invalidLines };
}

/** Read all valid knowledge entries from the store. */
export async function readKnowledge(knowledgePath: string): Promise<KnowledgeEntry[]> {
  return (await readKnowledgeFile(knowledgePath)).entries;
}

/**
 * Read-modify-write the store. Mutations on the same store run one at a time within this process,
 * and the file is replaced atomically so readers never observe a partial write.
 */
export function mutateKnowledge<T>(
  knowledgePath: string,
  mutate: (entries: KnowledgeEntry[]) => KnowledgeMutation<T> | Promise<KnowledgeMutation<T>>,
): Promise<T> {
  const filePath = knowledgeFilePath(knowledgePath);
  const run = async (): Promise<T> => {
    const current = await readKnowledgeFile(knowledgePath);
    const mutation = await mutate(current.entries);
    if (mutation.entries) await replaceFile(filePath, mutation.entries, current.invalidLines);
    return mutation.result;
  };

  const previous = writeQueues.get(filePath) ?? Promise.resolve();
  const next = previous.then(run, run);
  const settled = next.catch(() => undefined);
  writeQueues.set(filePath, settled);
  void settled.then(() => {
    if (writeQueues.get(filePath) === settled) writeQueues.delete(filePath);
  });
  return next;
}

/** Append a knowledge entry to the store. */
export async function appendKnowledge(knowledgePath: string, entry: KnowledgeEntry): Promise<void> {
  await mutateKnowledge(knowledgePath, (entries) => ({ entries: [...entries, entry], result: undefined }));
}

/** Replace all valid entries in the store. Unreadable lines already on disk are preserved. */
export async function writeKnowledge(knowledgePath: string, entries: KnowledgeEntry[]): Promise<void> {
  await mutateKnowledge(knowledgePath, () => ({ entries, result: undefined }));
}

function parseEntry(line: string): KnowledgeEntry | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  // Validate only; keep the original object so fields written by newer versions survive a rewrite.
  return KnowledgeEntrySchema.safeParse(value).success ? (value as KnowledgeEntry) : null;
}

async function replaceFile(filePath: string, entries: KnowledgeEntry[], invalidLines: string[]): Promise<void> {
  const lines = [...entries.map((entry) => JSON.stringify(entry)), ...invalidLines];
  const text = lines.length > 0 ? `${lines.join("\n")}\n` : "";
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(dirname(filePath), { recursive: true });
  try {
    await Bun.write(tempPath, text);
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}
