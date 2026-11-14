// @summary Thin host↔webview bridge types for the VS Code conversation panel
import type { AgentEvent, ThreadReadResponse, ThreadStatus } from "@diligent/protocol";
import type { ExtensionConnectionState } from "../../state/thread-store";

export interface ConversationPanelMeta {
  connection: ExtensionConnectionState;
  threadId: string | null;
  threadTitle: string | null;
  threadStatus: ThreadStatus | null;
  lastError: string | null;
}

export type HostToWebviewMessage =
  | { type: "meta"; meta: ConversationPanelMeta }
  | { type: "threadRead"; payload: ThreadReadResponse }
  | { type: "agentEvent"; event: AgentEvent }
  | { type: "error"; message: string };

export type WebviewToHostMessage =
  | { type: "prompt/submit"; text: string }
  | { type: "thread/select"; threadId: string }
  | { type: "thread/new" }
  | { type: "turn/interrupt" }
  | { type: "logs/open" };
