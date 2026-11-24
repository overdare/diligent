// @summary Persistent JSONL memory store with tolerant reads and serialized atomic writes
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { MemoryEntrySchema } from "../protocol/index";
import type { MemoryEntry } from "./types";

export const MEMORY_FILENAME = "memory.jsonl";

export interface MemoryFile {
  entries: MemoryEntry[];
  /** Raw lines that are not valid entries. They are kept on disk so a bad line never costs other entries. */
  invalidLines: string[];
}

export interface MemoryMutation<T> {
  /** Next full entry list; omit to leave the store untouched. */
  entries?: MemoryEntry[];
  result: T;
}

const writeQueues = new Map<string, Promise<unknown>>();

function memoryFilePath(memoryPath: string): string {
  return join(memoryPath, MEMORY_FILENAME);
}

/** Read the store, separating valid entries from unreadable lines instead of failing the whole read. */
export async function readMemoryFile(memoryPath: string): Promise<MemoryFile> {
  const file = Bun.file(memoryFilePath(memoryPath));
  if (!(await file.exists())) return { entries: [], invalidLines: [] };

  const entries: MemoryEntry[] = [];
  const invalidLines: string[] = [];
  for (const line of (await file.text()).split("\n")) {
    if (!line.trim()) continue;
    const entry = parseEntry(line);
    if (entry) entries.push(entry);
    else invalidLines.push(line);
  }
  return { entries, invalidLines };
}

/** Read all valid memory entries from the store. */
export async function readMemory(memoryPath: string): Promise<MemoryEntry[]> {
  return (await readMemoryFile(memoryPath)).entries;
}

/**
 * Read-modify-write the store. Mutations on the same store run one at a time within this process,
 * and the file is replaced atomically so readers never observe a partial write.
 */
export function mutateMemory<T>(
  memoryPath: string,
  mutate: (entries: MemoryEntry[]) => MemoryMutation<T> | Promise<MemoryMutation<T>>,
): Promise<T> {
  const filePath = memoryFilePath(memoryPath);
  const run = async (): Promise<T> => {
    const current = await readMemoryFile(memoryPath);
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

/** Append a memory entry to the store. */
export async function appendMemory(memoryPath: string, entry: MemoryEntry): Promise<void> {
  await mutateMemory(memoryPath, (entries) => ({ entries: [...entries, entry], result: undefined }));
}

/** Replace all valid entries in the store. Unreadable lines already on disk are preserved. */
export async function writeMemory(memoryPath: string, entries: MemoryEntry[]): Promise<void> {
  await mutateMemory(memoryPath, () => ({ entries, result: undefined }));
}

function parseEntry(line: string): MemoryEntry | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  // Validate only; keep the original object so fields written by newer versions survive a rewrite.
  return MemoryEntrySchema.safeParse(value).success ? (value as MemoryEntry) : null;
}

async function replaceFile(filePath: string, entries: MemoryEntry[], invalidLines: string[]): Promise<void> {
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
