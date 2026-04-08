// @summary Typed host/webview bridge messages for the VS Code conversation view
import type { DiligentServerNotification, ThreadItem, ThreadReadResponse } from "@diligent/protocol";
import type { ExtensionConnectionState } from "../../state/thread-store";

export interface ConversationViewState {
  connection: ExtensionConnectionState;
  activeThreadId: string | null;
  activeThreadTitle: string | null;
  threadStatus: string | null;
  items: ThreadItem[];
  isLoading: boolean;
  lastError: string | null;
}

export type HostToWebviewMessage =
  | { type: "state/init"; state: ConversationViewState }
  | { type: "thread/event"; event: DiligentServerNotification }
  | { type: "thread/read"; payload: ThreadReadResponse }
  | { type: "connection/status"; status: ExtensionConnectionState }
  | { type: "error"; message: string };

export type WebviewToHostMessage =
  | { type: "prompt/submit"; text: string }
  | { type: "thread/select"; threadId: string }
  | { type: "thread/new" }
  | { type: "turn/interrupt" }
  | { type: "logs/open" };
