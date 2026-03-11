// @summary App-server thread/turn/tool request handlers extracted from server.ts

import {
  DILIGENT_SERVER_NOTIFICATION_METHODS,
  type DiligentServerNotification,
  type KnowledgeEntry,
  type KnowledgeType,
  type Mode,
  type PluginDescriptor,
  type SessionSummary,
  type ThinkingEffort,
  type ToolConflictPolicy,
  type ToolDescriptor,
  type TurnStartParams,
} from "@diligent/protocol";
import { calculateCost } from "../agent/loop";
import type { AgentRegistry } from "../collab/registry";
import type { DiligentConfig } from "../config/schema";
import { getGlobalConfigPath, writeGlobalToolsConfig } from "../config/writer";
import type { DiligentPaths } from "../infrastructure";
import { readKnowledge, writeKnowledge } from "../knowledge/store";
import { resolveModel } from "../provider/models";
import { supportsThinkingNone } from "../provider/thinking-effort";
import { buildSessionContext } from "../session/context-builder";
import type { SessionManager } from "../session/manager";
import { deleteSession, listSessions, readChildSessions, readSessionFile } from "../session/persistence";
import { generateEntryId, generateSessionId } from "../session/types";
import { buildDefaultTools } from "../tools/defaults";

export interface ThreadRuntime {
  id: string;
  cwd: string;
  mode: Mode;
  effort: ThinkingEffort;
  modelId?: string;
  runningEffortSnapshot?: ThinkingEffort;
  runningModelIdSnapshot?: string;
  manager: SessionManager;
  abortController: AbortController | null;
  currentTurnId: string | null;
  isRunning: boolean;
  registry?: AgentRegistry;
}

const BUILTIN_COMMAND_NAMES = new Set([
  "help",
  "model",
  "provider",
  "tools",
  "new",
  "resume",
  "delete",
  "status",
  "compact",
  "clear",
  "exit",
  "version",
  "config",
  "cost",
  "bug",
  "reload",
  "skills",
]);

function parseSlashSkillInvocation(
  message: string,
  skillNames: Set<string>,
): { skillName: string; args: string } | null {
  const trimmed = message.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;

  const withoutSlash = trimmed.slice(1);
  if (!withoutSlash) return null;

  const spaceIdx = withoutSlash.indexOf(" ");
  const commandName = (spaceIdx === -1 ? withoutSlash : withoutSlash.slice(0, spaceIdx)).trim();
  if (!commandName || BUILTIN_COMMAND_NAMES.has(commandName) || !skillNames.has(commandName)) return null;

  const args = spaceIdx === -1 ? "" : withoutSlash.slice(spaceIdx + 1).trim();
  return { skillName: commandName, args };
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
    modelId?: string,
  ) => Promise<ThreadRuntime>;
  resolveThreadRuntime: (threadId?: string) => Promise<ThreadRuntime>;
  getLatestEffortForCwd: (cwd: string) => Promise<ThinkingEffort>;
  emit: (notification: DiligentServerNotification) => Promise<void>;
  consumeStream: (runtime: ThreadRuntime, stream: ReturnType<SessionManager["run"]>, turnId: string) => Promise<void>;
  resolveToolsContext: (threadId?: string) => Promise<{ cwd: string; tools: DiligentConfig["tools"] | undefined }>;
  getSkillNames: () => string[];
  setActiveThreadId: (threadId: string | null) => void;
}

export async function handleThreadStart(
  ctx: ThreadHandlersContext,
  params: { cwd: string; mode?: Mode; model?: string },
): Promise<{ threadId: string }> {
  const mode = params.mode ?? "default";
  const tempId = generateSessionId();
  const effort = await ctx.getLatestEffortForCwd(params.cwd);
  const runtime = await ctx.createThreadRuntime(tempId, params.cwd, mode, true, effort, params.model);
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
      console.log("[AppServer][thread-status] thread/resume existing runtime", {
        requestedThreadId: params.threadId,
        runtimeThreadId: existing.id,
        sessionId: existing.manager.sessionId,
        isRunning: existing.isRunning,
        currentTurnId: existing.currentTurnId,
        entryCount: existing.manager.entryCount,
      });
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
    runtime.modelId = runtime.manager.getCurrentModel()?.modelId ?? runtime.modelId;
    ctx.threads.set(threadId, runtime);
    console.log("[AppServer][thread-status] thread/resume hydrated runtime from disk", {
      requestedThreadId: params.threadId,
      resumedThreadId: threadId,
      sessionId: runtime.manager.sessionId,
      isRunning: runtime.isRunning,
      currentTurnId: runtime.currentTurnId,
      entryCount: runtime.manager.entryCount,
      cwd,
    });
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
  errors: unknown[];
  childSessions?: unknown[];
  hasFollowUp: boolean;
  entryCount: number;
  isRunning: boolean;
  currentEffort: ThinkingEffort;
  currentModel?: string;
  totalCost?: number;
}> {
  const runtime = await ctx.resolveThreadRuntime(threadId);
  console.log("[AppServer][thread-status] thread/read begin", {
    requestedThreadId: threadId,
    runtimeThreadId: runtime.id,
    sessionId: runtime.manager.sessionId,
    isRunning: runtime.isRunning,
    currentTurnId: runtime.currentTurnId,
    entryCount: runtime.manager.entryCount,
  });
  // If runtime memory drifts from persisted JSONL, refresh from disk for read consistency.
  // Do this only when idle to avoid mutating active turn state mid-stream.
  if (!runtime.isRunning) {
    await runtime.manager.reconcileFromDisk();
  }
  const paths = await ctx.resolvePaths(runtime.cwd);
  const sessionId = runtime.manager.sessionId;
  const children = await readChildSessions(paths.sessions, sessionId);

  const messages = runtime.manager.getContext();

  let totalCost = 0;
  for (const msg of messages) {
    const m = msg as {
      role?: string;
      model?: string;
      usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
    };
    if (m.role === "assistant" && m.usage && m.model) {
      totalCost += calculateCost(resolveModel(m.model), m.usage);
    }
  }

  return {
    messages,
    errors: runtime.manager.getErrors(),
    childSessions: children.length > 0 ? children : undefined,
    hasFollowUp: runtime.manager.hasPendingMessages(),
    entryCount: runtime.manager.entryCount,
    isRunning: runtime.isRunning,
    currentEffort: runtime.manager.getCurrentEffort() ?? runtime.effort,
    currentModel: runtime.manager.getCurrentModel()?.modelId ?? runtime.modelId,
    totalCost,
  };
}

