// @summary Protocol event reducer and view-state normalization for Web CLI thread rendering

import type { AgentEvent } from "@diligent/core/client";
import { isSummaryMessage, SUMMARY_PREFIX } from "@diligent/core/client";
import type {
  ApprovalRequest,
  DiligentServerNotification,
  Mode,
  SessionSummary,
  ThreadReadResponse,
  ThreadStatus,
  UserInputRequest,
} from "@diligent/protocol";
import { DILIGENT_SERVER_NOTIFICATION_METHODS } from "@diligent/protocol";

/** Tools that produce collab RenderItems — suppress duplicate ToolBlock rendering. */
const COLLAB_RENDERED_TOOLS = new Set(["spawn_agent", "wait", "close_agent"]);

export interface PlanState {
  title: string;
  steps: Array<{ text: string; done: boolean }>;
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
      timestamp: number;
    }
  | {
      id: string;
      kind: "assistant";
      text: string;
      thinking: string;
      thinkingDone: boolean;
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
    }
  | {
      id: string;
      kind: "collab";
      eventType: "spawn" | "wait" | "close";
      agentId?: string;
      nickname?: string;
      description?: string;
      status?: string;
      message?: string;
      agents?: Array<{ agentId: string; nickname?: string; status?: string; message?: string }>;
      timedOut?: boolean;
      turnNumber?: number;
      childTools: Array<{ toolCallId: string; toolName: string; status: "running" | "done"; isError: boolean }>;
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
  pendingUserInput: { requestId: number; request: UserInputRequest; answers: Record<string, string> } | null;
  toast: ToastState | null;
  usage: UsageState;
  currentContextTokens: number; // latest turn's inputTokens (not cumulative)
  planState: PlanState | null;
  pendingSteers: string[];
}

const zeroUsage: UsageState = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalCost: 0,
};

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
};

function addSeen(state: ThreadState, key: string): ThreadState {
  if (state.seenKeys[key]) {
    return state;
  }

  return {
    ...state,
    seenKeys: {
      ...state.seenKeys,
      [key]: true,
    },
  };
}

function withItem(state: ThreadState, key: string, item: RenderItem): ThreadState {
  const seenState = addSeen(state, key);
  if (seenState === state) return state;
  return {
    ...seenState,
    items: [...seenState.items, item],
  };
}

