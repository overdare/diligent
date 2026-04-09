// @summary Local conversation panel state derived from shared protocol payloads
import type { AgentEvent, ThreadItem, ThreadReadResponse } from "@diligent/protocol";
import type { ConversationPanelMeta } from "./bridge";

export interface ConversationViewState {
  connection: ConversationPanelMeta["connection"];
  threadId: string | null;
  threadTitle: string | null;
  threadStatus: ConversationPanelMeta["threadStatus"];
  items: ThreadItem[];
  liveText: string;
  liveThinking: string;
  liveToolName: string | null;
  liveToolInput: string | null;
  liveToolOutput: string;
  overlayStatus: string | null;
  isLoading: boolean;
  lastError: string | null;
}

export const initialConversationViewState: ConversationViewState = {
  connection: "stopped",
  threadId: null,
  threadTitle: null,
  threadStatus: null,
  items: [],
  liveText: "",
  liveThinking: "",
  liveToolName: null,
  liveToolInput: null,
  liveToolOutput: "",
  overlayStatus: null,
  isLoading: false,
  lastError: null,
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
  switch (event.type) {
    case "status_change":
      return {
        ...state,
        threadStatus: event.status,
        overlayStatus: event.status === "busy" ? (state.overlayStatus ?? "Working…") : null,
      };
    case "turn_start":
      return { ...state, overlayStatus: "Thinking…" };
    case "message_start":
      return { ...state, liveText: "", liveThinking: "", overlayStatus: "Thinking…" };
    case "message_delta":
      if (event.delta.type === "text_delta") {
        return {
          ...state,
          liveText: `${state.liveText}${event.delta.delta}`,
          overlayStatus: null,
        };
      }
      if (event.delta.type === "thinking_delta") {
        return {
          ...state,
          liveThinking: `${state.liveThinking}${event.delta.delta}`,
          overlayStatus: "Thinking…",
        };
      }
      return state;
    case "message_end":
      return {
        ...state,
        liveText: "",
        liveThinking: "",
        overlayStatus: state.liveToolName ? state.overlayStatus : null,
      };
    case "tool_start":
      return {
        ...state,
        liveToolName: event.toolName,
        liveToolInput:
          event.render?.inputSummary?.trim() ||
          (typeof event.input === "string" ? event.input : JSON.stringify(event.input, null, 2)),
        liveToolOutput: "",
        overlayStatus: `${event.render?.inputSummary?.trim() || event.toolName}…`,
      };
    case "tool_update":
      return {
        ...state,
        liveToolName: event.toolName,
        liveToolOutput: `${state.liveToolOutput}${event.partialResult}`,
        overlayStatus: `${state.liveToolInput || event.toolName}…`,
      };
    case "tool_end":
      return {
        ...state,
        liveToolName: null,
        liveToolInput: null,
        liveToolOutput: "",
        overlayStatus: null,
      };
    case "compaction_start":
      return { ...state, overlayStatus: "Compacting…" };
    case "compaction_end":
      return { ...state, overlayStatus: null };
    case "error":
      return {
        ...state,
        lastError: event.error.message,
        overlayStatus: null,
        liveText: "",
        liveThinking: "",
        liveToolName: null,
        liveToolInput: null,
        liveToolOutput: "",
      };
    default:
      return state;
  }
}
