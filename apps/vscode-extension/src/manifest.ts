// @summary Shared VS Code extension IDs, commands, and configuration keys for the Diligent VS Code extension
export const EXTENSION_ID = "diligent.vscode";
export const VIEW_CONTAINER_ID = "diligent";
export const THREADS_VIEW_ID = "diligent.threads";
export const CONVERSATION_PANEL_VIEW_TYPE = "diligent.conversationPanel";
export const THREAD_TREE_ITEM_CONTEXT = "diligent.thread";
export const ACTIVE_THREAD_CONTEXT_KEY = "diligent.hasActiveThread";
export const CONNECTION_READY_CONTEXT_KEY = "diligent.connectionReady";
export const CONFIG_KEYS = {
  binaryPath: "diligent.binaryPath",
  serverArgs: "diligent.serverArgs",
} as const;

export const COMMANDS = {
  startServer: "diligent.startServer",
  newThread: "diligent.newThread",
  openConversation: "diligent.openConversation",
  sendPrompt: "diligent.sendPrompt",
  interrupt: "diligent.interrupt",
  refreshThreads: "diligent.refreshThreads",
  openLogs: "diligent.openLogs",
} as const;

export const VIEW_TYPE = {
  treeItem: THREAD_TREE_ITEM_CONTEXT,
} as const;
