// @summary Protocol event reducer and view-state normalization for Web CLI thread rendering

import type { AgentEvent } from "@diligent/core/client";
import type {
  ApprovalRequest,
  DiligentServerNotification,
  Mode,
  SessionSummary,
  ThreadStatus,
  UserInputRequest,
} from "@diligent/protocol";
import { DILIGENT_SERVER_NOTIFICATION_METHODS } from "@diligent/protocol";
import {
  COLLAB_RENDERED_TOOLS,
  extractUserTextAndImages,
  parsePlanOutput,
  stringifyUnknown,
  updateItem,
  withItem,
  zeroUsage,
} from "./thread-utils";

export { hydrateFromThreadRead } from "./thread-hydration";

export interface PlanState {
  title: string;
  steps: Array<{ text: string; status: "pending" | "in_progress" | "done" }>;
}

export interface ToastState {
  id: string;
  kind: "error" | "info";
  message: string;
  fatal?: boolean;
}

export interface UsageState {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalCost: number;
}

export type RenderItem =
  | {
      id: string;
      kind: "context";
      summary: string;
      timestamp: number;
    }
  | {
      id: string;
      kind: "user";
      text: string;
      images: Array<{ url: string; fileName?: string; mediaType?: string }>;
      timestamp: number;
    }
  | {
      id: string;
      kind: "assistant";
      text: string;
      thinking: string;
      thinkingDone: boolean;
      timestamp: number;
      reasoningDurationMs?: number;
      turnDurationMs?: number;
    }
  | {
      id: string;
      kind: "error";
      message: string;
      name?: string;
      fatal: boolean;
      turnId?: string;
      timestamp: number;
    }
  | {
      id: string;
      kind: "tool";
      toolName: string;
      inputText: string;
      outputText: string;
      isError: boolean;
      status: "streaming" | "done";
      timestamp: number;
      toolCallId: string;
      startedAt: number;
      durationMs?: number;
      /** P040: optional structured render payload for richer presentation */
      render?: import("@diligent/protocol").ToolRenderPayload;
    }
  | {
      id: string;
      kind: "collab";
      eventType: "spawn" | "wait" | "close" | "interaction";
      childThreadId?: string;
      nickname?: string;
      agentType?: string;
      description?: string;
      prompt?: string;
      status?: string;
      message?: string;
      agents?: Array<{ threadId: string; nickname?: string; status?: string; message?: string }>;
      timedOut?: boolean;
      turnNumber?: number;
      childTools: Array<{
        toolCallId: string;
        toolName: string;
        status: "running" | "done";
        isError: boolean;
        inputText: string;
        outputText: string;
      }>;
      childMessages?: string[];
      timestamp: number;
    };

export interface ThreadState {
  activeThreadId: string | null;
  mode: Mode;
  threadStatus: ThreadStatus;
  items: RenderItem[];
  threadList: SessionSummary[];
  seenKeys: Record<string, true>;
  itemSlots: Record<string, string>;
  pendingApproval: { requestId: number; request: ApprovalRequest } | null;
  pendingUserInput: { requestId: number; request: UserInputRequest; answers: Record<string, string | string[]> } | null;
  toast: ToastState | null;
  usage: UsageState;
  currentContextTokens: number; // latest turn's total input tokens including cache (not cumulative)
  planState: PlanState | null;
  pendingSteers: string[];
  activeTurnId: string | null;
  activeTurnStartedAt: number | null;
  activeReasoningStartedAt: number | null;
  activeReasoningDurationMs: number;
}

export const initialThreadState: ThreadState = {
  activeThreadId: null,
  mode: "default",
  threadStatus: "idle",
  items: [],
  threadList: [],
  seenKeys: {},
  itemSlots: {},
  pendingApproval: null,
  pendingUserInput: null,
  toast: null,
  usage: zeroUsage,
  currentContextTokens: 0,
  planState: null,
  pendingSteers: [],
  activeTurnId: null,
  activeTurnStartedAt: null,
  activeReasoningStartedAt: null,
  activeReasoningDurationMs: 0,
};

/** Find the most recent collab spawn RenderItem for a given childThreadId. */
function findCollabSpawnItem(
  state: ThreadState,
  childThreadId: string,
): Extract<RenderItem, { kind: "collab" }> | undefined {
  for (let i = state.items.length - 1; i >= 0; i--) {
    const item = state.items[i];
    if (item.kind === "collab" && item.eventType === "spawn" && item.childThreadId === childThreadId) {
      return item;
    }
  }
  return undefined;
}