function stringifyUnknown(value: unknown): string {
  try {
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function updateItem(state: ThreadState, itemId: string, updater: (item: RenderItem) => RenderItem): ThreadState {
  const index = state.items.findIndex((item) => item.id === itemId);
  if (index < 0) return state;

  const nextItems = [...state.items];
  nextItems[index] = updater(nextItems[index]);
  return {
    ...state,
    items: nextItems,
  };
}

/** Find the most recent collab spawn RenderItem for a given agentId. */
function findCollabSpawnItem(state: ThreadState, agentId: string): Extract<RenderItem, { kind: "collab" }> | undefined {
  for (let i = state.items.length - 1; i >= 0; i--) {
    const item = state.items[i];
    if (item.kind === "collab" && item.eventType === "spawn" && item.agentId === agentId) {
      return item;
    }
  }
  return undefined;
}

function parsePlanOutput(output: string): PlanState | null {
  try {
    const parsed = JSON.parse(output) as { title?: string; steps?: Array<{ text: string; done: boolean }> };
    if (parsed && Array.isArray(parsed.steps)) {
      return { title: parsed.title ?? "Plan", steps: parsed.steps };
    }
  } catch {
    // not valid plan JSON
  }
  return null;
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
          },
        ],
      };
    }

    case "message_delta": {
      const renderId = state.itemSlots[event.itemId];
      if (!renderId) return state;

      if (event.delta.type === "text_delta") {
        return updateItem(state, renderId, (item) =>
          item.kind === "assistant" ? { ...item, text: item.text + event.delta.delta, thinkingDone: true } : item,
        );
      }

      if (event.delta.type === "thinking_delta") {
        return updateItem(state, renderId, (item) =>
          item.kind === "assistant" ? { ...item, thinking: item.thinking + event.delta.delta } : item,
        );
      }

      return state;
    }

    case "message_end": {
      const renderId = state.itemSlots[event.itemId];
      if (!renderId) return state;
      const { [event.itemId]: _, ...remainingSlots } = state.itemSlots;
      return {
        ...updateItem(state, renderId, (current) =>
          current.kind === "assistant"
            ? { ...current, thinkingDone: true, timestamp: event.message.timestamp }
            : current,
        ),
        itemSlots: remainingSlots,
      };
    }

    case "tool_start": {
      // Collab tools already rendered by CollabEventBlock — skip duplicate ToolBlock
      if (COLLAB_RENDERED_TOOLS.has(event.toolName)) return state;
      const renderId = `item:${event.itemId}:${++renderSeq}`;
      if (state.itemSlots[event.itemId]) return state;
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
            timestamp: Date.now(),
            toolCallId: event.toolCallId,
          },
        ],
      };
    }

    case "tool_update": {
      const renderId = state.itemSlots[event.itemId];
      if (!renderId) return state;
      return updateItem(state, renderId, (item) =>
        item.kind === "tool" ? { ...item, outputText: item.outputText + event.partialResult } : item,
      );
    }

    case "tool_end": {
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
              }
            : current,
        ),
        itemSlots: remainingSlots,
      };

      if (event.toolName === "plan" && event.output) {
        const plan = parsePlanOutput(event.output);
        if (plan) {
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
        currentContextTokens: event.usage.inputTokens,
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
        timestamp: Date.now(),
      }));
      return {
        ...state,
        pendingSteers: remaining,
        items: [...state.items, ...newItems],
      };
    }

    case "collab_spawn_begin":
      return state;

    case "collab_spawn_end": {
      const renderId = `collab:spawn:${event.callId}`;
      return withItem(state, renderId, {
        id: renderId,
        kind: "collab",
        eventType: "spawn",
        agentId: event.agentId,
        nickname: event.nickname,
        description: event.description,
        status: event.status,
        message: event.message,
        childTools: [],
        timestamp: Date.now(),
      });
    }

    case "collab_wait_begin":
      return state;

    case "collab_wait_end": {
      const renderId = `collab:wait:${event.callId}`;
      return withItem(state, renderId, {
        id: renderId,
        kind: "collab",
        eventType: "wait",
        agents: event.agentStatuses.map((a) => ({
          agentId: a.agentId,
          nickname: a.nickname,
          status: a.status,
          message: a.message,
        })),
        timedOut: event.timedOut,
        childTools: [],
        timestamp: Date.now(),
      });
    }

    case "collab_close_begin":
      return state;

    case "collab_close_end": {
      const renderId = `collab:close:${event.callId}`;
      return withItem(state, renderId, {
        id: renderId,
        kind: "collab",
        eventType: "close",
        agentId: event.agentId,
        nickname: event.nickname,
        status: event.status,
        message: event.message,
        childTools: [],
        timestamp: Date.now(),
      });
    }

    // Collab — sub-agent internal activity: update the spawn item for this agent
    case "collab_tool_start": {
      const spawnItem = findCollabSpawnItem(state, event.agentId);
      if (!spawnItem) return state;
      return updateItem(state, spawnItem.id, (item) =>
        item.kind === "collab"
          ? {
              ...item,
              childTools: [
                ...item.childTools,
                { toolCallId: event.toolCallId, toolName: event.toolName, status: "running" as const, isError: false },
              ],
            }
          : item,
      );
    }

    case "collab_tool_end": {
      const spawnItem = findCollabSpawnItem(state, event.agentId);
      if (!spawnItem) return state;
      return updateItem(state, spawnItem.id, (item) =>
        item.kind === "collab"
          ? {
              ...item,
              childTools: item.childTools.map((t) =>
                t.toolCallId === event.toolCallId ? { ...t, status: "done" as const, isError: event.isError } : t,
              ),
            }
          : item,
      );
    }

    case "collab_turn_start": {
      const spawnItem = findCollabSpawnItem(state, event.agentId);
      if (!spawnItem) return state;
      return updateItem(state, spawnItem.id, (item) =>
        item.kind === "collab" ? { ...item, turnNumber: event.turnNumber } : item,
      );
    }

    case "turn_start":
      return state;

    default:
      return state;
  }
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
    return state;
  }

  // Thread-level notifications handled directly
  if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_STARTED) {
    return { ...state, activeThreadId: notification.params.threadId };
  }
  if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_RESUMED) {
    return { ...state, activeThreadId: notification.params.threadId };
  }

  // Handle userMessage items from other subscribers (not converted to AgentEvent by adapter)
  if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_STARTED) {
    const item = (
      notification.params as {
        item?: { type?: string; itemId?: string; message?: { content?: unknown; timestamp?: number } };
      }
    ).item;
    if (item?.type === "userMessage" && item.message) {
      const text =
        typeof item.message.content === "string" ? item.message.content : stringifyUnknown(item.message.content);
      return withItem(state, `remote-user-${item.itemId}`, {
        id: `remote-user-${item.itemId}`,
        kind: "user",
        text,
        timestamp: item.message.timestamp ?? Date.now(),
      });
    }
  }

  // Delegate all item lifecycle, status, usage, error, knowledge, loop, steering to AgentEvent reducer
  let current = state;
  for (const event of events) {
    current = reduceAgentEvent(current, event);
  }
  return current;
}

