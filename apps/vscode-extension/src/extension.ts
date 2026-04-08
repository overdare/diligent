// @summary VS Code extension activation wiring for Diligent thread tree, editor-area conversation panels, and app-server session
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { ProtocolNotificationAdapter } from "@diligent/protocol";
import * as vscode from "vscode";
import {
  ACTIVE_THREAD_CONTEXT_KEY,
  COMMANDS,
  CONFIG_KEYS,
  CONNECTION_READY_CONTEXT_KEY,
  THREADS_VIEW_ID,
} from "./manifest";
import { buildDiligentCommand, DiligentProcess } from "./runtime/diligent-process";
import { ThreadSession } from "./runtime/thread-session";
import { resolveApprovalRequest } from "./server-requests/approval";
import { resolveUserInputRequest } from "./server-requests/user-input";
import { ThreadStore } from "./state/thread-store";
import { ConversationPanelManager } from "./views/conversation-panel-manager";
import { ThreadTreeProvider } from "./views/thread-tree-provider";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const store = new ThreadStore();
  const logs: string[] = [];
  const threadTreeProvider = new ThreadTreeProvider();
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? globalThis.process.cwd();
  const diligentProcess = new DiligentProcess();
  const notificationAdapters = new Map<string, ProtocolNotificationAdapter>();

  const config = vscode.workspace.getConfiguration();
  const binaryPath = config.get<string>(CONFIG_KEYS.binaryPath, "diligent");
  const extraArgs = config.get<string[]>(CONFIG_KEYS.serverArgs, []);
  const processOptions = {
    cwd: workspaceFolder,
    ...buildDiligentCommand({ binaryPath, extraArgs }),
  };

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
      const threadId = getNotificationThreadId(notification);
      if (threadId) {
        const adapter = getNotificationAdapter(threadId);
        const events = adapter.toAgentEvents(notification);
        panelManager.postAgentEvents(threadId, events);
        if (notification.method === "turn/completed" || notification.method === "turn/interrupted") {
          adapter.reset();
        }
      }

      if (notification.method === "thread/started") {
        void session.refreshThreads();
        return;
      }
      if (threadId && panelManager.hasPanel(threadId)) {
        scheduleThreadRefresh(threadId);
      }
    },
    (line) => {
      logs.push(line);
    },
  );

  const panelManager = new ConversationPanelManager(context, store, {
    async sendPrompt(threadId, text) {
      await ensureStarted();
      const targetThreadId = await session.sendPrompt(text, threadId);
      panelManager.openThread(targetThreadId);
    },
    async newThread() {
      await createAndOpenThread();
    },
    async selectThread(threadId) {
      await openConversation(threadId);
    },
    focusThread(threadId) {
      store.setActiveThread(threadId);
    },
    async interrupt(threadId) {
      await ensureStarted();
      await session.interrupt(threadId);
    },
    async openLogs() {
      await openLogsDocument(logs);
    },
  });

  const threadRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const threadRefreshInFlight = new Map<string, Promise<void>>();
  let startPromise: Promise<void> | null = null;

  const scheduleThreadRefresh = (threadId: string) => {
    const existingTimer = threadRefreshTimers.get(threadId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      threadRefreshTimers.delete(threadId);
      if (threadRefreshInFlight.has(threadId)) {
        return;
      }

      const refreshPromise = (async () => {
        try {
          const read = await session.readThread(threadId);
          if (read) {
            panelManager.postThreadRead(threadId, read);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          store.setLastError(message);
        } finally {
          threadRefreshInFlight.delete(threadId);
        }
      })();
      threadRefreshInFlight.set(threadId, refreshPromise);
    }, 40);

    threadRefreshTimers.set(threadId, timer);
  };

  const getNotificationAdapter = (threadId: string) => {
    const existing = notificationAdapters.get(threadId);
    if (existing) {
      return existing;
    }

    const adapter = new ProtocolNotificationAdapter();
    notificationAdapters.set(threadId, adapter);
    return adapter;
  };

  const ensureStarted = async () => {
    if (store.snapshot().connection === "ready") {
      return;
    }
    if (startPromise) {
      await startPromise;
      return;
    }

    startPromise = (async () => {
      try {
        await session.start();
        await session.refreshThreads();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        store.setConnection("error", message);
        throw error;
      } finally {
        startPromise = null;
      }
    })();

    await startPromise;
  };

  const loadThread = async (threadId: string) => {
    const read = await session.selectThread(threadId);
    panelManager.postThreadRead(threadId, read);
    await session.refreshThreads();
    return read;
  };

  const openConversation = async (threadId: string) => {
    await ensureStarted();
    panelManager.openThread(threadId);
    await loadThread(threadId);
  };

  const createAndOpenThread = async () => {
    await ensureStarted();
    const threadId = await session.createThread();
    panelManager.openThread(threadId);
    return threadId;
  };

  store.subscribe((state) => {
    threadTreeProvider.refresh(state);
    void vscode.commands.executeCommand("setContext", ACTIVE_THREAD_CONTEXT_KEY, Boolean(state.activeThreadId));
    void vscode.commands.executeCommand("setContext", CONNECTION_READY_CONTEXT_KEY, state.connection === "ready");
  });

  const treeView = vscode.window.createTreeView(THREADS_VIEW_ID, { treeDataProvider: threadTreeProvider });
  void ensureStarted();

  treeView.onDidChangeSelection((event) => {
    const item = event.selection[0];
    if (item) {
      void openConversation(item.summary.id);
    }
  });
  treeView.onDidChangeVisibility((event) => {
    if (event.visible) {
      void ensureStarted();
    }
  });

  context.subscriptions.push(
    treeView,
    panelManager,
    vscode.commands.registerCommand(COMMANDS.startServer, async () => {
      await ensureStarted();
      vscode.window.showInformationMessage("Diligent server is ready.");
    }),
    vscode.commands.registerCommand(COMMANDS.newThread, async () => {
      await createAndOpenThread();
    }),
    vscode.commands.registerCommand(COMMANDS.openConversation, async (threadId?: string) => {
      await ensureStarted();
      const targetThreadId = threadId ?? store.snapshot().activeThreadId;
      if (!targetThreadId) {
        await createAndOpenThread();
        return;
      }
      await openConversation(targetThreadId);
    }),
    vscode.commands.registerCommand(COMMANDS.sendPrompt, async (threadId?: string) => {
      await ensureStarted();
      if (threadId) {
        await openConversation(threadId);
      }
      const text = await vscode.window.showInputBox({ prompt: "Send a prompt to Diligent" });
      if (!text?.trim()) {
        return;
      }
      const targetThreadId = await session.sendPrompt(text.trim(), threadId);
      panelManager.openThread(targetThreadId);
    }),
    vscode.commands.registerCommand(COMMANDS.interrupt, async (threadId?: string) => {
      await ensureStarted();
      const interrupted = await session.interrupt(threadId);
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
      for (const timer of threadRefreshTimers.values()) {
        clearTimeout(timer);
      }
      notificationAdapters.clear();
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

function getNotificationThreadId(notification: { method: string; params?: unknown }): string | null {
  const params = notification.params;
  if (!params || typeof params !== "object") {
    return null;
  }

  const threadId = (params as { threadId?: unknown }).threadId;
  return typeof threadId === "string" && threadId.length > 0 ? threadId : null;
}
