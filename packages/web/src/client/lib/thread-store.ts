// @summary Protocol event reducer and view-state normalization for Web CLI thread rendering

import type {
  AgentEvent,
  ApprovalRequest,
  AssistantMessage,
  ContentBlock,
  DiligentServerNotification,
  Mode,
  SessionSummary,
  ThreadStatus,
  ToolRenderPayload,
  UserInputRequest,
} from "@diligent/protocol";
import { DILIGENT_SERVER_NOTIFICATION_METHODS } from "@diligent/protocol";
import {
  appendChildAssistantTimelineDelta,
  appendChildAssistantTimelineStart,
  finalizeChildAssistantTimeline,
  findCollabSpawnItem,
  isCollabEvent,
  reduceCollabEvent,
} from "./collab-reducer";
import { extractUserTextAndImages, updateItem, withItem, zeroUsage } from "./thread-utils";
import { isToolEvent, reduceToolEvent } from "./tool-reducer";

export { hydrateFromThreadRead } from "./thread-hydration";

export interface PlanState {
  title: string;
  steps: Array<{ text: string; status: "pending" | "in_progress" | "done" | "cancelled" }>;
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
      contentBlocks: ContentBlock[];
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
      render?: ToolRenderPayload;
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
      childTimeline?: Array<
        | {
            kind: "assistant";
            message: string;
          }
        | {
            kind: "tool";
            toolCallId: string;
            toolName: string;
            status: "running" | "done";
            isError: boolean;
            inputText: string;
            outputText: string;
          }
      >;
      timestamp: number;
    };

