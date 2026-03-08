// @summary App-server thread/turn/tool request handlers extracted from server.ts

import {
  DILIGENT_SERVER_NOTIFICATION_METHODS,
  type DiligentServerNotification,
  type PluginDescriptor,
  type SessionSummary,
  type ThinkingEffort,
  type ToolConflictPolicy,
  type ToolDescriptor,
  type TurnStartParams,
  type Mode,
} from "@diligent/protocol";
import type { AgentRegistry } from "../collab/registry";
import type { DiligentConfig } from "../config/schema";
import type { DiligentPaths } from "../infrastructure/diligent-dir";
import { getProjectConfigPath, writeProjectToolsConfig } from "../config/writer";
import { readKnowledge } from "../knowledge/store";
import { buildSessionContext } from "../session/context-builder";
import { deleteSession, listSessions, readChildSessions, readSessionFile } from "../session/persistence";
import type { SessionManager } from "../session/manager";
import { generateSessionId } from "../session/types";
import { buildDefaultTools } from "../tools/defaults";

export interface ThreadRuntime {
  id: string;
  cwd: string;
  mode: Mode;
  effort: ThinkingEffort;
  manager: SessionManager;
  abortController: AbortController | null;
  currentTurnId: string | null;
  isRunning: boolean;
  registry?: AgentRegistry;
}

interface ThreadHandlersContext {
  activeThreadId: string | null;
  threads: Map<string, ThreadRuntime>;
  knownCwds: Set<string>;
  resolvePaths: (cwd: string) => Promise<DiligentPaths>;
  createThreadRuntime: (
    threadId: string,
    cwd: string,
    mode: Mode,
    createNew: boolean,
    effort?: ThinkingEffort,
  ) => Promise<ThreadRuntime>;
  resolveThreadRuntime: (threadId?: string) => Promise<ThreadRuntime>;
  getLatestEffortForCwd: (cwd: string) => Promise<ThinkingEffort>;
  emit: (notification: DiligentServerNotification) => Promise<void>;
  consumeStream: (runtime: ThreadRuntime, stream: ReturnType<SessionManager["run"]>, turnId: string) => Promise<void>;
  resolveToolsContext: (threadId?: string) => Promise<{ cwd: string; tools: DiligentConfig["tools"] | undefined }>;
  setActiveThreadId: (threadId: string | null) => void;
}

export async function handleThreadStart(
  ctx: ThreadHandlersContext,
  params: { cwd: string; mode?: Mode },
): Promise<{ threadId: string }> {
  const mode = params.mode ?? "default";
  const tempId = generateSessionId();
  const effort = await ctx.getLatestEffortForCwd(params.cwd);
  const runtime = await ctx.createThreadRuntime(tempId, params.cwd, mode, true, effort);
  const threadId = runtime.manager.sessionId;
  runtime.id = threadId;

  ctx.threads.set(threadId, runtime);
  ctx.setActiveThreadId(threadId);
  ctx.knownCwds.add(params.cwd);

  await ctx.emit({ method: DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_STARTED, params: { threadId } });
  return { threadId };
}

export async function handleThreadResume(
  ctx: ThreadHandlersContext,
  params: { threadId?: string; mostRecent?: boolean },
): Promise<{ found: boolean; threadId?: string; context?: unknown[] }> {
  if (params.threadId) {
    const existing = ctx.threads.get(params.threadId);
    if (existing) {
      const context = existing.manager.getContext();
      ctx.setActiveThreadId(params.threadId);
      await ctx.emit({
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_RESUMED,
        params: { threadId: params.threadId, restoredMessages: context.length },
      });
      return { found: true, threadId: params.threadId, context };
    }
  }

  for (const cwd of Array.from(ctx.knownCwds)) {
    const placeholderId = params.threadId ?? generateSessionId();
    const runtime = await ctx.createThreadRuntime(
      placeholderId,
      cwd,
      "default",
      false,
      await ctx.getLatestEffortForCwd(cwd),
    );

    const resumed = await runtime.manager.resume({
      sessionId: params.threadId,
      mostRecent: params.mostRecent,
    });
    if (!resumed) continue;

    const threadId = runtime.manager.sessionId;
    runtime.id = threadId;

    const context = runtime.manager.getContext();
    runtime.effort = runtime.manager.getCurrentEffort() ?? runtime.effort;
    ctx.threads.set(threadId, runtime);
    ctx.setActiveThreadId(threadId);

    await ctx.emit({
      method: DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_RESUMED,
      params: { threadId, restoredMessages: context.length },
    });

    return { found: true, threadId, context };
  }

  return { found: false };
}

