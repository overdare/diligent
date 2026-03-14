// @summary Knowledge CRUD request handlers extracted from thread-handlers.ts

import { readKnowledge, writeKnowledge } from "../knowledge/store";
import type { KnowledgeEntry, KnowledgeType } from "../protocol/index";
import { generateEntryId } from "../session/types";
import type { ThreadHandlersContext } from "./thread-handlers";

export async function handleKnowledgeList(
  ctx: ThreadHandlersContext,
  threadId: string | undefined,
  limit?: number,
): Promise<{ data: unknown[] }> {
  const runtime = await ctx.resolveThreadRuntime(threadId);
  const paths = await ctx.resolvePaths(runtime.cwd);
  const entries = await readKnowledge(paths.knowledge);
  return { data: entries.slice(0, limit ?? entries.length) };
}

export async function handleKnowledgeAdd(
  ctx: ThreadHandlersContext,
  threadId: string | undefined,
  params: {
    type: KnowledgeType;
    content: string;
    confidence?: number;
    tags?: string[];
  },
): Promise<{ entry: KnowledgeEntry }> {
  const runtime = await ctx.resolveThreadRuntime(threadId);
  const paths = await ctx.resolvePaths(runtime.cwd);
  const entries = await readKnowledge(paths.knowledge);
  const entry: KnowledgeEntry = {
    id: generateEntryId(),
    timestamp: new Date().toISOString(),
    sessionId: runtime.id,
    type: params.type,
    content: params.content,
    confidence: params.confidence ?? 0.8,
    tags: params.tags,
  };
  entries.push(entry);
  await writeKnowledge(paths.knowledge, entries);
  return { entry };
}

export async function handleKnowledgeUpdate(
  ctx: ThreadHandlersContext,
  threadId: string | undefined,
  params: {
    id: string;
    type: KnowledgeType;
    content: string;
    confidence: number;
    tags?: string[];
  },
): Promise<{ entry: KnowledgeEntry }> {
  const runtime = await ctx.resolveThreadRuntime(threadId);
  const paths = await ctx.resolvePaths(runtime.cwd);
  const entries = await readKnowledge(paths.knowledge);
  const index = entries.findIndex((entry) => entry.id === params.id);
  if (index < 0) {
    throw Object.assign(new Error(`Knowledge entry not found: ${params.id}`), { code: -32602 });
  }

  const updated: KnowledgeEntry = {
    ...entries[index],
    type: params.type,
    content: params.content,
    confidence: params.confidence,
    tags: params.tags,
    timestamp: new Date().toISOString(),
  };
  entries[index] = updated;
  await writeKnowledge(paths.knowledge, entries);
  return { entry: updated };
}

export async function handleKnowledgeDelete(
  ctx: ThreadHandlersContext,
  threadId: string | undefined,
  id: string,
): Promise<{ deleted: boolean }> {
  const runtime = await ctx.resolveThreadRuntime(threadId);
  const paths = await ctx.resolvePaths(runtime.cwd);
  const entries = await readKnowledge(paths.knowledge);
  const nextEntries = entries.filter((entry) => entry.id !== id);
  const deleted = nextEntries.length !== entries.length;
  if (!deleted) return { deleted: false };
  await writeKnowledge(paths.knowledge, nextEntries);
  return { deleted: true };
}
