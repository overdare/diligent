// @summary Protocol event reducer and view-state normalization for Web CLI thread rendering
import type {
  ApprovalRequest,
  DiligentServerNotification,
  Mode,
  SessionSummary,
  ThreadReadResponse,
  ThreadStatus,
  UserInputRequest,
} from "@diligent/protocol";

export interface PlanState {
  title: string;
  steps: Array<{ text: string; done: boolean }>;
}

export interface ToastState {
  id: string;
  kind: "error" | "info";
  message: string;
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
  planState: PlanState | null;
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
  planState: null,
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

function toProtocolItemKey(turnId: string, itemId: string): string {
  return `${turnId}:${itemId}`;
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

export function reduceServerNotification(state: ThreadState, notification: DiligentServerNotification): ThreadState {
  switch (notification.method) {
    case "thread/started":
      return {
        ...state,
        activeThreadId: notification.params.threadId,
      };

    case "thread/resumed":
      return {
        ...state,
        activeThreadId: notification.params.threadId,
      };

    case "thread/status/changed":
      return {
        ...state,
        threadStatus: notification.params.status,
      };

    case "turn/started":
      return state;

    case "item/started": {
      const { item, turnId } = notification.params;
      const key = `${turnId}:${item.itemId}:started`;
      const protocolKey = toProtocolItemKey(turnId, item.itemId);
      const renderId = `item:${protocolKey}`;

      const seenState = addSeen(state, key);
      if (seenState === state) {
        return state;
      }

      if (item.type === "agentMessage") {
        return {
          ...seenState,
          itemSlots: {
            ...seenState.itemSlots,
            [protocolKey]: renderId,
          },
          items: [
            ...seenState.items,
            {
              id: renderId,
              kind: "assistant",
              text: "",
              thinking: "",
              thinkingDone: false,
              timestamp: item.message.timestamp,
            },
          ],
        };
      }

      if (item.type === "toolCall") {
        return {
          ...seenState,
          itemSlots: {
            ...seenState.itemSlots,
            [protocolKey]: renderId,
          },
          items: [
            ...seenState.items,
            {
              id: renderId,
              kind: "tool",
              toolName: item.toolName,
              inputText: stringifyUnknown(item.input),
              outputText: "",
              isError: false,
              status: "streaming",
              timestamp: Date.now(),
              toolCallId: item.toolCallId,
            },
          ],
        };
      }

      return seenState;
    }

    case "item/delta": {
      const { itemId, delta, turnId } = notification.params;
      const protocolKey = toProtocolItemKey(turnId, itemId);
      const renderId = state.itemSlots[protocolKey];
      if (!renderId) {
        return state;
      }

      if (delta.type === "messageText") {
        return updateItem(state, renderId, (item) =>
          item.kind === "assistant"
            ? {
                ...item,
                text: item.text + delta.delta,
                thinkingDone: true,
              }
            : item,
        );
      }

      if (delta.type === "messageThinking") {
        return updateItem(state, renderId, (item) =>
          item.kind === "assistant"
            ? {
                ...item,
                thinking: item.thinking + delta.delta,
              }
            : item,
        );
      }

      if (delta.type === "toolOutput") {
        return updateItem(state, renderId, (item) =>
          item.kind === "tool"
            ? {
                ...item,
                outputText: item.outputText + delta.delta,
              }
            : item,
        );
      }

      return state;
    }

    case "item/completed": {
      const { item, turnId } = notification.params;
      const protocolKey = toProtocolItemKey(turnId, item.itemId);
      const slotRenderId = state.itemSlots[protocolKey];
      // Fallback: for in-progress tools hydrated during reconnect, find by toolCallId
      const renderId =
        slotRenderId ??
        (item.type === "toolCall"
          ? state.items.find((i) => i.kind === "tool" && i.toolCallId === item.toolCallId)?.id
          : undefined);
      if (!renderId) {
        return state;
      }

      if (item.type === "agentMessage") {
        return updateItem(state, renderId, (current) =>
          current.kind === "assistant"
            ? {
                ...current,
                thinkingDone: true,
                timestamp: item.message.timestamp,
              }
            : current,
        );
      }

      if (item.type === "toolCall") {
        let next = updateItem(state, renderId, (current) =>
          current.kind === "tool"
            ? {
                ...current,
                outputText: item.output ?? current.outputText,
                isError: item.isError ?? false,
                status: "done",
              }
            : current,
        );

        if (item.toolName === "plan" && item.output) {
          const plan = parsePlanOutput(item.output);
          if (plan) {
            next = { ...next, planState: plan };
          }
        }

        return next;
      }

      return state;
    }

    case "turn/completed":
      return state;

    case "knowledge/saved":
      return {
        ...state,
        toast: {
          id: `info-${notification.params.knowledgeId}`,
          kind: "info",
          message: "Knowledge updated",
        },
      };

    case "loop/detected":
      return {
        ...state,
        toast: {
          id: `loop-${notification.params.threadId}-${notification.params.patternLength}`,
          kind: "info",
          message: `Loop detected in ${notification.params.toolName}`,
        },
      };

    case "error":
      return {
        ...state,
        toast: {
          id: `err-${Date.now()}`,
          kind: "error",
          message: notification.params.error.message,
        },
      };

    case "usage/updated":
      return {
        ...state,
        usage: {
          inputTokens: state.usage.inputTokens + notification.params.usage.inputTokens,
          outputTokens: state.usage.outputTokens + notification.params.usage.outputTokens,
          cacheReadTokens: state.usage.cacheReadTokens + notification.params.usage.cacheReadTokens,
          cacheWriteTokens: state.usage.cacheWriteTokens + notification.params.usage.cacheWriteTokens,
          totalCost: state.usage.totalCost + notification.params.cost,
        },
      };

    default:
      return state;
  }
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
    threadStatus: payload.isRunning ? "busy" : "idle",
  };

  let current = base;

  for (const message of payload.messages) {
    if (message.role === "user") {
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
    if (message.role === "tool" && message.toolName === "plan") {
      const plan = parsePlanOutput(message.output);
      if (plan) lastPlan = plan;
    }
  }
  current = { ...current, planState: lastPlan };

  return current;
}
