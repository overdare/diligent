// @summary Typed host/webview bridge messages for the VS Code conversation view
import type { AgentEvent, DiligentServerNotification, ThreadItem, ThreadReadResponse } from "@diligent/protocol";
import type { ExtensionConnectionState } from "../../state/thread-store";

export interface ConversationViewState {
  connection: ExtensionConnectionState;
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

export type HostToWebviewMessage =
  | { type: "state/init"; state: ConversationViewState }
  | { type: "thread/event"; event: DiligentServerNotification }
  | { type: "agent/events"; events: AgentEvent[] }
  | { type: "thread/read"; payload: ThreadReadResponse }
  | { type: "connection/status"; status: ExtensionConnectionState }
  | { type: "error"; message: string };

export type WebviewToHostMessage =
  | { type: "prompt/submit"; text: string }
  | { type: "thread/select"; threadId: string }
  | { type: "thread/new" }
  | { type: "turn/interrupt" }
  | { type: "logs/open" };
