// @summary Memory CRUD request handlers extracted from thread-handlers.ts

import { deleteMemory, upsertMemory } from "../memory/repository";
import { readMemory } from "../memory/store";
import type { MemoryEntry, MemoryType } from "../protocol/index";
import type { ThreadHandlersContext } from "./thread-handlers";

export async function handleMemoryList(
  ctx: ThreadHandlersContext,
  threadId: string | undefined,
  limit?: number,
): Promise<{ data: unknown[] }> {
  const runtime = await ctx.resolveThreadRuntime(threadId);
  const paths = await ctx.resolvePaths(runtime.cwd);
  const entries = await readMemory(paths.memory);
  return { data: entries.slice(0, limit ?? entries.length) };
}

export async function handleMemoryUpdate(
  ctx: ThreadHandlersContext,
  threadId: string | undefined,
  params: {
    action: "upsert" | "delete";
    id?: string;
    type?: MemoryType;
    content?: string;
    tags?: string[];
  },
): Promise<{ entry?: MemoryEntry; deleted?: boolean }> {
  const runtime = await ctx.resolveThreadRuntime(threadId);
  const paths = await ctx.resolvePaths(runtime.cwd);

  if (params.action === "delete") {
    if (!params.id) {
      throw Object.assign(new Error("Memory id is required for delete action"), { code: -32602 });
    }
    return { deleted: await deleteMemory(paths.memory, params.id) };
  }

  if (!params.type || !params.content || params.content.trim().length === 0) {
    throw Object.assign(new Error("Memory type and content are required for upsert action"), { code: -32602 });
  }

  const { entry } = await upsertMemory(paths.memory, {
    id: params.id,
    type: params.type,
    content: params.content,
    tags: params.tags,
    sessionId: runtime.id,
  });
  return { entry };
}
