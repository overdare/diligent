// @summary Turn lifecycle request handlers: turn start, interrupt, and steer

import { toSerializableError } from "@diligent/core/agent";
import { resolveModel, sameModelRef } from "@diligent/core/model-registry";
import type { GoalController, GoalWorkScope } from "../goals/controller";
import { runCombinedHooks } from "../hooks/runner";
import { resolvePersistedLocalImagePath, toPersistedLocalImagePath } from "../infrastructure/local-image-loader";
import {
  DILIGENT_SERVER_NOTIFICATION_METHODS,
  type SupportedImageMediaType,
  type TurnStartParams,
  type UserMessage,
} from "../protocol/index";
import type { SessionRunOutcome } from "../session/types";
import { generateEntryId } from "../session/types";
import { resetTurnRuntimeState, type ThreadHandlersContext, type ThreadRuntime } from "./thread-handlers";

const BUILTIN_COMMAND_NAMES = new Set([
  "goal",
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

interface GoalTurnOptions {
  goal: GoalController;
  isCurrent?: () => boolean;
}

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

function normalizeLocalImageAttachment(
  attachment: { type: "local_image"; path: string; mediaType: SupportedImageMediaType; fileName?: string },
  cwd: string,
): { type: "local_image"; path: string; mediaType: SupportedImageMediaType; fileName?: string } {
  const absolutePath = resolvePersistedLocalImagePath(attachment.path, cwd);
  return {
    ...attachment,
    path: toPersistedLocalImagePath(absolutePath, cwd),
  };
}

/**
 * Reserve the active turn and its abort controller. Session and model changes happen only
 * after the preceding execution has settled in handleTurnStart.
 */
async function initializeTurnRuntime(
  ctx: ThreadHandlersContext,
  params: TurnStartParams,
  connectionId: string | undefined,
  turnInitiators: Map<string, string>,
  internal?: GoalTurnOptions,
): Promise<{ runtime: ThreadRuntime; turnId: string } | null> {
  const runtime = await ctx.resolveThreadRuntime(params.threadId);
  if (!internal) runtime.pendingUserStarts = (runtime.pendingUserStarts ?? 0) + 1;
  try {
    await ctx.ensureGoal?.(runtime);
    if (internal) {
      if (internal.isCurrent && !internal.isCurrent()) return null;
      if (runtime.pendingUserStarts || runtime.isRunning || internal.goal.read().goal?.status !== "active") return null;
    } else {
      const previousTurn = runtime.currentTurnId;
      const goalOwned = !!runtime.goalScope || runtime.goal?.read().goal?.status === "active";
      await runtime.goal?.pause("user_turn");
      if (goalOwned && runtime.isRunning && runtime.currentTurnId === previousTurn)
        await handleTurnInterrupt(ctx, runtime.id);
      if (runtime.isRunning) throw new Error("A turn is already running for this thread");
    }
    // Reservation is synchronous. User admission has priority over automatic admission,
    // and actual execution still waits for the previous turnWork cleanup below.
    if (connectionId) turnInitiators.set(runtime.id, connectionId);
    runtime.abortController = new AbortController();
    runtime.isRunning = true;
    const turnId = `turn-${crypto.randomUUID().slice(0, 8)}`;
    runtime.currentTurnId = turnId;
    return { runtime, turnId };
  } finally {
    if (!internal) runtime.pendingUserStarts = (runtime.pendingUserStarts ?? 1) - 1;
  }
}

/**
 * Resolve the slash-skill invocation (if any), normalize attachments, and assemble the
 * user message object that will be passed to the session manager.
 */
function prepareTurnMessage(
  ctx: ThreadHandlersContext,
  params: TurnStartParams,
  runtime: ThreadRuntime,
): { userMessage: UserMessage; content: UserMessage["content"] } {
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

  const normalizedAttachments = params.attachments?.map((attachment) =>
    normalizeLocalImageAttachment(attachment, runtime.cwd),
  );

  const content =
    params.content && params.content.length > 0
      ? params.content
      : normalizedAttachments && normalizedAttachments.length > 0
        ? [
            ...((messageForTurn.trim().length > 0 ? [{ type: "text", text: messageForTurn }] : []) as Array<{
              type: "text";
              text: string;
            }>),
            ...normalizedAttachments,
          ]
        : messageForTurn;

  return {
    userMessage: { role: "user" as const, content: content as UserMessage["content"], timestamp },
    content: content as UserMessage["content"],
  };
}

type HookOutcome = { blocked: true } | { blocked: false; userMessage: UserMessage };

/**
 * Collect and run UserPromptSubmit hooks (shell + plugin). If a hook blocks the prompt,
 * emit error/turn-end notifications and return blocked. If a hook supplies additional
 * context, prepend it to the user message and return the augmented message.
 */
async function applyUserPromptHooks(
  ctx: ThreadHandlersContext,
  params: TurnStartParams,
  runtime: ThreadRuntime,
  content: UserMessage["content"],
  userMessage: UserMessage,
  turnId: string,
): Promise<HookOutcome> {
  const shellHandlers = ctx.hooks?.UserPromptSubmit ?? [];
  const { onUserPromptSubmit: pluginHandlers } = await ctx.getPluginHooks(runtime.cwd);
  if (runtime.currentTurnId !== turnId) return { blocked: true };

  if (shellHandlers.length === 0 && pluginHandlers.length === 0) {
    return { blocked: false, userMessage };
  }

  const hookInput = {
    session_id: runtime.manager.sessionId,
    transcript_path: runtime.manager.sessionPath ?? "",
    cwd: runtime.cwd,
    hook_event_name: "UserPromptSubmit",
    permission_mode: runtime.mode,
    user_id: runtime.currentTurnUserId,
    prompt: typeof content === "string" ? content : params.message,
  };

  const hookResult = await runCombinedHooks(shellHandlers, pluginHandlers, hookInput, runtime.cwd);
  if (runtime.currentTurnId !== turnId) return { blocked: true };

  if (hookResult.blocked) {
    runtime.turnWork = undefined;
    resetTurnRuntimeState(runtime);
    await ctx.emit({
      method: DILIGENT_SERVER_NOTIFICATION_METHODS.ERROR,
      params: {
        threadId: runtime.id,
        error: { message: hookResult.reason ?? "Prompt blocked by hook", name: "HookBlocked" },
        fatal: false,
      },
    });
    if (runtime.currentTurnId !== null) return { blocked: true };
    await ctx.emit({
      method: DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED,
      params: { threadId: runtime.id, turnId },
    });
    if (runtime.currentTurnId === null)
      await ctx.emit({
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_STATUS_CHANGED,
        params: { threadId: runtime.id, status: "idle" },
      });
    return { blocked: true };
  }

  if (hookResult.additionalContext) {
    const originalText = typeof content === "string" ? content : params.message;
    const augmentedContent = `${hookResult.additionalContext}\n\n${originalText}`;
    return { blocked: false, userMessage: { ...userMessage, content: augmentedContent as UserMessage["content"] } };
  }

  return { blocked: false, userMessage };
}

export async function handleTurnStart(
  ctx: ThreadHandlersContext,
  params: TurnStartParams,
  connectionId: string | undefined,
  turnInitiators: Map<string, string>,
  internal?: GoalTurnOptions,
): Promise<{ accepted: true; userMessageId?: string }> {
  const reserved = await initializeTurnRuntime(ctx, params, connectionId, turnInitiators, internal);
  if (!reserved) return { accepted: true };
  const { runtime, turnId } = reserved;
  const controller = runtime.abortController!;
  const previousWork = runtime.turnWork ?? Promise.resolve();
  let resolveWork!: () => void;
  const work = new Promise<void>((resolve) => {
    resolveWork = resolve;
  });
  runtime.turnWork = work;
  const finishWork = () => {
    // A cancelled queued start must not let its successor overtake the old execution.
    void previousWork.then(() => {
      if (runtime.turnWork === work) {
        runtime.turnWork = undefined;
        if (runtime.currentTurnId === null) resetTurnRuntimeState(runtime);
      }
      resolveWork();
    });
  };
  const isCurrent = () => runtime.currentTurnId === turnId && !controller.signal.aborted;
  let consuming = false;
  let scope: GoalWorkScope | undefined;
  let unsubscribeUsage = () => {};
  let unlinkAbort = () => {};
  let usedTools = false;
  let outcome: SessionRunOutcome = { status: "interrupted" };
  try {
    await ctx.emit({
      method: DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_STATUS_CHANGED,
      params: { threadId: runtime.id, status: "busy" },
    });
    if (!isCurrent()) return { accepted: true };
    await ctx.emit({
      method: DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_STARTED,
      params: { threadId: runtime.id, turnId },
    });
    await previousWork;
    if (!isCurrent()) return { accepted: true };

    runtime.runningEffortSnapshot = runtime.effort;
    runtime.runningModelSnapshot = params.model ?? runtime.model;
    runtime.currentTurnUserId = ctx.getUserId(connectionId);

    const effectiveModel = runtime.runningModelSnapshot;
    const lastRecordedModel = runtime.manager.getCurrentModel();
    if (!sameModelRef(effectiveModel, lastRecordedModel)) {
      if (runtime.goal?.hasChildren) throw new Error("Wait for goal-owned work cleanup before changing model");
      const model = resolveModel(effectiveModel);
      runtime.manager.appendModelChange(model.provider, model.modelId);
      runtime.model = effectiveModel;
      runtime.agent = undefined; // force rebuild so per-turn model overrides update the provider stream
    }

    if (internal) {
      scope = (await internal.goal.beginRun()) ?? undefined;
      if (!scope || !isCurrent()) return { accepted: true };
      runtime.goalScope = scope;
      const abort = () => controller.abort();
      scope.signal.addEventListener("abort", abort, { once: true });
      unlinkAbort = () => scope?.signal.removeEventListener("abort", abort);
      if (scope.signal.aborted) controller.abort();
      let coreTurnId = "";
      unsubscribeUsage = runtime.manager.subscribe((event) => {
        if (event.type === "turn_start") coreTurnId = event.turnId;
        if (event.type === "tool_start") usedTools = true;
        if (event.type === "usage") scope!.recordUsage({ sessionId: runtime.id, coreTurnId, ...event.usage });
      });
    }
    const { userMessage, content } = internal
      ? {
          userMessage: { role: "user" as const, content: params.message, timestamp: Date.now() },
          content: params.message,
        }
      : prepareTurnMessage(ctx, params, runtime);
    const hookOutcome = internal
      ? { blocked: false as const, userMessage }
      : await applyUserPromptHooks(ctx, params, runtime, content, userMessage, turnId);
    if (hookOutcome.blocked || !isCurrent()) return { accepted: true };

    const finalUserMessage = hookOutcome.userMessage;
    const userItemId = generateEntryId();
    if (!internal)
      await ctx.emit({
        method: DILIGENT_SERVER_NOTIFICATION_METHODS.AGENT_EVENT,
        params: {
          threadId: runtime.id,
          turnId,
          event: { type: "user_message", itemId: userItemId, message: finalUserMessage },
          threadStatus: "busy",
        },
      });
    if (!isCurrent()) return { accepted: true, userMessageId: userItemId };
    const runPromise = internal
      ? runtime.manager
          .runWithOutcome(finalUserMessage, {
            signal: controller.signal,
            userMessageId: userItemId,
            internal: { source: "goal" },
          })
          .then((result) => {
            outcome = result;
            if (result.status === "interrupted") {
              controller.abort();
              throw new DOMException("Goal run interrupted", "AbortError");
            }
          })
      : runtime.manager.run(finalUserMessage, { signal: controller.signal, userMessageId: userItemId });
    consuming = true;
    void ctx
      .consumeTurn(
        runtime,
        runPromise.catch((error: unknown) => {
          outcome = controller.signal.aborted
            ? { status: "interrupted" }
            : { status: "failed", error: toSerializableError(error) };
          throw error;
        }),
        turnId,
      )
      .then(async (cleanupOutcome) => {
        if (scope) await internal!.goal.settle(scope, cleanupOutcome ?? outcome, usedTools);
      })
      .catch(async (error: unknown) => {
        await internal?.goal.pause("runtime_error").catch(() => {});
        await ctx.emit({
          method: DILIGENT_SERVER_NOTIFICATION_METHODS.ERROR,
          params: { threadId: runtime.id, error: toSerializableError(error), fatal: false },
        });
      })
      .finally(() => {
        unsubscribeUsage();
        unlinkAbort();
        if (runtime.goalScope === scope) runtime.goalScope = undefined;
        finishWork();
      });
    return { accepted: true, userMessageId: internal ? undefined : userItemId };
  } catch (error) {
    if (isCurrent()) await ctx.consumeTurn(runtime, Promise.reject(error), turnId);
    throw error;
  } finally {
    if (!consuming) {
      unsubscribeUsage();
      unlinkAbort();
      if (runtime.goalScope === scope) runtime.goalScope = undefined;
      if (internal && runtime.currentTurnId === turnId) {
        await ctx.consumeTurn(
          runtime,
          Promise.reject(new DOMException("Goal admission cancelled", "AbortError")),
          turnId,
        );
      }
      finishWork();
    }
  }
}

export async function handleTurnInterrupt(
  ctx: ThreadHandlersContext,
  threadId?: string,
): Promise<{ interrupted: boolean }> {
  const runtime = await ctx.resolveThreadRuntime(threadId);
  const wasGoalActive = runtime.goal?.read().goal?.status === "active";
  const controller = runtime.abortController;
  const turnId = runtime.currentTurnId;
  await runtime.goal?.pause("user");
  if (!controller || !turnId || runtime.abortController !== controller || runtime.currentTurnId !== turnId)
    return { interrupted: wasGoalActive || !!controller };
  // Retire first: synchronous abort callbacks and later cleanup cannot revive this turn.
  runtime.currentTurnId = null;
  runtime.abortController = null;
  runtime.isRunning = false;
  controller.abort();
  await ctx.emit({
    method: DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_INTERRUPTED,
    params: { threadId: runtime.id, turnId },
  });
  if (runtime.currentTurnId === null) {
    await ctx.emit({
      method: DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_STATUS_CHANGED,
      params: { threadId: runtime.id, status: "idle" },
    });
  }
  return { interrupted: true };
}

export async function handleTurnSteer(
  ctx: ThreadHandlersContext,
  threadId: string | undefined,
  content: string,
  attachments?: Array<{ type: "local_image"; path: string; mediaType: SupportedImageMediaType; fileName?: string }>,
  steerId?: string,
): Promise<{ queued: true; steerId: string }> {
  const runtime = await ctx.resolveThreadRuntime(threadId);
  const normalizedAttachments = attachments?.map((attachment) =>
    normalizeLocalImageAttachment(attachment, runtime.cwd),
  );
  const message =
    normalizedAttachments && normalizedAttachments.length > 0
      ? {
          role: "user" as const,
          content: [
            ...(content.trim().length > 0 ? ([{ type: "text", text: content }] as const) : []),
            ...normalizedAttachments,
          ],
          timestamp: Date.now(),
        }
      : {
          role: "user" as const,
          content,
          timestamp: Date.now(),
        };
  const queuedSteerId = runtime.manager.steer(message, steerId);
  return { queued: true, steerId: queuedSteerId };
}

export async function handleTurnSteerCancel(
  ctx: ThreadHandlersContext,
  threadId: string | undefined,
  steerId: string,
): Promise<{ cancelled: boolean }> {
  const runtime = await ctx.resolveThreadRuntime(threadId);
  const cancelled = runtime.manager.cancelPendingMessage(steerId);
  return { cancelled };
}

export async function handleTurnSteerUpdate(
  ctx: ThreadHandlersContext,
  threadId: string | undefined,
  steerId: string,
  content: string,
): Promise<{ updated: boolean }> {
  const runtime = await ctx.resolveThreadRuntime(threadId);
  const updated = runtime.manager.updatePendingMessage(steerId, content);
  return { updated };
}