export async function handleThreadCompactStart(
  ctx: ThreadHandlersContext,
  threadId?: string,
): Promise<{ compacted: boolean; entryCount: number; tokensBefore: number; tokensAfter: number }> {
  const runtime = await ctx.resolveThreadRuntime(threadId);
  if (runtime.isRunning) throw new Error("Cannot compact while a turn is running");

  runtime.isRunning = true;
  await ctx.emit({
    method: DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_STATUS_CHANGED,
    params: { threadId: runtime.id, status: "busy" },
  });

  try {
    const result = await runtime.manager.compactNow();
    await ctx.emit({
      method: DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_COMPACTED,
      params: {
        threadId: runtime.id,
        entryCount: result.entryCount,
        tokensBefore: result.tokensBefore,
        tokensAfter: result.tokensAfter,
      },
    });
    return result;
  } finally {
    runtime.isRunning = false;
    await ctx.emit({
      method: DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_STATUS_CHANGED,
      params: { threadId: runtime.id, status: "idle" },
    });
  }
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
  runtime.runningEffortSnapshot = runtime.effort;
  runtime.runningModelIdSnapshot = params.model ?? runtime.modelId;
  const turnId = `turn-${crypto.randomUUID().slice(0, 8)}`;
  runtime.currentTurnId = turnId;
  console.log(
    `[UserTurn] thread=${runtime.id} turn=${turnId} model=${params.model ?? runtime.modelId} effort=${runtime.effort} mode=${runtime.mode} msg="${(params.message ?? "").slice(0, 200)}"`,
  );
  console.log("[AppServer][thread-status] turn/start set running", {
    threadId: runtime.id,
    sessionId: runtime.manager.sessionId,
    isRunning: runtime.isRunning,
    currentTurnId: runtime.currentTurnId,
    entryCount: runtime.manager.entryCount,
  });

  await ctx.emit({
    method: DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_STATUS_CHANGED,
    params: { threadId: runtime.id, status: "busy" },
  });
  await ctx.emit({
    method: DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_STARTED,
    params: { threadId: runtime.id, turnId },
  });

  const timestamp = Date.now();
  const slashSkill = parseSlashSkillInvocation(params.message, new Set(ctx.getSkillNames()));
  const messageForTurn = slashSkill
    ? [
        `The user invoked /${slashSkill.skillName}.`,
        `Before any other action, call the "skill" tool with {"name":"${slashSkill.skillName}"}.`,
        slashSkill.args
          ? `After loading the skill, continue with this additional user instruction:\n${slashSkill.args}`
          : "After loading the skill, continue with the user's request.",
      ].join("\n\n")
    : params.message;

  const content =
    params.content && params.content.length > 0
      ? params.content
      : params.attachments && params.attachments.length > 0
        ? [
            ...((messageForTurn.trim().length > 0 ? [{ type: "text", text: messageForTurn }] : []) as Array<{
              type: "text";
              text: string;
            }>),
            ...params.attachments,
          ]
        : messageForTurn;
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
  const modelId = runtime.manager.getCurrentModel()?.modelId ?? runtime.modelId;
  const model = modelId ? resolveModel(modelId) : undefined;
  if (effort === "none" && model && !supportsThinkingNone(model)) {
    throw Object.assign(new Error("Minimal thinking is not supported for this model."), { code: -32602 });
  }
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

export async function handleThreadDelete(ctx: ThreadHandlersContext, threadId: string): Promise<{ deleted: boolean }> {
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
  const result = await buildDefaultTools(cwd, paths, undefined, tools, []);

  return {
    configPath: getGlobalConfigPath(),
    appliesOnNextTurn: true,
    trustMode: "full_trust",
    conflictPolicy: (tools?.conflictPolicy ?? "error") as ToolConflictPolicy,
    tools: result.toolState,
    plugins: result.pluginState.map((plugin) => ({ ...plugin, loadError: plugin.loadError })),
  };
}

export async function handleToolsSet(
  ctx: ThreadHandlersContext,
  toolConfig: {
    getTools: () => DiligentConfig["tools"] | undefined;
    setTools: (tools: DiligentConfig["tools"] | undefined) => void;
  },
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
  const writeResult = await writeGlobalToolsConfig({
    builtin: params.builtin,
    plugins: params.plugins,
    conflictPolicy: params.conflictPolicy,
  });

  toolConfig.setTools(writeResult.config.tools);

  const paths = await ctx.resolvePaths(cwd);
  const result = await buildDefaultTools(cwd, paths, undefined, writeResult.config.tools, []);

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
  fallback: ThinkingEffort = "medium",
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

  return fallback;
}