export async function handleThreadList(
  ctx: ThreadHandlersContext,
  limit?: number,
  includeChildren?: boolean,
): Promise<{ data: SessionSummary[] }> {
  const result: SessionSummary[] = [];

  for (const cwd of ctx.knownCwds) {
    const paths = await ctx.resolvePaths(cwd);
    const sessions = await listSessions(paths.sessions);
    for (const session of sessions) {
      result.push({
        id: session.id,
        path: session.path,
        cwd: session.cwd,
        name: session.name,
        created: session.created.toISOString(),
        modified: session.modified.toISOString(),
        messageCount: session.messageCount,
        firstUserMessage: session.firstUserMessage,
        parentSession: session.parentSession,
      });
    }
  }

  const filtered = includeChildren ? result : result.filter((s) => !s.parentSession);
  filtered.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
  return { data: filtered.slice(0, limit ?? 100) };
}

export async function handleThreadRead(
  ctx: ThreadHandlersContext,
  threadId?: string,
): Promise<{
  messages: unknown[];
  childSessions?: unknown[];
  hasFollowUp: boolean;
  entryCount: number;
  isRunning: boolean;
  currentEffort: ThinkingEffort;
}> {
  const runtime = await ctx.resolveThreadRuntime(threadId);
  const paths = await ctx.resolvePaths(runtime.cwd);
  const sessionId = runtime.manager.sessionId;
  const children = await readChildSessions(paths.sessions, sessionId);

  return {
    messages: runtime.manager.getContext(),
    childSessions: children.length > 0 ? children : undefined,
    hasFollowUp: runtime.manager.hasPendingMessages(),
    entryCount: runtime.manager.entryCount,
    isRunning: runtime.isRunning,
    currentEffort: runtime.manager.getCurrentEffort() ?? runtime.effort,
  };
}

export async function handleTurnStart(
  ctx: ThreadHandlersContext,
  params: TurnStartParams,
  connectionId: string | undefined,
  turnInitiators: Map<string, string>,
): Promise<{ accepted: true }> {
  const runtime = await ctx.resolveThreadRuntime(params.threadId);
  if (runtime.isRunning) throw new Error("A turn is already running for this thread");

  if (connectionId) turnInitiators.set(runtime.id, connectionId);

  runtime.abortController = new AbortController();
  runtime.isRunning = true;
  const turnId = `turn-${crypto.randomUUID().slice(0, 8)}`;
  runtime.currentTurnId = turnId;

  await ctx.emit({
    method: DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_STATUS_CHANGED,
    params: { threadId: runtime.id, status: "busy" },
  });
  await ctx.emit({
    method: DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_STARTED,
    params: { threadId: runtime.id, turnId },
  });

  const timestamp = Date.now();
  const content =
    params.content && params.content.length > 0
      ? params.content
      : params.attachments && params.attachments.length > 0
        ? [
            ...((params.message.trim().length > 0 ? [{ type: "text", text: params.message }] : []) as Array<{
              type: "text";
              text: string;
            }>),
            ...params.attachments,
          ]
        : params.message;
  const userMessage = { role: "user" as const, content, timestamp };

  const userItemId = `msg-${crypto.randomUUID().slice(0, 8)}`;
  const userItem = { type: "userMessage" as const, itemId: userItemId, message: userMessage };

  await ctx.emit({
    method: DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_STARTED,
    params: { threadId: runtime.id, turnId, item: userItem },
  });
  await ctx.emit({
    method: DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_COMPLETED,
    params: { threadId: runtime.id, turnId, item: userItem },
  });

  const stream = runtime.manager.run(userMessage);
  void ctx.consumeStream(runtime, stream, turnId);
  return { accepted: true };
}

export async function handleTurnInterrupt(
  ctx: ThreadHandlersContext,
  threadId?: string,
): Promise<{ interrupted: boolean }> {
  const runtime = await ctx.resolveThreadRuntime(threadId);
  if (!runtime.isRunning || !runtime.abortController) return { interrupted: false };
  runtime.abortController.abort();
  return { interrupted: true };
}

export async function handleTurnSteer(
  ctx: ThreadHandlersContext,
  threadId: string | undefined,
  content: string,
): Promise<{ queued: true }> {
  const runtime = await ctx.resolveThreadRuntime(threadId);
  runtime.manager.steer(content);
  return { queued: true };
}

export async function handleModeSet(
  ctx: ThreadHandlersContext,
  threadId: string | undefined,
  mode: Mode,
): Promise<{ mode: Mode }> {
  const runtime = await ctx.resolveThreadRuntime(threadId);
  runtime.mode = mode;
  runtime.manager.appendModeChange(mode, "command");
  return { mode };
}

