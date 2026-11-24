// @summary Converts pre-Markdown memory stores, including the pre-rename knowledge store, into memory files
import { mkdir, rename, rmdir } from "node:fs/promises";
import { join } from "node:path";
import {
  allocateMemoryId,
  formatIndexLine,
  isMemoryId,
  listMemoryFileIds,
  readMemoryIndex,
  summarizeMemoryContent,
  upsertIndexLine,
  withMemoryLock,
  writeMemoryFile,
  writeMemoryIndex,
} from "./store";
import type { MemoryEntry, MemoryType } from "./types";

const LEGACY_DIR = "knowledge";
const LEGACY_FILENAME = "knowledge.jsonl";
const JSONL_FILENAME = "memory.jsonl";
/** The converted store is kept beside the memory files; names starting with "." are never read as memory. */
const MIGRATED_FILENAME = ".memory.jsonl.migrated";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LEGACY_TYPES: Record<string, MemoryType> = {
  preference: "feedback",
  correction: "feedback",
  pattern: "project",
  discovery: "project",
  backlog: "project",
};

interface LegacyRecord {
  id: string;
  type: MemoryType;
  content: string;
  modified: string;
  sessionId?: string;
}

/**
 * Move `<root>/knowledge/knowledge.jsonl` into the memory directory, then convert the JSONL store into memory
 * files and MEMORY.md lines. Superseded and unreadable entries are not converted, existing memory files are never
 * overwritten, and the original store is kept as `.memory.jsonl.migrated`.
 */
export async function migrateLegacyMemoryStore(root: string, memoryPath: string): Promise<void> {
  await moveLegacyKnowledgeStore(root, memoryPath);
  await convertJsonlStore(memoryPath);
}

/** A JSONL or already converted store is never replaced; the legacy store is then left for the user. */
async function moveLegacyKnowledgeStore(root: string, memoryPath: string): Promise<void> {
  const legacyDir = join(root, LEGACY_DIR);
  const legacyPath = join(legacyDir, LEGACY_FILENAME);
  if (!(await Bun.file(legacyPath).exists())) return;
  const jsonlPath = join(memoryPath, JSONL_FILENAME);
  if ((await Bun.file(jsonlPath).exists()) || (await Bun.file(join(memoryPath, MIGRATED_FILENAME)).exists())) return;
  await mkdir(memoryPath, { recursive: true });
  // A concurrent startup may have moved the store first.
  await rename(legacyPath, jsonlPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  // A legacy directory that still holds other files is left for the user.
  await rmdir(legacyDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOTEMPTY" && error.code !== "ENOENT") throw error;
  });
}

async function convertJsonlStore(memoryPath: string): Promise<void> {
  const jsonlPath = join(memoryPath, JSONL_FILENAME);
  await withMemoryLock(memoryPath, async () => {
    const jsonlFile = Bun.file(jsonlPath);
    if (!(await jsonlFile.exists())) return;
    const records = parseLegacyRecords(await jsonlFile.text());
    const existingIds = new Set((await listMemoryFileIds(memoryPath)).map((id) => id.toLowerCase()));
    const taken = new Set(existingIds);
    let index = await readMemoryIndex(memoryPath);
    for (const record of records) {
      const keepsId = isMemoryId(record.id) && !UUID_PATTERN.test(record.id);
      // A kept id that already exists was converted by an interrupted earlier run or written since.
      if (keepsId && existingIds.has(record.id.toLowerCase())) continue;
      const id = keepsId ? record.id : allocateMemoryId(summarizeMemoryContent(record.content), taken);
      taken.add(id.toLowerCase());
      const entry: MemoryEntry = {
        id,
        name: id,
        description: summarizeMemoryContent(record.content),
        type: record.type,
        content: record.content,
        modified: record.modified,
        ...(record.sessionId ? { sessionId: record.sessionId } : {}),
      };
      await writeMemoryFile(memoryPath, entry, {});
      index = upsertIndexLine(index, id, formatIndexLine(entry));
    }
    if (records.length > 0) await writeMemoryIndex(memoryPath, index);
    await rename(jsonlPath, join(memoryPath, MIGRATED_FILENAME));
  });
}

function parseLegacyRecords(text: string): LegacyRecord[] {
  const records: Array<LegacyRecord & { supersedes?: string }> = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    const type = typeof value?.type === "string" ? LEGACY_TYPES[value.type] : undefined;
    const content = typeof value?.content === "string" ? value.content.trim() : "";
    if (typeof value?.id !== "string" || !type || !content) continue;
    const time = typeof value.timestamp === "number" ? value.timestamp : Date.parse(String(value.timestamp));
    records.push({
      id: value.id.trim(),
      type,
      content,
      modified: new Date(Number.isFinite(time) ? time : Date.now()).toISOString(),
      ...(typeof value.sessionId === "string" ? { sessionId: value.sessionId } : {}),
      ...(typeof value.supersedes === "string" ? { supersedes: value.supersedes } : {}),
    });
  }
  const superseded = new Set(records.flatMap((record) => (record.supersedes ? [record.supersedes] : [])));
  return records
    .filter((record) => !superseded.has(record.id))
    .sort((left, right) => left.modified.localeCompare(right.modified))
    .map(({ supersedes: _supersedes, ...record }) => record);
}
