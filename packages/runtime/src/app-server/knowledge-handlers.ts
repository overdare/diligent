// @summary Knowledge CRUD request handlers extracted from thread-handlers.ts

import { deleteKnowledge, upsertKnowledge } from "../knowledge/repository";
import { readKnowledge } from "../knowledge/store";
import type { KnowledgeEntry, KnowledgeType } from "../protocol/index";
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

export async function handleKnowledgeUpdate(
  ctx: ThreadHandlersContext,
  threadId: string | undefined,
  params: {
    action: "upsert" | "delete";
    id?: string;
    type?: KnowledgeType;
    content?: string;
    tags?: string[];
  },
): Promise<{ entry?: KnowledgeEntry; deleted?: boolean }> {
  const runtime = await ctx.resolveThreadRuntime(threadId);
  const paths = await ctx.resolvePaths(runtime.cwd);

  if (params.action === "delete") {
    if (!params.id) {
      throw Object.assign(new Error("Knowledge id is required for delete action"), { code: -32602 });
    }
    return { deleted: await deleteKnowledge(paths.knowledge, params.id) };
  }

  if (!params.type || !params.content || params.content.trim().length === 0) {
    throw Object.assign(new Error("Knowledge type and content are required for upsert action"), { code: -32602 });
  }

  const { entry } = await upsertKnowledge(paths.knowledge, {
    id: params.id,
    type: params.type,
    content: params.content,
    tags: params.tags,
    sessionId: runtime.id,
  });
  return { entry };
}
