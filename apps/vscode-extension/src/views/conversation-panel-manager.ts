// @summary Editor-area WebviewPanel manager for one-conversation-tab-per-thread in the VS Code extension
import * as path from "node:path";
import type { AgentEvent, ThreadReadResponse } from "@diligent/protocol";
import * as vscode from "vscode";
import { CONVERSATION_PANEL_VIEW_TYPE } from "../manifest";
import type { ThreadStore } from "../state/thread-store";
import type { ConversationViewState, WebviewToHostMessage } from "./webview/protocol";

export interface ConversationPanelActions {
  sendPrompt(threadId: string, text: string): Promise<void>;
  newThread(): Promise<void>;
  selectThread(threadId: string): Promise<void>;
  focusThread(threadId: string): void;
  interrupt(threadId: string): Promise<void>;
  openLogs(): Promise<void>;
}

interface ConversationPanelEntry {
  panel: vscode.WebviewPanel;
  dispose: vscode.Disposable;
}

export class ConversationPanelManager implements vscode.Disposable {
  private readonly panels = new Map<string, ConversationPanelEntry>();
  private readonly storeSubscription: () => void;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: ThreadStore,
    private readonly actions: ConversationPanelActions,
  ) {
    this.storeSubscription = this.store.subscribe((state) => {
      for (const [threadId, entry] of this.panels) {
        entry.panel.title = this.getPanelTitle(threadId, state);
        void entry.panel.webview.postMessage({
          type: "state/init",
          state: this.toConversationState(threadId, state),
        } satisfies { type: "state/init"; state: ConversationViewState });
      }
    });
  }

  openThread(threadId: string, options?: { preserveFocus?: boolean }): void {
    const existing = this.panels.get(threadId);
    if (existing) {
      existing.panel.reveal(undefined, options?.preserveFocus ?? false);
      this.actions.focusThread(threadId);
      return;
    }

    const state = this.store.snapshot();
    const panel = vscode.window.createWebviewPanel(
      CONVERSATION_PANEL_VIEW_TYPE,
      this.getPanelTitle(threadId, state),
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.file(path.join(this.context.extensionPath, "dist", "webview"))],
        retainContextWhenHidden: true,
      },
    );
    panel.iconPath = vscode.Uri.file(path.join(this.context.extensionPath, "media", "diligent.svg"));
    panel.webview.html = this.renderHtml(panel.webview);
    const disposables: vscode.Disposable[] = [];
    disposables.push(
      panel.webview.onDidReceiveMessage((message: WebviewToHostMessage) => {
        void this.handleMessage(threadId, message);
      }),
      panel.onDidDispose(() => {
        this.disposeThread(threadId);
      }),
      panel.onDidChangeViewState((event) => {
        if (event.webviewPanel.active) {
          this.actions.focusThread(threadId);
        }
      }),
    );

    this.panels.set(threadId, {
      panel,
      dispose: vscode.Disposable.from(...disposables),
    });

    void panel.webview.postMessage({
      type: "state/init",
      state: this.toConversationState(threadId, state),
    } satisfies { type: "state/init"; state: ConversationViewState });
    this.actions.focusThread(threadId);
  }

  hasPanel(threadId: string): boolean {
    return this.panels.has(threadId);
  }

  postThreadRead(threadId: string, payload: ThreadReadResponse): void {
    const entry = this.panels.get(threadId);
    if (!entry) {
      return;
    }

    void entry.panel.webview.postMessage({ type: "thread/read", payload });
  }

  postAgentEvents(threadId: string, events: AgentEvent[]): void {
    const entry = this.panels.get(threadId);
    if (!entry || events.length === 0) {
      return;
    }

    void entry.panel.webview.postMessage({ type: "agent/events", events });
  }

  dispose(): void {
    this.storeSubscription();
    for (const threadId of [...this.panels.keys()]) {
      this.disposeThread(threadId, true);
    }
  }

  private disposeThread(threadId: string, closePanel = false): void {
    const entry = this.panels.get(threadId);
    if (!entry) {
      return;
    }

    this.panels.delete(threadId);
    entry.dispose.dispose();
    if (closePanel) {
      entry.panel.dispose();
    }
  }

  private toConversationState(threadId: string, state: ReturnType<ThreadStore["snapshot"]>): ConversationViewState {
    const thread = state.threads.find((summary) => summary.id === threadId) ?? null;
    const read = state.threadReads[threadId];
    return {
      connection: state.connection,
      threadId,
      threadTitle: thread?.name ?? thread?.firstUserMessage ?? threadId,
      threadStatus: state.threadStatuses[threadId] ?? null,
      items: read?.items ?? [],
      liveText: "",
      liveThinking: "",
      liveToolName: null,
      liveToolInput: null,
      liveToolOutput: "",
      overlayStatus: state.threadStatuses[threadId] === "busy" ? "Working…" : null,
      isLoading: false,
      lastError: state.lastError,
    };
  }

  private getPanelTitle(threadId: string, state: ReturnType<ThreadStore["snapshot"]>): string {
    const thread = state.threads.find((summary) => summary.id === threadId);
    return thread?.name ?? thread?.firstUserMessage ?? threadId;
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
      content="default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';"
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

  private async handleMessage(threadId: string, message: WebviewToHostMessage): Promise<void> {
    switch (message.type) {
      case "prompt/submit":
        await this.actions.sendPrompt(threadId, message.text);
        return;
      case "thread/new":
        await this.actions.newThread();
        return;
      case "thread/select":
        await this.actions.selectThread(message.threadId);
        return;
      case "turn/interrupt":
        await this.actions.interrupt(threadId);
        return;
      case "logs/open":
        await this.actions.openLogs();
        return;
    }
  }
}
