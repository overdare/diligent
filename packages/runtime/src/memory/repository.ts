// @summary Single owner of memory mutations and lookup shared by agent tools and client RPC
import {
  allocateMemoryId,
  formatIndexLine,
  isMemoryId,
  listMemoryFileIds,
  type MemoryFile,
  readIndexTitles,
  readMemory,
  readMemoryFile,
  readMemoryIndex,
  removeIndexLines,
  removeMemoryFile,
  summarizeMemoryContent,
  upsertIndexLine,
  withMemoryLock,
  writeMemoryFile,
  writeMemoryIndex,
} from "./store";
import type { MemoryEntry, MemoryType } from "./types";

export interface MemoryUpsertInput {
  id?: string;
  type: MemoryType;
  name?: string;
  description?: string;
  content: string;
  sessionId?: string;
}

export type MemoryUpsertStatus = "created" | "updated" | "duplicate";

export interface MemoryUpsertResult {
  entry: MemoryEntry;
  status: MemoryUpsertStatus;
}

export interface MemoryQuery {
  id?: string;
  idPrefix?: string;
  query?: string;
}

/**
 * Create or revise a memory file and its MEMORY.md line. An explicit id updates that file or creates it.
 * Without an id, restating an existing memory with the same type and content refreshes it instead of adding a copy.
 */
export function upsertMemory(memoryPath: string, input: MemoryUpsertInput): Promise<MemoryUpsertResult> {
  const requestedId = input.id?.trim() || undefined;
  if (requestedId && !isMemoryId(requestedId)) {
    return Promise.reject(
      new Error(
        `Invalid memory id "${requestedId}": start with a letter or digit, then use letters, digits, ".", "_", or "-"`,
      ),
    );
  }
  const content = input.content.trim();
  if (!content) return Promise.reject(new Error("Memory content is required"));

  return withMemoryLock(memoryPath, async () => {
    let id = requestedId;
    let status: MemoryUpsertStatus = "updated";
    let existing: MemoryFile | undefined;
    if (id) {
      existing = await readMemoryFile(memoryPath, id);
      if (!existing) status = "created";
    } else {
      const normalized = normalizeContent(content);
      const duplicate = (await readMemory(memoryPath)).find(
        (entry) => entry.type === input.type && normalizeContent(entry.content) === normalized,
      );
      if (duplicate) {
        id = duplicate.id;
        existing = await readMemoryFile(memoryPath, id);
        status = "duplicate";
      } else {
        const taken = new Set((await listMemoryFileIds(memoryPath)).map((fileId) => fileId.toLowerCase()));
        id = allocateMemoryId(
          input.name?.trim() || input.description?.trim() || summarizeMemoryContent(content),
          taken,
        );
        status = "created";
      }
    }

    const previous = existing?.entry;
    const index = await readMemoryIndex(memoryPath);
    const sessionId = previous?.sessionId ?? input.sessionId;
    const name = input.name?.trim() || readIndexTitles(index).get(id) || previous?.name || id;
    let description = input.description?.trim();
    if (!description) {
      if (previous && normalizeContent(previous.content) === normalizeContent(content)) {
        description = previous.description;
      } else {
        description = summarizeMemoryContent(content);
      }
    }
    const entry: MemoryEntry = {
      id,
      name,
      description,
      type: input.type,
      content,
      modified: new Date().toISOString(),
      ...(sessionId ? { sessionId } : {}),
    };
    await writeMemoryFile(memoryPath, entry, existing?.frontmatter ?? {});
    await writeMemoryIndex(memoryPath, upsertIndexLine(index, id, formatIndexLine(entry)));
    return { entry, status };
  });
}

/** Delete a memory file and its MEMORY.md line. Returns whether anything was removed. */
export function deleteMemory(memoryPath: string, id: string): Promise<boolean> {
  const trimmed = id.trim();
  if (!isMemoryId(trimmed)) return Promise.resolve(false);
  return withMemoryLock(memoryPath, async () => {
    const removedFile = await removeMemoryFile(memoryPath, trimmed);
    const index = await readMemoryIndex(memoryPath);
    const nextIndex = removeIndexLines(index, trimmed);
    if (nextIndex !== index) await writeMemoryIndex(memoryPath, nextIndex);
    return removedFile || nextIndex !== index;
  });
}

/**
 * Find entries by exact id, id prefix, and/or query tokens matched against name, description, and content.
 * Query matches are ordered by matched token count, then exact token matches, then recency.
 */
export function searchMemory(entries: MemoryEntry[], { id, idPrefix, query }: MemoryQuery): MemoryEntry[] {
  const queryTokens = tokenize(query);
  const hasQuery = Boolean(query?.trim());
  return entries
    .map((entry) => ({
      entry,
      score: scoreEntry(`${entry.name}\n${entry.description}\n${entry.content}`, queryTokens),
    }))
    .filter(({ entry, score }) => {
      if (id && entry.id !== id) return false;
      if (idPrefix && !entry.id.startsWith(idPrefix)) return false;
      if (hasQuery && score.matchedTokenCount === 0) return false;
      return true;
    })
    .sort((left, right) => {
      if (right.score.matchedTokenCount !== left.score.matchedTokenCount) {
        return right.score.matchedTokenCount - left.score.matchedTokenCount;
      }
      if (right.score.exactTokenCount !== left.score.exactTokenCount) {
        return right.score.exactTokenCount - left.score.exactTokenCount;
      }
      return right.entry.modified.localeCompare(left.entry.modified);
    })
    .map(({ entry }) => entry);
}

// biome-ignore lint/plugin/no-tiny-function: dedupe and description reuse must compare identically normalized content
function normalizeContent(content: string): string {
  return content.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenize(value: string | undefined): string[] {
  if (!value) return [];
  return Array.from(
    new Set(
      value
        .normalize("NFC")
        .toLowerCase()
        .split(/[^\p{L}\p{N}\p{M}]+/u)
        .filter(Boolean),
    ),
  );
}

function scoreEntry(content: string, queryTokens: string[]): { matchedTokenCount: number; exactTokenCount: number } {
  if (queryTokens.length === 0) return { matchedTokenCount: 0, exactTokenCount: 0 };
  const contentTokens = tokenize(content);
  if (contentTokens.length === 0) return { matchedTokenCount: 0, exactTokenCount: 0 };

  let matchedTokenCount = 0;
  let exactTokenCount = 0;
  for (const queryToken of queryTokens) {
    let matched = false;
    for (const contentToken of contentTokens) {
      if (contentToken === queryToken) {
        matched = true;
        exactTokenCount += 1;
        break;
      }
      // Single-character content tokens would match any query containing that character.
      if (contentToken.includes(queryToken) || (contentToken.length >= 2 && queryToken.includes(contentToken))) {
        matched = true;
      }
    }
    if (matched) matchedTokenCount += 1;
  }

  return { matchedTokenCount, exactTokenCount };
}