export interface ThreadState {
  activeThreadId: string | null;
  activeThreadCwd: string | null;
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
  activeThreadCwd: null,
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

let renderSeq = 0;

function extractAssistantTextFromMessage(message: AssistantMessage): { text: string; thinking: string } {
  type AssistantContentBlock = AssistantMessage["content"][number];
  const text = message.content
    .filter(
      (block: AssistantContentBlock): block is Extract<AssistantContentBlock, { type: "text" }> =>
        block.type === "text",
    )
    .map((block) => block.text)
    .join("");
  const thinking = message.content
    .filter(
      (block: AssistantContentBlock): block is Extract<AssistantContentBlock, { type: "thinking" }> =>
        block.type === "thinking",
    )
    .map((block) => block.thinking)
    .join("");
  return { text, thinking };
}

function reduceAgentEvent(state: ThreadState, event: AgentEvent): ThreadState {
  if (isToolEvent(event)) {
    return reduceToolEvent(state, event);
  }

  if (isCollabEvent(event)) {
    return reduceCollabEvent(state, event);
  }

  switch (event.type) {
    case "message_start": {
      if ("childThreadId" in event && typeof event.childThreadId === "string") {
        return appendChildAssistantTimelineStart(state, event.childThreadId);
      }
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
            contentBlocks: [],
            thinkingDone: false,
            timestamp:
              typeof (event as { timestamp?: number }).timestamp === "number"
                ? (event as { timestamp?: number }).timestamp!
                : event.message.timestamp,
            reasoningDurationMs: 0,
          },
        ],
      };
    }

    case "message_delta": {
      if ("childThreadId" in event && typeof event.childThreadId === "string") {
        if (event.delta.type === "text_delta") {
          return appendChildAssistantTimelineDelta(state, event.childThreadId, event.delta.delta);
        }
        return state;
      }
      const renderId = state.itemSlots[event.itemId];
      if (!renderId) return state;
      const delta = event.delta;

      if (delta.type === "text_delta") {
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
          item.kind === "assistant" ? { ...item, text: item.text + delta.delta, thinkingDone: true } : item,
        );
      }

      if (delta.type === "thinking_delta") {
        const nextState =
          state.activeReasoningStartedAt === null ? { ...state, activeReasoningStartedAt: Date.now() } : state;
        return updateItem(nextState, renderId, (item) =>
          item.kind === "assistant" ? { ...item, thinking: item.thinking + delta.delta } : item,
        );
      }

      if (delta.type === "content_block_delta") {
        return updateItem(state, renderId, (item) =>
          item.kind === "assistant"
            ? {
                ...item,
                contentBlocks: [...item.contentBlocks, delta.block],
              }
            : item,
        );
      }

      return state;
    }

    case "message_end": {
      if ("childThreadId" in event && typeof event.childThreadId === "string") {
        return finalizeChildAssistantTimeline(state, event.childThreadId, event.message);
      }
      const renderId = state.itemSlots[event.itemId];
      if (!renderId) return state;
      const { [event.itemId]: _, ...remainingSlots } = state.itemSlots;
      const { text: finalText, thinking: finalThinking } = extractAssistantTextFromMessage(event.message);
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
                contentBlocks: event.message.content,
                timestamp:
                  typeof (event as { timestamp?: number }).timestamp === "number"
                    ? (event as { timestamp?: number }).timestamp!
                    : event.message.timestamp,
                text: current.text.length > 0 ? current.text : finalText,
                thinking: current.thinking.length > 0 ? current.thinking : finalThinking,
                reasoningDurationMs:
                  typeof (event as { reasoningDurationMs?: number }).reasoningDurationMs === "number"
                    ? (event as { reasoningDurationMs?: number }).reasoningDurationMs!
                    : nextState.activeReasoningDurationMs,
                ...(typeof (event as { turnDurationMs?: number }).turnDurationMs === "number"
                  ? { turnDurationMs: (event as { turnDurationMs?: number }).turnDurationMs }
                  : {}),
              }
            : current,
        ),
        itemSlots: remainingSlots,
      };
    }

    case "user_message": {
      const { text, images } = extractUserTextAndImages(event.message.content);
      let nextState = state;
      if (nextState.pendingSteers.length > 0) {
        const joinedSteers = nextState.pendingSteers.join("\n");
        if (text === joinedSteers) {
          nextState = { ...nextState, pendingSteers: [] };
        }
      }
      return withItem(nextState, `remote-user-${event.itemId}`, {
        id: `remote-user-${event.itemId}`,
        kind: "user",
        text,
        images,
        timestamp: event.message.timestamp,
      });
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

    case "compaction_start":
      return {
        ...state,
        toast: {
          id: `compaction-start-${Date.now()}`,
          kind: "info",
          message: `Compacting context (${Math.round(event.estimatedTokens / 1000)}k tokens)…`,
        },
      };

    case "compaction_end": {
      return {
        ...state,
        toast: {
          id: `compaction-end-${Date.now()}`,
          kind: "info",
          message: `Compacted: ${Math.round(event.tokensBefore / 1000)}k → ${Math.round(event.tokensAfter / 1000)}k tokens`,
        },
      };
    }

    case "steering_injected": {
      const drainedFromQueue = state.pendingSteers.slice(0, event.messageCount);
      const remaining = state.pendingSteers.slice(event.messageCount);
      const fallbackFromEvent = event.messages
        .map((message) => (message.role === "user" && typeof message.content === "string" ? message.content : ""))
        .filter((text) => text.length > 0);
      const drained = drainedFromQueue.length > 0 ? drainedFromQueue : fallbackFromEvent.slice(0, event.messageCount);
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

  return {
    ...state,
    itemSlots: {},
    items: state.items.map((item) => {
      if (item.kind === "assistant" && !item.thinkingDone) {
        return { ...item, thinkingDone: true };
      }
      if (item.kind === "tool" && item.status === "streaming") {
        return { ...item, status: "done" as const };
      }
      return item;
    }),
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function toThreadStatus(value: unknown): ThreadStatus | undefined {
  return value === "idle" || value === "busy" ? value : undefined;
}

function shouldIgnoreNotificationForActiveThread(
  state: ThreadState,
  notification: DiligentServerNotification,
  params: Record<string, unknown> | null,
): boolean {
  if (
    notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_STARTED ||
    notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_RESUMED
  ) {
    return false;
  }
  if (!params || typeof params.threadId !== "string") return false;
  if (state.activeThreadId === null) return false;
  return params.threadId !== state.activeThreadId;
}

function applyAuthoritativeThreadStatus(state: ThreadState, params: Record<string, unknown> | null): ThreadState {
  const authoritativeStatus = toThreadStatus(params?.threadStatus);
  return authoritativeStatus ? { ...state, threadStatus: authoritativeStatus } : state;
}

function applyThreadIdentityNotification(
  state: ThreadState,
  notification: DiligentServerNotification,
  params: Record<string, unknown> | null,
): ThreadState | null {
  if (notification.method !== DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_STARTED) {
    if (notification.method !== DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_RESUMED) {
      return null;
    }
  }
  return typeof params?.threadId === "string" ? { ...state, activeThreadId: params.threadId } : state;
}

function getTurnTimingMetrics(state: ThreadState): { turnDurationMs?: number; reasoningDurationMs: number } {
  const now = Date.now();
  const turnDurationMs = state.activeTurnStartedAt !== null ? Math.max(0, now - state.activeTurnStartedAt) : undefined;
  const reasoningDurationMs =
    state.activeReasoningStartedAt !== null
      ? state.activeReasoningDurationMs + (now - state.activeReasoningStartedAt)
      : state.activeReasoningDurationMs;
  return { turnDurationMs, reasoningDurationMs };
}

function applyLatestAssistantDurations(
  state: ThreadState,
  turnDurationMs: number | undefined,
  reasoningDurationMs: number,
): ThreadState {
  let next = state;
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

function handleTurnInterruptedNotification(state: ThreadState): ThreadState {
  const { turnDurationMs, reasoningDurationMs } = getTurnTimingMetrics(state);
  const settled = settleInFlightItems({
    ...state,
    threadStatus: "idle",
    itemSlots: {},
    activeTurnId: null,
    activeTurnStartedAt: null,
    activeReasoningStartedAt: null,
    activeReasoningDurationMs: 0,
  });
  return applyLatestAssistantDurations(settled, turnDurationMs, reasoningDurationMs);
}

function handleTurnCompletedNotification(state: ThreadState, turnId: string): ThreadState {
  const { turnDurationMs, reasoningDurationMs } = getTurnTimingMetrics(state);
  const settled = settleInFlightItems({
    ...state,
    itemSlots: {},
    activeTurnId: state.activeTurnId === turnId ? null : state.activeTurnId,
    activeTurnStartedAt: state.activeTurnId === turnId ? null : state.activeTurnStartedAt,
    activeReasoningStartedAt: null,
    activeReasoningDurationMs: 0,
  });
  return applyLatestAssistantDurations(settled, turnDurationMs, reasoningDurationMs);
}

export function reduceServerNotification(
  state: ThreadState,
  notification: DiligentServerNotification,
  events: AgentEvent[],
): ThreadState {
  const params = asObject(notification.params);
  if (shouldIgnoreNotificationForActiveThread(state, notification, params)) {
    return state;
  }

  const stateWithAuthoritativeStatus = applyAuthoritativeThreadStatus(state, params);
  const identityState = applyThreadIdentityNotification(stateWithAuthoritativeStatus, notification, params);
  if (identityState) {
    return identityState;
  }

  if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_INTERRUPTED) {
    return handleTurnInterruptedNotification(stateWithAuthoritativeStatus);
  }

  if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED) {
    const { turnId } = notification.params;
    return handleTurnCompletedNotification(stateWithAuthoritativeStatus, turnId);
  }

  // Delegate all item lifecycle, status, usage, error, knowledge, loop, steering to AgentEvent reducer
  let current = stateWithAuthoritativeStatus;
  for (const event of events) {
    current = reduceAgentEvent(current, event);
  }
  return current;
}
