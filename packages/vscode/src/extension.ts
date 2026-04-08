// @summary VS Code extension activation wiring for Diligent thread tree, conversation webview, and app-server session
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  ACTIVE_THREAD_CONTEXT_KEY,
  COMMANDS,
  CONFIG_KEYS,
  CONNECTION_READY_CONTEXT_KEY,
  CONVERSATION_VIEW_ID,
  THREADS_VIEW_ID,
} from "./manifest";
import { buildDiligentCommand, DiligentProcess } from "./runtime/diligent-process";
import { ThreadSession } from "./runtime/thread-session";
import { resolveApprovalRequest } from "./server-requests/approval";
import { resolveUserInputRequest } from "./server-requests/user-input";
import { ThreadStore } from "./state/thread-store";
import { ConversationViewProvider } from "./views/conversation-view-provider";
import { ThreadTreeProvider } from "./views/thread-tree-provider";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const store = new ThreadStore();
  const logs: string[] = [];
  const threadTreeProvider = new ThreadTreeProvider();
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? globalThis.process.cwd();
  const diligentProcess = new DiligentProcess();

  const config = vscode.workspace.getConfiguration();
  const binaryPath = config.get<string>(CONFIG_KEYS.binaryPath, "diligent");
  const extraArgs = config.get<string[]>(CONFIG_KEYS.serverArgs, []);
  const processOptions = {
    cwd: workspaceFolder,
    ...buildDiligentCommand({ binaryPath, extraArgs }),
  };

  const conversationProvider = new ConversationViewProvider(context, store, {
    async sendPrompt(text) {
      await ensureStarted();
      await session.sendPrompt(text);
    },
    async newThread() {
      await ensureStarted();
      const threadId = await session.createThread();
      await loadThread(threadId);
    },
    async selectThread(threadId) {
      await ensureStarted();
      await loadThread(threadId);
    },
    async interrupt() {
      await ensureStarted();
      await session.interrupt();
    },
    async openLogs() {
      await openLogsDocument(logs);
    },
  });

  const session = new ThreadSession(
    diligentProcess,
    store,
    {
      cwd: workspaceFolder,
      processOptions,
    },
    {
      approvalRequest: resolveApprovalRequest,
      userInputRequest: resolveUserInputRequest,
    },
    (notification) => {
      conversationProvider.postThreadEvent(notification);
      if (notification.method === "thread/started") {
        void loadThread(notification.params.threadId);
      }
    },
    (line) => {
      logs.push(line);
    },
  );

  const ensureStarted = async () => {
    if (store.snapshot().connection === "ready") {
      return;
    }
    try {
      await session.start();
      await session.refreshThreads();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      store.setConnection("error", message);
      conversationProvider.postError(message);
      throw error;
    }
  };

  const loadThread = async (threadId: string) => {
    const read = await session.selectThread(threadId);
    conversationProvider.postThreadRead(read);
    await session.refreshThreads();
  };

  store.subscribe((state) => {
    threadTreeProvider.refresh(state);
    void vscode.commands.executeCommand("setContext", ACTIVE_THREAD_CONTEXT_KEY, Boolean(state.activeThreadId));
    void vscode.commands.executeCommand("setContext", CONNECTION_READY_CONTEXT_KEY, state.connection === "ready");
    conversationProvider.postConnectionStatus(state.connection);
  });

  const treeView = vscode.window.createTreeView(THREADS_VIEW_ID, { treeDataProvider: threadTreeProvider });
  treeView.onDidChangeSelection((event) => {
    const item = event.selection[0];
    if (item) {
      void loadThread(item.summary.id);
    }
  });

  context.subscriptions.push(
    treeView,
    vscode.window.registerWebviewViewProvider(CONVERSATION_VIEW_ID, conversationProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand(COMMANDS.startServer, async () => {
      await ensureStarted();
      vscode.window.showInformationMessage("Diligent server is ready.");
    }),
    vscode.commands.registerCommand(COMMANDS.newThread, async () => {
      await ensureStarted();
      const threadId = await session.createThread();
      await loadThread(threadId);
    }),
    vscode.commands.registerCommand(COMMANDS.sendPrompt, async (threadId?: string) => {
      await ensureStarted();
      if (threadId) {
        await loadThread(threadId);
      }
      const text = await vscode.window.showInputBox({ prompt: "Send a prompt to Diligent" });
      if (!text?.trim()) {
        return;
      }
      await session.sendPrompt(text.trim());
    }),
    vscode.commands.registerCommand(COMMANDS.interrupt, async () => {
      await ensureStarted();
      const interrupted = await session.interrupt();
      if (interrupted) {
        vscode.window.showInformationMessage("Diligent turn interrupted.");
      }
    }),
    vscode.commands.registerCommand(COMMANDS.refreshThreads, async () => {
      await ensureStarted();
      await session.refreshThreads();
    }),
    vscode.commands.registerCommand(COMMANDS.openLogs, async () => {
      await openLogsDocument(logs);
    }),
    new vscode.Disposable(() => {
      void session.dispose();
    }),
  );
}

export function deactivate(): void {}

async function openLogsDocument(lines: string[]): Promise<void> {
  const tempPath = path.join(os.tmpdir(), `diligent-vscode-${Date.now()}.log`);
  await fs.writeFile(tempPath, lines.join("\n"), "utf8");
  const document = await vscode.workspace.openTextDocument(tempPath);
  await vscode.window.showTextDocument(document, { preview: false });
}
