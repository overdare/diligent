// @summary Local conversation panel state derived from shared protocol payloads
import {
  applyAgentEvents,
  createInitialConversationLiveState,
  type AgentEvent,
  type ConversationLiveState,
  type ThreadReadResponse,
} from "@diligent/protocol";
import type { ConversationPanelMeta } from "./bridge";

export interface ConversationViewState extends ConversationLiveState {
  connection: ConversationPanelMeta["connection"];
}

export const initialConversationViewState: ConversationViewState = {
  ...createInitialConversationLiveState(),
  connection: "stopped",
};

export function applyPanelMeta(state: ConversationViewState, meta: ConversationPanelMeta): ConversationViewState {
  return {
    ...state,
    connection: meta.connection,
    threadId: meta.threadId,
    threadTitle: meta.threadTitle,
    threadStatus: meta.threadStatus,
    lastError: meta.lastError,
    overlayStatus:
      state.liveText || state.liveThinking || state.liveToolName
        ? state.overlayStatus
        : meta.threadStatus === "busy"
          ? "Working…"
          : null,
  };
}

export function applyThreadRead(state: ConversationViewState, payload: ThreadReadResponse): ConversationViewState {
  return {
    ...state,
    items: payload.items,
    threadStatus: payload.isRunning ? "busy" : "idle",
    overlayStatus: payload.isRunning ? (state.overlayStatus ?? "Working…") : null,
    liveText: payload.isRunning ? state.liveText : "",
    liveThinking: payload.isRunning ? state.liveThinking : "",
    liveToolName: payload.isRunning ? state.liveToolName : null,
    liveToolInput: payload.isRunning ? state.liveToolInput : null,
    liveToolOutput: payload.isRunning ? state.liveToolOutput : "",
    isLoading: false,
  };
}

export function applyAgentEvent(state: ConversationViewState, event: AgentEvent): ConversationViewState {
  const next = applyAgentEvents(state, [event]);
  if (event.type === "error") {
    return { ...next, lastError: event.error.message };
  }
  return next;
}
