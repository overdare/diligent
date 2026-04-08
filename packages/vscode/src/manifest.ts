// @summary Shared VS Code extension IDs, commands, and configuration keys for the Diligent sidebar
export const EXTENSION_ID = "diligent.vscode";
export const VIEW_CONTAINER_ID = "diligent";
export const THREADS_VIEW_ID = "diligent.threads";
export const CONVERSATION_VIEW_ID = "diligent.conversation";
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
  sendPrompt: "diligent.sendPrompt",
  interrupt: "diligent.interrupt",
  refreshThreads: "diligent.refreshThreads",
  openLogs: "diligent.openLogs",
} as const;

export const VIEW_TYPE = {
  treeItem: THREAD_TREE_ITEM_CONTEXT,
} as const;
