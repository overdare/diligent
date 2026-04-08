// @summary WebviewView provider that bridges extension state and prompt actions for the Diligent conversation panel
import * as path from "node:path";
import type { DiligentServerNotification, ThreadReadResponse } from "@diligent/protocol";
import * as vscode from "vscode";
import type { ThreadStore } from "../state/thread-store";
import type { ConversationViewState, HostToWebviewMessage, WebviewToHostMessage } from "./webview/protocol";

export interface ConversationViewActions {
  sendPrompt(text: string): Promise<void>;
  newThread(): Promise<void>;
  selectThread(threadId: string): Promise<void>;
  interrupt(): Promise<void>;
  openLogs(): Promise<void>;
}

export class ConversationViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: ThreadStore,
    private readonly actions: ConversationViewActions,
  ) {}

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview")],
    };
    view.webview.html = this.renderHtml(view.webview);
    view.webview.onDidReceiveMessage((message: WebviewToHostMessage) => {
      void this.handleMessage(message);
    });

    this.store.subscribe((state) => {
      this.postMessage({ type: "state/init", state: this.toConversationState(state) });
    });
  }

  postThreadRead(payload: ThreadReadResponse): void {
    this.postMessage({ type: "thread/read", payload });
  }

  postThreadEvent(event: DiligentServerNotification): void {
    this.postMessage({ type: "thread/event", event });
  }

  postConnectionStatus(status: ConversationViewState["connection"]): void {
    this.postMessage({ type: "connection/status", status });
  }

  postError(message: string): void {
    this.postMessage({ type: "error", message });
  }

  private postMessage(message: HostToWebviewMessage): void {
    void this.view?.webview.postMessage(message);
  }

  private toConversationState(state: ReturnType<ThreadStore["snapshot"]>): ConversationViewState {
    const activeThread = state.activeThreadId
      ? (state.threads.find((thread) => thread.id === state.activeThreadId) ?? null)
      : null;
    const activeRead = state.activeThreadId ? state.threadReads[state.activeThreadId] : undefined;
    return {
      connection: state.connection,
      activeThreadId: state.activeThreadId,
      activeThreadTitle: activeThread?.name ?? activeThread?.firstUserMessage ?? state.activeThreadId,
      threadStatus: state.activeThreadStatus,
      items: activeRead?.items ?? [],
      isLoading: false,
      lastError: state.lastError,
    };
  }

  private renderHtml(webview: vscode.Webview): string {
    const baseDir = path.join(this.context.extensionPath, "dist", "webview");
    const scriptUri = webview.asWebviewUri(vscode.Uri.file(path.join(baseDir, "index.js")));
    const styleUri = webview.asWebviewUri(vscode.Uri.file(path.join(baseDir, "styles.css")));
    const nonce = String(Date.now());
    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${styleUri}" />
    <title>Diligent</title>
  </head>
  <body>
    <div id="app"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }

  private async handleMessage(message: WebviewToHostMessage): Promise<void> {
    switch (message.type) {
      case "prompt/submit":
        await this.actions.sendPrompt(message.text);
        return;
      case "thread/new":
        await this.actions.newThread();
        return;
      case "thread/select":
        await this.actions.selectThread(message.threadId);
        return;
      case "turn/interrupt":
        await this.actions.interrupt();
        return;
      case "logs/open":
        await this.actions.openLogs();
        return;
    }
  }
}
