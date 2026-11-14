// @summary Native VS Code tree provider for Diligent thread summaries and active-thread selection
import type { SessionSummary } from "@diligent/protocol";
import * as vscode from "vscode";
import { THREAD_TREE_ITEM_CONTEXT } from "../manifest";
import type { ExtensionThreadState } from "../state/thread-store";

export class ThreadTreeItem extends vscode.TreeItem {
  constructor(
    readonly summary: SessionSummary,
    isActive: boolean,
  ) {
    super(summary.name ?? summary.firstUserMessage ?? summary.id, vscode.TreeItemCollapsibleState.None);
    this.description = isActive ? "active" : new Date(summary.modified).toLocaleString();
    this.tooltip = `${summary.cwd}\n${summary.path}`;
    this.contextValue = THREAD_TREE_ITEM_CONTEXT;
    this.command = {
      command: "diligent.openConversation",
      title: "Open Thread",
      arguments: [summary.id],
    };
  }
}

export class ThreadTreeProvider implements vscode.TreeDataProvider<ThreadTreeItem> {
  private state: ExtensionThreadState | null = null;
  private readonly emitter = new vscode.EventEmitter<ThreadTreeItem | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  refresh(state: ExtensionThreadState): void {
    this.state = state;
    this.emitter.fire();
  }

  getTreeItem(element: ThreadTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): Thenable<ThreadTreeItem[]> {
    const state = this.state;
    if (!state) {
      return Promise.resolve([]);
    }
    return Promise.resolve(
      state.threads.map((summary) => new ThreadTreeItem(summary, summary.id === state.focusedThreadId)),
    );
  }
}
