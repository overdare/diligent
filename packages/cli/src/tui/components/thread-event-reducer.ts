// @summary Pure event-to-state reducer for ThreadStore core transitions without side effects

import type { AgentEvent } from "@diligent/protocol";

export type ReducerOverlayStatusKind = "default" | "tool";

export interface ReducerOverlayStatus {
  message: string;
  startedAt: number;
  kind: ReducerOverlayStatusKind;
}

export interface ThreadEventReducerState<TItem> {
  items: TItem[];
  thinkingStartTime: number | null;
  thinkingText: string;
  overlayStatus: ReducerOverlayStatus | null;
  statusBeforeCompaction: string | null;
  isThreadBusy: boolean;
  busyStartedAt: number | null;
  lastUsage: { input: number; output: number; cost: number } | null;
}

interface ThreadEventReducerDeps<TItem> {
  nowMs: number;
  buildCompactionItem: (event: Extract<AgentEvent, { type: "compaction_end" }>) => TItem;
  buildKnowledgeSavedItem: () => TItem;
  buildErrorItem: (message: string) => TItem;
}

type DelegatedEvent =
  | Extract<AgentEvent, { type: "message_delta" }>
  | Extract<AgentEvent, { type: "tool_start" }>
  | Extract<AgentEvent, { type: "tool_update" }>
  | Extract<AgentEvent, { type: "tool_end" }>;

export type ThreadEventReducerDelegate =
  | { kind: "message_start" }
  | { kind: "message_delta"; event: Extract<DelegatedEvent, { type: "message_delta" }> }
  | { kind: "message_end" }
  | { kind: "tool_start"; event: Extract<DelegatedEvent, { type: "tool_start" }> }
  | { kind: "tool_update"; event: Extract<DelegatedEvent, { type: "tool_update" }> }
  | { kind: "tool_end"; event: Extract<DelegatedEvent, { type: "tool_end" }> };

export interface ThreadEventReducerResult<TItem> {
  handled: boolean;
  requestRender: boolean;
  state: ThreadEventReducerState<TItem>;
  delegate?: ThreadEventReducerDelegate;
}

function setOverlayStatus(
  current: ReducerOverlayStatus | null,
  message: string,
  kind: ReducerOverlayStatusKind,
  nowMs: number,
): ReducerOverlayStatus {
  if (!current) {
    return { message, kind, startedAt: nowMs };
  }

  if (current.message !== message || current.kind !== kind) {
    return { message, kind, startedAt: nowMs };
  }

  return current;
}

export function reduceThreadStoreEvent<TItem>(
  state: ThreadEventReducerState<TItem>,
  event: AgentEvent,
  deps: ThreadEventReducerDeps<TItem>,
): ThreadEventReducerResult<TItem> {
  switch (event.type) {
    case "agent_start":
      return {
        handled: true,
        requestRender: true,
        state: {
          ...state,
          overlayStatus: setOverlayStatus(state.overlayStatus, "Thinking…", "default", deps.nowMs),
        },
      };

    case "message_start":
      return {
        handled: true,
        requestRender: false,
        state,
        delegate: { kind: "message_start" },
      };

    case "message_delta":
      return {
        handled: true,
        requestRender: false,
        state,
        delegate: { kind: "message_delta", event },
      };

    case "message_end":
      return {
        handled: true,
        requestRender: false,
        state,
        delegate: { kind: "message_end" },
      };

    case "tool_start":
      return {
        handled: true,
        requestRender: false,
        state,
        delegate: { kind: "tool_start", event },
      };

    case "tool_update":
      return {
        handled: true,
        requestRender: false,
        state,
        delegate: { kind: "tool_update", event },
      };

    case "tool_end":
      return {
        handled: true,
        requestRender: false,
        state,
        delegate: { kind: "tool_end", event },
      };

    case "turn_start":
    case "user_message":
      return {
        handled: true,
        requestRender: false,
        state,
      };

    case "status_change": {
      if (event.status === "busy") {
        return {
          handled: true,
          requestRender: true,
          state: {
            ...state,
            isThreadBusy: true,
            busyStartedAt: state.busyStartedAt ?? deps.nowMs,
          },
        };
      }

      return {
        handled: true,
        requestRender: true,
        state: {
          ...state,
          isThreadBusy: false,
          busyStartedAt: null,
          statusBeforeCompaction: null,
        },
      };
    }

    case "usage":
      return {
        handled: true,
        requestRender: false,
        state: {
          ...state,
          lastUsage: {
            input: event.usage.inputTokens,
            output: event.usage.outputTokens,
            cost: event.cost,
          },
        },
      };

    case "compaction_start":
      return {
        handled: true,
        requestRender: true,
        state: {
          ...state,
          statusBeforeCompaction: state.overlayStatus?.message ?? null,
          overlayStatus: setOverlayStatus(state.overlayStatus, "Compacting…", "default", deps.nowMs),
        },
      };

    case "compaction_end": {
      const restoredStatus = state.statusBeforeCompaction;
      return {
        handled: true,
        requestRender: true,
        state: {
          ...state,
          statusBeforeCompaction: null,
          overlayStatus: restoredStatus
            ? setOverlayStatus(state.overlayStatus, restoredStatus, "default", deps.nowMs)
            : null,
          items: [...state.items, deps.buildCompactionItem(event)],
        },
      };
    }

    case "knowledge_saved":
      return {
        handled: true,
        requestRender: true,
        state: {
          ...state,
          items: [...state.items, deps.buildKnowledgeSavedItem()],
        },
      };

    case "error":
      return {
        handled: true,
        requestRender: true,
        state: {
          ...state,
          overlayStatus: null,
          thinkingStartTime: null,
          thinkingText: "",
          items: [...state.items, deps.buildErrorItem(event.error.message)],
        },
      };

    case "turn_end": {
      const shouldClearCompactionStatus =
        !state.statusBeforeCompaction && state.overlayStatus?.message === "Compacting…";
      return {
        handled: true,
        requestRender: true,
        state: {
          ...state,
          isThreadBusy: false,
          busyStartedAt: null,
          overlayStatus: shouldClearCompactionStatus ? null : state.overlayStatus,
        },
      };
    }

    default:
      return { handled: false, requestRender: false, state };
  }
}