export async function handleEffortSet(
  ctx: ThreadHandlersContext,
  threadId: string | undefined,
  effort: ThinkingEffort,
): Promise<{ effort: ThinkingEffort }> {
  const runtime = await ctx.resolveThreadRuntime(threadId);
  runtime.effort = effort;
  runtime.manager.appendEffortChange(effort, "command");
  return { effort };
}

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

export async function handleThreadDelete(
  ctx: ThreadHandlersContext,
  threadId: string,
): Promise<{ deleted: boolean }> {
  const existing = ctx.threads.get(threadId);
  if (existing?.isRunning) throw new Error("Cannot delete a thread that is currently running");

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
    ctx.threads.delete(threadId);
    if (ctx.activeThreadId === threadId) {
      ctx.setActiveThreadId(null);
    }
  }

  return { deleted };
}

export async function handleToolsList(
  ctx: ThreadHandlersContext,
  threadId: string | undefined,
): Promise<{
  configPath: string;
  appliesOnNextTurn: true;
  trustMode: "full_trust";
  conflictPolicy: ToolConflictPolicy;
  tools: ToolDescriptor[];
  plugins: PluginDescriptor[];
}> {
  const { cwd, tools } = await ctx.resolveToolsContext(threadId);
  const paths = await ctx.resolvePaths(cwd);
  const result = await buildDefaultTools(cwd, paths, undefined, tools);

  return {
    configPath: getProjectConfigPath(cwd),
    appliesOnNextTurn: true,
    trustMode: "full_trust",
    conflictPolicy: (tools?.conflictPolicy ?? "error") as ToolConflictPolicy,
    tools: result.toolState,
    plugins: result.pluginState.map((plugin) => ({ ...plugin, loadError: plugin.loadError })),
  };
}

export async function handleToolsSet(
  ctx: ThreadHandlersContext,
  toolConfig: { getTools: () => DiligentConfig["tools"] | undefined; setTools: (tools: DiligentConfig["tools"] | undefined) => void },
  threadId: string | undefined,
  params: {
    builtin?: Record<string, boolean>;
    plugins?: Array<{ package: string; enabled?: boolean; tools?: Record<string, boolean>; remove?: boolean }>;
    conflictPolicy?: ToolConflictPolicy;
  },
): Promise<{
  configPath: string;
  appliesOnNextTurn: true;
  trustMode: "full_trust";
  conflictPolicy: ToolConflictPolicy;
  tools: ToolDescriptor[];
  plugins: PluginDescriptor[];
}> {
  const { cwd } = await ctx.resolveToolsContext(threadId);
  const writeResult = await writeProjectToolsConfig(cwd, {
    builtin: params.builtin,
    plugins: params.plugins,
    conflictPolicy: params.conflictPolicy,
  });

  toolConfig.setTools(writeResult.config.tools);

  const paths = await ctx.resolvePaths(cwd);
  const result = await buildDefaultTools(cwd, paths, undefined, writeResult.config.tools);

  return {
    configPath: writeResult.configPath,
    appliesOnNextTurn: true,
    trustMode: "full_trust",
    conflictPolicy: (writeResult.config.tools?.conflictPolicy ?? "error") as ToolConflictPolicy,
    tools: result.toolState,
    plugins: result.pluginState.map((plugin) => ({ ...plugin, loadError: plugin.loadError })),
  };
}

export async function getLatestEffortFromSessions(
  resolvePaths: (cwd: string) => Promise<{ sessions: string }>,
  threads: Map<string, ThreadRuntime>,
  cwd: string,
): Promise<ThinkingEffort> {
  const paths = await resolvePaths(cwd);
  const ordered = (await listSessions(paths.sessions))
    .filter((session) => session.cwd === cwd)
    .map<SessionSummary>((session) => ({
      id: session.id,
      path: session.path,
      cwd: session.cwd,
      name: session.name,
      created: session.created.toISOString(),
      modified: session.modified.toISOString(),
      messageCount: session.messageCount,
      firstUserMessage: session.firstUserMessage,
      parentSession: session.parentSession,
    }));

  for (const summary of ordered) {
    const runtime = threads.get(summary.id);
    const runtimeEffort = runtime?.manager.getCurrentEffort() ?? runtime?.effort;
    if (runtimeEffort) return runtimeEffort;
    if (!summary.path) continue;

    try {
      const { entries } = await readSessionFile(summary.path);
      const leafId = entries.length > 0 ? entries[entries.length - 1].id : null;
      const effort = buildSessionContext(entries, leafId).currentEffort;
      if (effort) return effort;
    } catch {
      // Ignore unreadable session files and continue.
    }
  }

  return "medium";
}
