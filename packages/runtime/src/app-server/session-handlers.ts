// @summary Session management request handlers: thread list, resume, and delete

import { join } from "node:path";
import { z } from "zod";
import {
  DILIGENT_SERVER_NOTIFICATION_METHODS,
  type SessionSummary,
  type ThreadHistoryResponse,
} from "../protocol/index";
import { buildSessionTranscript } from "../session/context-builder";
import { findSessionPath, readSessionHistoryPage, readSessionPreview } from "../session/history";
import { deleteSession } from "../session/persistence";
import { generateSessionId, isSafeSessionId } from "../session/types";
import type { ThreadHandlersContext } from "./thread-handlers";
import { buildThreadReadItems, type ThreadReadTranscriptEntry } from "./thread-read-builder";

export async function handleThreadResume(
  ctx: ThreadHandlersContext,
  params: { threadId?: string; mostRecent?: boolean },
): Promise<{ found: boolean; threadId?: string }> {
  if (!params.threadId) return resumeThread(ctx, params);
  const existing = ctx.pendingResumes.get(params.threadId);
  if (existing) return existing;
  const pending = resumeThread(ctx, params);
  ctx.pendingResumes.set(params.threadId, pending);
  try {
    return await pending;
  } finally {
    ctx.pendingResumes.delete(params.threadId);
  }
}

async function resumeThread(
  ctx: ThreadHandlersContext,
  params: { threadId?: string; mostRecent?: boolean },
): Promise<{ found: boolean; threadId?: string }> {
  if (params.threadId) {
    const existing = ctx.threads.get(params.threadId);
    if (existing) {
      if (!existing.isRunning && !existing.turnWork) {
        await existing.manager.reconcileFromDisk();
        existing.mode = existing.manager.getCurrentMode() ?? existing.mode;
        existing.effort = existing.manager.getCurrentEffort() ?? existing.effort;
        existing.fastMode = existing.manager.getCurrentFastMode() ?? false;
        existing.model = existing.manager.getCurrentModel() ?? existing.model;
      }
      const context = existing.manager.getContext();
      ctx.setActiveThreadId(params.threadId);
      await ctx.emit({
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_RESUMED,
        params: { threadId: params.threadId, restoredMessages: context.length },
      });
      return { found: true, threadId: params.threadId };
    }
  }

  for (const cwd of Array.from(ctx.knownCwds)) {
    const placeholderId = params.threadId ?? generateSessionId();
    const runtime = await ctx.createThreadRuntime(placeholderId, cwd, "default", false);

    const resumed = await runtime.manager.resume({
      sessionId: params.threadId,
      mostRecent: params.mostRecent,
    });
    if (!resumed) continue;

    const threadId = runtime.manager.sessionId;
    runtime.id = threadId;

    const context = runtime.manager.getContext();
    runtime.mode = runtime.manager.getCurrentMode() ?? runtime.mode;
    runtime.effort = runtime.manager.getCurrentEffort() ?? runtime.effort;
    runtime.fastMode = runtime.manager.getCurrentFastMode() ?? false;
    runtime.model = runtime.manager.getCurrentModel() ?? runtime.model;
    ctx.threads.set(threadId, runtime);

    ctx.setActiveThreadId(threadId);

    await ctx.emit({
      method: DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_RESUMED,
      params: { threadId, restoredMessages: context.length },
    });

    return { found: true, threadId };
  }

  return { found: false };
}

const ListCursorSchema = z.object({ version: z.literal(1), after: z.string() }).strict();

export async function handleThreadList(
  ctx: ThreadHandlersContext,
  limit = 20,
  includeChildren?: boolean,
  cursor?: string,
): Promise<{ data: SessionSummary[]; nextCursor?: string }> {
  let after: string | undefined;
  if (cursor) {
    try {
      after = ListCursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))).after;
    } catch {
      throw new Error("Invalid session list cursor.");
    }
  }
  const files: Array<{ key: string; path: string }> = [];
  for (const cwd of ctx.knownCwds) {
    const paths = await ctx.resolvePaths(cwd);
    for await (const name of new Bun.Glob("*.jsonl").scan(paths.sessions)) {
      const key = `${name}\0${cwd}`;
      if (after === undefined || key < after) files.push({ key, path: join(paths.sessions, name) });
    }
  }
  files.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
  const page = files.slice(0, Math.max(1, Math.min(500, limit)));
  const remaining = page.values();
  const data: SessionSummary[] = [];
  await Promise.all(
    Array.from({ length: Math.min(8, page.length) }, async () => {
      for (const file of remaining) {
        try {
          const session = await readSessionPreview(file.path);
          if (!includeChildren && session.parentSession) continue;
          data.push({
            ...session,
            created: session.created.toISOString(),
            modified: session.modified.toISOString(),
          });
        } catch {
          // One unreadable file must not hide readable conversations in this batch.
        }
      }
    }),
  );
  data.sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified) || b.id.localeCompare(a.id));
  return {
    data,
    nextCursor:
      files.length > page.length
        ? Buffer.from(JSON.stringify({ version: 1, after: page[page.length - 1].key })).toString("base64url")
        : undefined,
  };
}

export async function handleThreadHistory(
  ctx: ThreadHandlersContext,
  params: { threadId: string; cursor?: string; limit?: number },
): Promise<ThreadHistoryResponse> {
  if (!isSafeSessionId(params.threadId)) throw new Error("Invalid thread ID.");
  const runtime = ctx.threads.get(params.threadId);
  if (runtime && !runtime.manager.sessionPath) return { cwd: runtime.cwd, items: [] };
  for (const cwd of ctx.knownCwds) {
    const paths = await ctx.resolvePaths(cwd);
    const path = await findSessionPath(paths.sessions, params.threadId);
    if (!path) continue;
    const page = await readSessionHistoryPage(path, params);
    const transcript = buildSessionTranscript(page.entries);
    return {
      cwd: page.header.cwd,
      items: buildThreadReadItems(transcript as ThreadReadTranscriptEntry[]),
      nextCursor: page.nextCursor,
    };
  }
  throw new Error(`Thread not found: ${params.threadId}`);
}

export async function handleThreadDelete(ctx: ThreadHandlersContext, threadId: string): Promise<{ deleted: boolean }> {
  const existing = ctx.threads.get(threadId);
  if (existing) existing.goalCreation = undefined;
  if (existing?.isRunning || existing?.turnWork) throw new Error("Cannot delete a thread that is currently running");
  await existing?.goal?.pause("deleted");
  if (existing?.goal?.hasChildren) throw new Error("Wait for goal-owned children to settle before deleting the thread");
  if (existing?.goalTimer) clearTimeout(existing.goalTimer);
  await existing?.goal?.close();

  const knownInMemory = ctx.threads.has(threadId);
  let deletedFromDisk = false;

  for (const cwd of ctx.knownCwds) {
    const paths = await ctx.resolvePaths(cwd);
    const result = await deleteSession(paths.sessions, threadId);
    if (!result) continue;
    deletedFromDisk = true;
    break;
  }

  const deleted = deletedFromDisk || knownInMemory;
  if (deleted) {
    existing?.manager.dispose();
    ctx.threads.delete(threadId);
    if (ctx.activeThreadId === threadId) {
      ctx.setActiveThreadId(null);
    }
  }

  return { deleted };
}