/** Update the latest spawn item's status for a child thread. */
function updateCollabSpawnStatus(
  state: ThreadState,
  childThreadId: string,
  status: string,
  message?: string,
): ThreadState {
  const spawnItem = findCollabSpawnItem(state, childThreadId);
  if (!spawnItem) return state;
  return updateItem(state, spawnItem.id, (item) =>
    item.kind === "collab" && item.eventType === "spawn"
      ? {
          ...item,
          status,
          message: message ?? item.message,
        }
      : item,
  );
}

function normalizeSpawnStatusFromWait(status: string, timedOut: boolean): string {
  // wait() timeout can snapshot a just-spawned agent as "pending" due to race timing.
  // For spawn rows, that means "still running" from the user's perspective.
  if (status === "pending") return "running";
  // When wait timed out, any non-final status should remain running in the spawn row.
  if (timedOut && status === "running") return "running";
  return status;
}

let renderSeq = 0;

function reduceAgentEvent(state: ThreadState, event: AgentEvent): ThreadState {
  switch (event.type) {
    case "message_start": {
      const renderId = `item:${event.itemId}:${++renderSeq}`;
      if (state.itemSlots[event.itemId]) return state;
      return {
        ...state,
        itemSlots: { ...state.itemSlots, [event.itemId]: renderId },
        items: [
          ...state.items,
          {
            id: renderId,
            kind: "assistant",
            text: "",
            thinking: "",
            thinkingDone: false,
            timestamp: event.message.timestamp,
            reasoningDurationMs: 0,
          },
        ],
      };
    }

    case "message_delta": {
      const renderId = state.itemSlots[event.itemId];
      if (!renderId) return state;

      if (event.delta.type === "text_delta") {
        const nextState =
          state.activeReasoningStartedAt !== null
            ? {
                ...state,
                activeReasoningDurationMs:
                  state.activeReasoningDurationMs + (Date.now() - state.activeReasoningStartedAt),
                activeReasoningStartedAt: null,
              }
            : state;
        return updateItem(nextState, renderId, (item) =>
          item.kind === "assistant" ? { ...item, text: item.text + event.delta.delta, thinkingDone: true } : item,
        );
      }

      if (event.delta.type === "thinking_delta") {
        const nextState =
          state.activeReasoningStartedAt === null ? { ...state, activeReasoningStartedAt: Date.now() } : state;
        return updateItem(nextState, renderId, (item) =>
          item.kind === "assistant" ? { ...item, thinking: item.thinking + event.delta.delta } : item,
        );
      }

      return state;
    }

    case "message_end": {
      const renderId = state.itemSlots[event.itemId];
      if (!renderId) return state;
      const { [event.itemId]: _, ...remainingSlots } = state.itemSlots;
      const nextState =
        state.activeReasoningStartedAt !== null
          ? {
              ...state,
              activeReasoningDurationMs:
                state.activeReasoningDurationMs + (Date.now() - state.activeReasoningStartedAt),
              activeReasoningStartedAt: null,
            }
          : state;
      return {
        ...updateItem(nextState, renderId, (current) =>
          current.kind === "assistant"
            ? {
                ...current,
                thinkingDone: true,
                timestamp: event.message.timestamp,
                reasoningDurationMs: nextState.activeReasoningDurationMs,
              }
            : current,
        ),
        itemSlots: remainingSlots,
      };
    }

    case "tool_start": {
      // Child agent tool — nest under spawn item
      if (event.childThreadId) {
        const spawnItem = findCollabSpawnItem(state, event.childThreadId);
        if (!spawnItem) {
          console.log(
            "[ThreadStore][collab-debug] child tool_start dropped: spawn item not found",
            event.childThreadId,
            event.toolName,
            event.toolCallId,
          );
          return state;
        }
        return updateItem(state, spawnItem.id, (item) =>
          item.kind === "collab"
            ? {
                ...item,
                childTools: [
                  ...item.childTools,
                  {
                    toolCallId: event.toolCallId,
                    toolName: event.toolName,
                    status: "running" as const,
                    isError: false,
                    inputText: stringifyUnknown(event.input),
                    outputText: "",
                  },
                ],
              }
            : item,
        );
      }
      // Collab tools already rendered by CollabEventBlock — skip duplicate ToolBlock
      if (COLLAB_RENDERED_TOOLS.has(event.toolName)) return state;
      const renderId = `item:${event.itemId}:${++renderSeq}`;
      if (state.itemSlots[event.itemId]) return state;
      const now = Date.now();
      return {
        ...state,
        itemSlots: { ...state.itemSlots, [event.itemId]: renderId },
        items: [
          ...state.items,
          {
            id: renderId,
            kind: "tool",
            toolName: event.toolName,
            inputText: stringifyUnknown(event.input),
            outputText: "",
            isError: false,
            status: "streaming",
            timestamp: now,
            toolCallId: event.toolCallId,
            startedAt: now,
          },
        ],
      };
    }

    case "tool_update": {
      // Child agent tool — stream update into spawn item's childTools
      if (event.childThreadId) {
        const spawnItem = findCollabSpawnItem(state, event.childThreadId);
        if (!spawnItem) {
          console.log(
            "[ThreadStore][collab-debug] child tool_update dropped: spawn item not found",
            event.childThreadId,
            event.toolName,
            event.toolCallId,
          );
          return state;
        }
        return updateItem(state, spawnItem.id, (item) =>
          item.kind === "collab"
            ? {
                ...item,
                childTools: item.childTools.map((t) =>
                  t.toolCallId === event.toolCallId ? { ...t, outputText: t.outputText + event.partialResult } : t,
                ),
              }
            : item,
        );
      }
      const renderId = state.itemSlots[event.itemId];
      if (!renderId) return state;
      return updateItem(state, renderId, (item) =>
        item.kind === "tool" ? { ...item, outputText: item.outputText + event.partialResult } : item,
      );
    }

    case "tool_end": {
      // Child agent tool — update spawn item
      if (event.childThreadId) {
        const spawnItem = findCollabSpawnItem(state, event.childThreadId);
        if (!spawnItem) {
          console.log(
            "[ThreadStore][collab-debug] child tool_end dropped: spawn item not found",
            event.childThreadId,
            event.toolName,
            event.toolCallId,
          );
          return state;
        }
        return updateItem(state, spawnItem.id, (item) =>
          item.kind === "collab"
            ? {
                ...item,
                childTools: item.childTools.map((t) =>
                  t.toolCallId === event.toolCallId
                    ? { ...t, status: "done" as const, isError: event.isError, outputText: event.output ?? "" }
                    : t,
                ),
              }
            : item,
        );
      }
      const slotRenderId = state.itemSlots[event.itemId];
      // Fallback: for in-progress tools hydrated during reconnect, find by toolCallId
      const renderId =
        slotRenderId ?? state.items.find((i) => i.kind === "tool" && i.toolCallId === event.toolCallId)?.id;
      if (!renderId) return state;

      const { [event.itemId]: _, ...remainingSlots } = state.itemSlots;
      let next = {
        ...updateItem(state, renderId, (current) =>
          current.kind === "tool"
            ? {
                ...current,
                outputText: event.output || current.outputText,
                isError: event.isError,
                status: "done" as const,
                durationMs: Date.now() - current.startedAt,
                render: current.render,
              }
            : current,
        ),
        itemSlots: remainingSlots,
      };

      if (event.toolName === "plan" && event.output) {
        const plan = parsePlanOutput(event.output);
        if (plan === "closed") {
          next = { ...next, planState: null };
        } else if (plan) {
          next = { ...next, planState: plan };
        }
      }

      return next;
    }

    case "status_change":
      return { ...state, threadStatus: event.status };

    case "usage":
      return {
        ...state,
        usage: {
          inputTokens: state.usage.inputTokens + event.usage.inputTokens,
          outputTokens: state.usage.outputTokens + event.usage.outputTokens,
          cacheReadTokens: state.usage.cacheReadTokens + event.usage.cacheReadTokens,
          cacheWriteTokens: state.usage.cacheWriteTokens + event.usage.cacheWriteTokens,
          totalCost: state.usage.totalCost + event.cost,
        },
        currentContextTokens: event.usage.inputTokens + event.usage.cacheReadTokens + event.usage.cacheWriteTokens,
      };

    case "error":
      return {
        ...state,
        toast: {
          id: `err-${Date.now()}`,
          kind: "error",
          message: event.error.message,
          fatal: event.fatal,
        },
      };

    case "knowledge_saved":
      return {
        ...state,
        toast: {
          id: `info-${event.knowledgeId}`,
          kind: "info",
          message: "Knowledge updated",
        },
      };

    case "loop_detected":
      return {
        ...state,
        toast: {
          id: `loop-${event.patternLength}`,
          kind: "info",
          message: `Loop detected in ${event.toolName}`,
        },
      };

    case "compaction_start":
      return {
        ...state,
        threadStatus: "busy",
        toast: {
          id: `compaction-start-${Date.now()}`,
          kind: "info",
          message: `Compacting context (${Math.round(event.estimatedTokens / 1000)}k tokens)…`,
        },
      };

    case "compaction_end": {
      const tailInfo = event.tailMessages?.length
        ? ` [${event.tailMessages.map((m: { role: string }) => m.role).join(" → ")}]`
        : "";
      return {
        ...state,
        toast: {
          id: `compaction-end-${Date.now()}`,
          kind: "info",
          message: `Compacted: ${Math.round(event.tokensBefore / 1000)}k → ${Math.round(event.tokensAfter / 1000)}k tokens${tailInfo}`,
        },
      };
    }

    case "steering_injected": {
      const drained = state.pendingSteers.slice(0, event.messageCount);
      const remaining = state.pendingSteers.slice(event.messageCount);
      const newItems: RenderItem[] = drained.map((text, i) => ({
        id: `steer-injected-${Date.now()}-${i}`,
        kind: "user" as const,
        text,
        images: [],
        timestamp: Date.now(),
      }));
      return {
        ...state,
        pendingSteers: remaining,
        items: [...state.items, ...newItems],
      };
    }

    case "collab_spawn_begin": {
      console.log("[ThreadStore][collab-debug] collab_spawn_begin", {
        callId: event.callId,
        promptPreview: event.prompt.slice(0, 80),
      });
      // Create the spawn item eagerly so that child events (tool_start/update/end)
      // arriving before collab_spawn_end can find it via findCollabSpawnItem.
      // In the registry, callId === childThreadId (both are the child session id).
      const renderId = `collab:spawn:${event.callId}`;
      return withItem(state, renderId, {
        id: renderId,
        kind: "collab",
        eventType: "spawn",
        childThreadId: event.callId,
        agentType: event.agentType,
        prompt: event.prompt,
        status: "running",
        childTools: [],
        timestamp: Date.now(),
      });
    }

    case "collab_spawn_end": {
      console.log("[ThreadStore][collab-debug] collab_spawn_end", {
        callId: event.callId,
        childThreadId: event.childThreadId,
        nickname: event.nickname,
        status: event.status,
      });
      const renderId = `collab:spawn:${event.callId}`;
      // If the item was already created by collab_spawn_begin, update it in place.
      const existing = findCollabSpawnItem(state, event.childThreadId);
      if (existing) {
        return updateItem(state, existing.id, (item) =>
          item.kind === "collab" && item.eventType === "spawn"
            ? {
                ...item,
                childThreadId: event.childThreadId,
                nickname: event.nickname,
                agentType: event.agentType ?? item.agentType,
                description: event.description,
                prompt: event.prompt,
                status: event.status,
                message: event.message,
              }
            : item,
        );
      }
      // Fallback: create item if begin was missed (e.g. reconnect)
      return withItem(state, renderId, {
        id: renderId,
        kind: "collab",
        eventType: "spawn",
        childThreadId: event.childThreadId,
        nickname: event.nickname,
        agentType: event.agentType,
        description: event.description,
        prompt: event.prompt,
        status: event.status,
        message: event.message,
        childTools: [],
        timestamp: Date.now(),
      });
    }

    case "collab_wait_begin":
      console.log("[ThreadStore][collab-debug] collab_wait_begin", {
        callId: event.callId,
        agentCount: event.agents.length,
        agents: event.agents.map((a) => a.threadId),
      });
      return state;

    case "collab_wait_end": {
      console.log("[ThreadStore][collab-debug] collab_wait_end", {
        callId: event.callId,
        timedOut: event.timedOut,
        statuses: event.agentStatuses.map((a) => `${a.threadId}:${a.status}`),
      });
      const renderId = `collab:wait:${event.callId}`;
      let next = withItem(state, renderId, {
        id: renderId,
        kind: "collab",
        eventType: "wait",
        agents: event.agentStatuses.map((a) => ({
          threadId: a.threadId,
          nickname: a.nickname,
          status: a.status,
          message: a.message,
        })),
        timedOut: event.timedOut,
        childTools: [],
        timestamp: Date.now(),
      });

      for (const agent of event.agentStatuses) {
        next = updateCollabSpawnStatus(
          next,
          agent.threadId,
          normalizeSpawnStatusFromWait(agent.status, event.timedOut),
          agent.message,
        );
      }
      return next;
    }

    case "collab_close_begin":
      return state;

    case "collab_close_end": {
      const renderId = `collab:close:${event.callId}`;
      let next = withItem(state, renderId, {
        id: renderId,
        kind: "collab",
        eventType: "close",
        childThreadId: event.childThreadId,
        nickname: event.nickname,
        status: event.status,
        message: event.message,
        childTools: [],
        timestamp: Date.now(),
      });

      next = updateCollabSpawnStatus(next, event.childThreadId, event.status, event.message);
      return next;
    }

    case "collab_interaction_begin":
      return state;

    case "collab_interaction_end": {
      const renderId = `collab:interaction:${event.callId}`;
      return withItem(state, renderId, {
        id: renderId,
        kind: "collab",
        eventType: "interaction",
        childThreadId: event.receiverThreadId,
        nickname: event.receiverNickname,
        message: event.prompt,
        status: event.status,
        childTools: [],
        timestamp: Date.now(),
      });
    }

    case "turn_start": {
      // Child agent turn — update spawn item
      if (event.childThreadId) {
        const spawnItem = findCollabSpawnItem(state, event.childThreadId);
        if (spawnItem) {
          return updateItem(state, spawnItem.id, (item) =>
            item.kind === "collab" ? { ...item, turnNumber: event.turnNumber } : item,
          );
        }
      }
      return {
        ...state,
        activeTurnId: event.turnId,
        activeTurnStartedAt: Date.now(),
        activeReasoningStartedAt: null,
        activeReasoningDurationMs: 0,
      };
    }

    default:
      return state;
  }
}

