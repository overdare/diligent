// @summary Progressive session discovery, bounded history browsing, and runtime preparation
import type {
  Mode as ProtocolMode,
  SessionSummary,
  ThreadHistoryResponse,
  ThreadReadResponse,
} from "@diligent/protocol";
import { DILIGENT_CLIENT_REQUEST_METHODS } from "@diligent/protocol";
import { mergeHistoryItems, mergeSessionSummaries } from "@diligent/runtime/client";
import type { AppServerRpcClient } from "./rpc-client";

export interface ThreadManagerDeps {
  getRpcClient: () => AppServerRpcClient | null;
  getCurrentMode: () => ProtocolMode;
  getCurrentFastMode: () => boolean;
  setCurrentThreadId: (id: string | null) => void;
  updateStatusBar: (updates: { sessionId: string }) => void;
  showHistory?: (history: ThreadHistoryResponse, reset: boolean) => void;
  showProgress?: (message: string) => void;
}

export interface ThreadManager {
  startNewThread: () => Promise<string>;
  resumeThread: (threadId?: string) => Promise<string | null>;
  listThreads: (onBatch?: (threads: SessionSummary[]) => boolean | undefined) => Promise<SessionSummary[]>;
  readThread: () => Promise<ThreadReadResponse | null>;
  readThreadById: (threadId: string) => Promise<ThreadReadResponse | null>;
  loadOlderHistory: () => Promise<void>;
  isReady: () => boolean;
  dispose: () => void;
  deleteThread: (threadId: string) => Promise<boolean>;
}

export function createThreadManager(deps: ThreadManagerDeps): ThreadManager {
  let currentThreadId: string | null = null;
  let generation = 0;
  let ready = false;
  let history: ThreadHistoryResponse | null = null;
  let loadingOlder = false;
  const setThread = (id: string | null) => {
    currentThreadId = id;
    deps.setCurrentThreadId(id);
    if (id) deps.updateStatusBar({ sessionId: id });
  };
  const rpcClient = () => {
    const rpc = deps.getRpcClient();
    if (!rpc) throw new Error("App server is not initialized.");
    return rpc;
  };
  const progress = (message: string) => deps.showProgress?.(message);
  const manager: ThreadManager = {
    isReady: () => ready,
    dispose: () => {
      generation++;
      ready = false;
    },
    async startNewThread() {
      const token = ++generation;
      loadingOlder = false;
      ready = false;
      const rpc = rpcClient();
      try {
        const response = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_START, {
          cwd: process.cwd(),
          mode: deps.getCurrentMode(),
          fastMode: deps.getCurrentFastMode(),
        });
        if (token !== generation) return response.threadId;
        setThread(response.threadId);
        history = { cwd: process.cwd(), items: [] };
        deps.showHistory?.(history, true);
        await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_SUBSCRIBE, { threadId: response.threadId });
        if (token === generation) ready = true;
        return response.threadId;
      } catch (error) {
        if (token === generation) progress(`Unable to start session: ${String(error)}`);
        throw error;
      }
    },
    async resumeThread(threadId) {
      const token = ++generation;
      loadingOlder = false;
      ready = false;
      const rpc = rpcClient();
      progress("Loading session history…");
      try {
        if (!threadId) {
          const threads = await manager.listThreads(() => token === generation);
          if (token !== generation) return null;
          threadId = threads[0]?.id;
          if (!threadId) return manager.startNewThread();
        }
        setThread(threadId);
        const recent = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_HISTORY, { threadId });
        if (token !== generation) return null;
        history = recent;
        deps.showHistory?.(recent, true);
        progress(
          `Preparing session… History is available${recent.nextCursor ? "; /older loads earlier history" : ""}.`,
        );
        // Yield to the renderer before starting potentially expensive runtime restoration.
        const rendered = Promise.withResolvers<void>();
        setTimeout(rendered.resolve, 0);
        await rendered.promise;
        if (token !== generation) return null;
        const response = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_RESUME, { threadId });
        if (token !== generation) return null;
        if (!response.found || !response.threadId) throw new Error(`Session not found: ${threadId}`);
        await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_SUBSCRIBE, { threadId });
        if (token !== generation) return null;
        ready = true;
        progress("Session ready.");
        return threadId;
      } catch (error) {
        if (token === generation) progress(`Unable to open session: ${String(error)}. Use /resume to retry or /new.`);
        return null;
      }
    },
    async listThreads(onBatch) {
      const rpc = rpcClient();
      let threads: SessionSummary[] = [];
      let cursor: string | undefined;
      do {
        const response = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_LIST, { cursor });
        threads = mergeSessionSummaries(threads, response.data);
        if (onBatch?.(threads) === false) break;
        cursor = response.nextCursor;
      } while (cursor);
      return threads;
    },
    async readThread() {
      if (!currentThreadId || !ready) return null;
      const token = generation;
      const response = await rpcClient().request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_READ, {
        threadId: currentThreadId,
        includeItems: false,
      });
      return token === generation ? response : null;
    },
    async readThreadById(threadId) {
      const rpc = deps.getRpcClient();
      if (!rpc) return null;
      return rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_READ, { threadId });
    },
    async loadOlderHistory() {
      const threadId = currentThreadId;
      const previous = history;
      if (!threadId || !previous || loadingOlder) return;
      if (!previous.nextCursor) {
        progress("No earlier history.");
        return;
      }
      const token = generation;
      loadingOlder = true;
      progress("Loading earlier history…");
      try {
        const page = await rpcClient().request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_HISTORY, {
          threadId,
          cursor: previous.nextCursor,
        });
        if (token !== generation) return;
        history = { ...page, items: mergeHistoryItems(page.items, previous.items) };
        const pageIds = new Set(page.items.map((item) => item.itemId));
        deps.showHistory?.({ ...page, items: history.items.filter((item) => pageIds.has(item.itemId)) }, false);
        progress(history.nextCursor ? "Earlier history loaded. /older loads more." : "All history loaded.");
      } catch (error) {
        if (token === generation) progress(`Unable to load earlier history: ${String(error)}. Use /older to retry.`);
      } finally {
        if (token === generation) loadingOlder = false;
      }
    },
    async deleteThread(threadId) {
      const token = generation;
      const response = await rpcClient().request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_DELETE, { threadId });
      if (token === generation && response.deleted && currentThreadId === threadId) {
        await manager.startNewThread();
      }
      return response.deleted;
    },
  };
  return manager;
}
