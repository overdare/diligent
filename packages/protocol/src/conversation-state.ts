// @summary Framework-agnostic conversation live state shared across all Diligent clients
import type { ThreadItem } from "./data-model";

/**
 * Framework-agnostic representation of a live conversation's streaming state.
 * Shared by all Diligent clients (CLI, Web, VS Code) as the common state shape
 * produced by the AgentEvent state reducer.
 *
 * Client-specific concerns (e.g. connection lifecycle, UI focus state) should be
 * added in a client-side extension of this interface rather than here.
 */
export interface ConversationLiveState {
  threadId: string | null;
  threadTitle: string | null;
  threadStatus: string | null;
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

/** Returns a zeroed-out ConversationLiveState suitable as an initial value. */
export function createInitialConversationLiveState(): ConversationLiveState {
  return {
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
}