export function hydrateFromThreadRead(state: ThreadState, payload: ThreadReadResponse): ThreadState {
  // Pre-compute which toolCallIds already have results, to detect in-progress tools
  const resolvedToolCallIds = new Set<string>();
  if (payload.isRunning) {
    for (const message of payload.messages) {
      if (message.role === "tool_result") {
        resolvedToolCallIds.add((message as { toolCallId: string }).toolCallId);
      }
    }
  }

  const base: ThreadState = {
    ...state,
    items: [],
    seenKeys: {},
    itemSlots: {},
    usage: zeroUsage,
    planState: null,
    pendingSteers: [],
    threadStatus: payload.isRunning ? "busy" : "idle",
  };

  let current = base;

  for (const message of payload.messages) {
    if (message.role === "user") {
      if (isSummaryMessage(message)) {
        const summary = (message.content as string).slice(SUMMARY_PREFIX.length + 1);
        current = withItem(current, `history:context:${message.timestamp}`, {
          id: `history:context:${message.timestamp}`,
          kind: "context",
          summary,
          timestamp: message.timestamp,
        });
        continue;
      }
      const text = typeof message.content === "string" ? message.content : stringifyUnknown(message.content);
      current = withItem(current, `history:user:${message.timestamp}`, {
        id: `history:user:${message.timestamp}`,
        kind: "user",
        text,
        timestamp: message.timestamp,
      });
      continue;
    }

    if (message.role === "assistant") {
      let text = "";
      let thinking = "";
      for (const block of message.content) {
        if (block.type === "text") text += block.text;
        if (block.type === "thinking") thinking += block.thinking;
        if (block.type === "tool_call") {
          // Collab tools rendered by CollabEventBlock — skip duplicate ToolBlock in history
          if (COLLAB_RENDERED_TOOLS.has(block.name)) continue;
          const inProgress = payload.isRunning && !resolvedToolCallIds.has(block.id);
          current = withItem(current, `history:toolcall:${block.id}:${message.timestamp}`, {
            id: `history:tool:${block.id}`,
            kind: "tool",
            toolName: block.name,
            inputText: stringifyUnknown(block.input),
            outputText: "",
            isError: false,
            status: inProgress ? "streaming" : "done",
            timestamp: message.timestamp,
            toolCallId: block.id,
          });
        }
      }

      current = withItem(current, `history:assistant:${message.timestamp}`, {
        id: `history:assistant:${message.timestamp}`,
        kind: "assistant",
        text,
        thinking,
        thinkingDone: true,
        timestamp: message.timestamp,
      });
      continue;
    }

    const existingToolItem = current.items.find(
      (item) => item.kind === "tool" && item.toolCallId === message.toolCallId,
    );

    if (existingToolItem?.kind === "tool") {
      current = updateItem(current, existingToolItem.id, (item) =>
        item.kind === "tool"
          ? {
              ...item,
              outputText: message.output,
              isError: message.isError,
              status: "done",
              timestamp: message.timestamp,
            }
          : item,
      );
      continue;
    }

    current = withItem(current, `history:tool:${message.toolCallId}:${message.timestamp}`, {
      id: `history:tool:${message.toolCallId}`,
      kind: "tool",
      toolName: message.toolName,
      inputText: "",
      outputText: message.output,
      isError: message.isError,
      status: "done",
      timestamp: message.timestamp,
      toolCallId: message.toolCallId,
    });
  }

  // Extract planState from the last plan tool result
  let lastPlan: PlanState | null = null;
  for (const message of payload.messages) {
    if (message.role === "tool_result" && message.toolName === "plan") {
      const plan = parsePlanOutput(message.output);
      if (plan) lastPlan = plan;
    }
  }
  current = { ...current, planState: lastPlan };

  return current;
}
