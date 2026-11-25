// @summary Single owner of memory mutations and lookup shared by agent tools and client RPC
import { rankMemory } from "./ranker";
import { mutateMemory } from "./store";
import type { MemoryEntry, MemoryType } from "./types";

const DEFAULT_CONFIDENCE = 0.8;

export interface MemoryUpsertInput {
  id?: string;
  type: MemoryType;
  content: string;
  tags?: string[];
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
 * Create or revise an entry. An explicit id updates that entry or creates it under that id.
 * Without an id, restating an active entry with the same type and content refreshes it instead of adding a copy.
 */
export function upsertMemory(memoryPath: string, input: MemoryUpsertInput): Promise<MemoryUpsertResult> {
  const id = input.id?.trim();
  const content = input.content.trim();
  const now = new Date().toISOString();

  return mutateMemory<MemoryUpsertResult>(memoryPath, (entries) => {
    const index = id ? entries.findIndex((entry) => entry.id === id) : findDuplicateIndex(entries, input.type, content);

    if (index >= 0) {
      const existing = entries[index];
      const entry: MemoryEntry = {
        ...existing,
        type: input.type,
        content,
        tags: input.tags ?? existing.tags,
        timestamp: now,
      };
      const next = [...entries];
      next[index] = entry;
      return { entries: next, result: { entry, status: id ? "updated" : "duplicate" } };
    }

    const entry: MemoryEntry = {
      id: id || crypto.randomUUID(),
      timestamp: now,
      sessionId: input.sessionId,
      type: input.type,
      content,
      confidence: DEFAULT_CONFIDENCE,
      tags: input.tags,
    };
    return { entries: [...entries, entry], result: { entry, status: "created" } };
  });
}

/** Delete an entry by id. Returns whether an entry was removed. */
export function deleteMemory(memoryPath: string, id: string): Promise<boolean> {
  return mutateMemory(memoryPath, (entries) => {
    const next = entries.filter((entry) => entry.id !== id);
    if (next.length === entries.length) return { result: false };
    return { entries: next, result: true };
  });
}

/**
 * Find active entries by exact id, id prefix, and/or query tokens.
 * Query matches are ordered by matched token count, then exact token matches, then recency.
 */
export function searchMemory(entries: MemoryEntry[], { id, idPrefix, query }: MemoryQuery): MemoryEntry[] {
  const queryTokens = tokenize(query);
  const hasQuery = Boolean(query?.trim());
  return rankMemory(entries)
    .map((entry) => ({ entry, score: scoreEntry(entry.content, queryTokens) }))
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
      return right.entry.timestamp.localeCompare(left.entry.timestamp);
    })
    .map(({ entry }) => entry);
}

function findDuplicateIndex(entries: MemoryEntry[], type: MemoryType, content: string): number {
  const supersededIds = new Set(entries.flatMap((entry) => (entry.supersedes ? [entry.supersedes] : [])));
  const normalized = normalizeContent(content);
  return entries.findIndex(
    (entry) => !supersededIds.has(entry.id) && entry.type === type && normalizeContent(entry.content) === normalized,
  );
}

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