/** Settle all in-flight items after abort/interrupt:
 *  - assistant items with thinkingDone=false → set thinkingDone=true (stop the thinking spinner)
 *  - tool items with status="streaming" → set status="done" (stop the tool spinner)
 */
function settleInFlightItems(state: ThreadState): ThreadState {
  const hasInFlight = state.items.some(
    (i) => (i.kind === "assistant" && !i.thinkingDone) || (i.kind === "tool" && i.status === "streaming"),
  );
  if (!hasInFlight) return state;

  console.log("[ThreadStore] settleInFlightItems: settling in-flight items after interrupt");
  return {
    ...state,
    itemSlots: {},
    items: state.items.map((item) => {
      if (item.kind === "assistant" && !item.thinkingDone) {
        console.log("[ThreadStore] settleInFlightItems: closing thinking item", item.id);
        return { ...item, thinkingDone: true };
      }
      if (item.kind === "tool" && item.status === "streaming") {
        console.log("[ThreadStore] settleInFlightItems: closing streaming tool item", item.id, item.toolName);
        return { ...item, status: "done" as const };
      }
      return item;
    }),
  };
}

export function reduceServerNotification(
  state: ThreadState,
  notification: DiligentServerNotification,
  events: AgentEvent[],
): ThreadState {
  // Ignore notifications that belong to a different thread than the one currently displayed.
  // thread/started and thread/resumed are exempt — they establish the active thread.
  if (
    notification.method !== DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_STARTED &&
    notification.method !== DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_RESUMED &&
    "threadId" in notification.params &&
    state.activeThreadId !== null &&
    notification.params.threadId !== state.activeThreadId
  ) {
    if (notification.method.startsWith("collab/") || notification.method.startsWith("item/")) {
      console.log("[ThreadStore][collab-debug] notification ignored due to active-thread mismatch", {
        method: notification.method,
        activeThreadId: state.activeThreadId,
        incomingThreadId: notification.params.threadId,
      });
    }
    return state;
  }

  const authoritativeStatus =
    "threadStatus" in notification.params && typeof notification.params.threadStatus === "string"
      ? notification.params.threadStatus
      : undefined;
  const stateWithAuthoritativeStatus = authoritativeStatus ? { ...state, threadStatus: authoritativeStatus } : state;

  // Thread-level notifications handled directly
  if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_STARTED) {
    return { ...stateWithAuthoritativeStatus, activeThreadId: notification.params.threadId };
  }
  if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_RESUMED) {
    return { ...stateWithAuthoritativeStatus, activeThreadId: notification.params.threadId };
  }

  // turn/interrupted: settle all in-flight items (thinking spinner, streaming tools)
  if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_INTERRUPTED) {
    console.log("[ThreadStore] turn/interrupted received for thread", notification.params.threadId);
    const now = Date.now();
    const turnDurationMs =
      stateWithAuthoritativeStatus.activeTurnStartedAt !== null
        ? Math.max(0, now - stateWithAuthoritativeStatus.activeTurnStartedAt)
        : undefined;
    const reasoningDurationMs =
      stateWithAuthoritativeStatus.activeReasoningStartedAt !== null
        ? stateWithAuthoritativeStatus.activeReasoningDurationMs +
          (now - stateWithAuthoritativeStatus.activeReasoningStartedAt)
        : stateWithAuthoritativeStatus.activeReasoningDurationMs;
    let next = settleInFlightItems({
      ...stateWithAuthoritativeStatus,
      threadStatus: "idle",
      activeTurnId: null,
      activeTurnStartedAt: null,
      activeReasoningStartedAt: null,
      activeReasoningDurationMs: 0,
    });
    for (let i = next.items.length - 1; i >= 0; i--) {
      const item = next.items[i];
      if (item.kind !== "assistant") continue;
      next = updateItem(next, item.id, (current) =>
        current.kind === "assistant"
          ? {
              ...current,
              ...(turnDurationMs !== undefined ? { turnDurationMs } : {}),
              reasoningDurationMs,
            }
          : current,
      );
      break;
    }
    return next;
  }

  if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED) {
    const { turnId } = notification.params;
    const now = Date.now();
    const turnDurationMs =
      stateWithAuthoritativeStatus.activeTurnStartedAt !== null
        ? Math.max(0, now - stateWithAuthoritativeStatus.activeTurnStartedAt)
        : undefined;
    const reasoningDurationMs =
      stateWithAuthoritativeStatus.activeReasoningStartedAt !== null
        ? stateWithAuthoritativeStatus.activeReasoningDurationMs +
          (now - stateWithAuthoritativeStatus.activeReasoningStartedAt)
        : stateWithAuthoritativeStatus.activeReasoningDurationMs;
    let next: ThreadState = {
      ...stateWithAuthoritativeStatus,
      activeTurnId:
        stateWithAuthoritativeStatus.activeTurnId === turnId ? null : stateWithAuthoritativeStatus.activeTurnId,
      activeTurnStartedAt:
        stateWithAuthoritativeStatus.activeTurnId === turnId ? null : stateWithAuthoritativeStatus.activeTurnStartedAt,
      activeReasoningStartedAt: null,
      activeReasoningDurationMs: 0,
    };

    for (let i = next.items.length - 1; i >= 0; i--) {
      const item = next.items[i];
      if (item.kind !== "assistant") continue;
      next = updateItem(next, item.id, (current) =>
        current.kind === "assistant"
          ? {
              ...current,
              ...(turnDurationMs !== undefined ? { turnDurationMs } : {}),
              reasoningDurationMs,
            }
          : current,
      );
      break;
    }
    return next;
  }

  // Handle userMessage items from other subscribers (not converted to AgentEvent by adapter)
  if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_STARTED) {
    const item = (
      notification.params as {
        item?: { type?: string; itemId?: string; message?: { content?: unknown; timestamp?: number } };
      }
    ).item;
    if (item?.type === "userMessage" && item.message) {
      const { text, images } = extractUserTextAndImages(item.message.content);
      // If the incoming user message matches pending steer chips (auto-submitted after interrupt),
      // drain those chips so they are not shown alongside the conversation item.
      let baseState = stateWithAuthoritativeStatus;
      if (baseState.pendingSteers.length > 0) {
        const joinedSteers = baseState.pendingSteers.join("\n");
        if (text === joinedSteers) {
          baseState = { ...baseState, pendingSteers: [] };
        }
      }
      return withItem(baseState, `remote-user-${item.itemId}`, {
        id: `remote-user-${item.itemId}`,
        kind: "user",
        text,
        images,
        timestamp: item.message.timestamp ?? Date.now(),
      });
    }
  }

  // Delegate all item lifecycle, status, usage, error, knowledge, loop, steering to AgentEvent reducer
  let current = stateWithAuthoritativeStatus;
  for (const event of events) {
    current = reduceAgentEvent(current, event);
  }
  return current;
}
