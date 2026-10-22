// @summary React hook for thread CRUD, switching, and per-thread input state

import { createLogger } from "@diligent/logging";
import type { ModelRef, SessionSummary, ThinkingEffort, ThreadReadResponse } from "@diligent/protocol";
import { DILIGENT_CLIENT_REQUEST_METHODS } from "@diligent/protocol";
import { mergeSessionSummaries } from "@diligent/runtime/client";
import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { type AgentContextItem, getAgentContextItemKey, mergeAgentContextItems } from "./agent-native-bridge";
import type { AppAction } from "./app-state";
import { replaceDraftUrl, replaceThreadUrl } from "./app-utils";
import type { WebRpcClient } from "./rpc-client";
import type { ThreadState } from "./thread-store";

const logger = createLogger({ scope: "web.client.threads" });

export const DRAFT_INPUT_KEY = "__draft__";

export function clearDraftThreadInput(threadInputs: Record<string, string>): Record<string, string> {
  if (!(DRAFT_INPUT_KEY in threadInputs)) {
    return threadInputs;
  }
  const next = { ...threadInputs };
  delete next[DRAFT_INPUT_KEY];
  return next;
}

export function clearDraftThreadContextItems(
  threadContextItems: Record<string, AgentContextItem[]>,
): Record<string, AgentContextItem[]> {
  if (!(DRAFT_INPUT_KEY in threadContextItems)) {
    return threadContextItems;
  }
  const next = { ...threadContextItems };
  delete next[DRAFT_INPUT_KEY];
  return next;
}

export function mergeThreadContextItems(
  threadContextItems: Record<string, AgentContextItem[]>,
  threadKey: string,
  items: AgentContextItem[],
): Record<string, AgentContextItem[]> {
  // An empty incoming list is an explicit clear signal (host/composer reset).
  if (items.length === 0) {
    if (!(threadKey in threadContextItems)) {
      return threadContextItems;
    }
    const next = { ...threadContextItems };
    delete next[threadKey];
    return next;
  }
  // Accumulate incoming selections onto whatever is already attached, deduping by
  // context-item key (e.g. instance GUID) so re-selecting an existing item is a no-op.
  return {
    ...threadContextItems,
    [threadKey]: mergeAgentContextItems(threadContextItems[threadKey] ?? [], items),
  };
}

type ThreadDispatch = (action: AppAction) => void;

type ActiveThreadSubscription = {
  threadId: string;
  subscriptionId: string;
};

export async function switchThreadSubscription({
  rpc,
  activeSubscription,
  threadId,
  activateThreadPrompts,
}: {
  rpc: WebRpcClient;
  activeSubscription: ActiveThreadSubscription | null;
  threadId: string;
  activateThreadPrompts: (threadId: string) => void;
}): Promise<ActiveThreadSubscription> {
  if (activeSubscription?.threadId === threadId) {
    activateThreadPrompts(threadId);
    return activeSubscription;
  }

  if (activeSubscription) {
    try {
      await rpc.unsubscribe(activeSubscription.subscriptionId);
    } catch (error) {
      logger.warn("subscription.unsubscribe_failed", {
        message: "Failed to unsubscribe from previous thread",
        error,
        threadId: activeSubscription.threadId,
        fields: { subscriptionId: activeSubscription.subscriptionId },
      });
    }
  }

  const subscribed = await rpc.subscribe(threadId);
  activateThreadPrompts(threadId);
  return { threadId, subscriptionId: subscribed.subscriptionId };
}

/**
 * Leave the active thread without opening another one — the New conversation and
 * delete-last-thread paths. A draft has no thread id, so activateThreadPrompts never runs for it;
 * shelving here is what stops the previous thread's question/approval UI from staying mounted over
 * the new conversation.
 */
export async function deactivateThreadSubscription({
  rpc,
  activeSubscription,
  shelveThreadPrompts,
}: {
  rpc: WebRpcClient | null;
  activeSubscription: ActiveThreadSubscription | null;
  shelveThreadPrompts: () => void;
}): Promise<void> {
  shelveThreadPrompts();

  if (!rpc || !activeSubscription) return;
  try {
    await rpc.unsubscribe(activeSubscription.subscriptionId);
  } catch (error) {
    logger.warn("subscription.unsubscribe_failed", {
      message: "Failed to unsubscribe from active thread",
      error,
      threadId: activeSubscription.threadId,
      fields: { subscriptionId: activeSubscription.subscriptionId },
    });
  }
}

export function useThreadManager({
  rpcRef,
  dispatch,
  activeThreadIdRef,
  applySessionModel,
  resetDraftModel,
  setEffortState,
  setFastModeState,
  activateThreadPrompts,
  shelveThreadPrompts,
  clearAttention,
  closeModals,
  stateRef,
}: {
  rpcRef: RefObject<WebRpcClient | null>;
  dispatch: ThreadDispatch;
  activeThreadIdRef: RefObject<string | null>;
  applySessionModel: (sessionModel?: ModelRef) => Promise<void>;
  resetDraftModel: () => void;
  setEffortState: (effort: ThinkingEffort) => void;
  setFastModeState: (fastMode: boolean) => void;
  activateThreadPrompts: (threadId: string) => void;
  shelveThreadPrompts: () => void;
  clearAttention: (threadId: string) => void;
  closeModals: () => void;
  stateRef?: RefObject<ThreadState>;
}) {
  const [pendingDeleteThreadId, setPendingDeleteThreadId] = useState<string | null>(null);
  const [threadInputs, setThreadInputs] = useState<Record<string, string>>({});
  const [threadContextItems, setThreadContextItems] = useState<Record<string, AgentContextItem[]>>({});
  const activeSubscriptionRef = useRef<ActiveThreadSubscription | null>(null);
  const [isLoadingThreads, setIsLoadingThreads] = useState(false);
  const [threadListError, setThreadListError] = useState<string | null>(null);
  const listRequestRef = useRef(0);
  const navigationRef = useRef(0);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isPreparingThread, setIsPreparingThread] = useState(false);
  const [isLoadingEarlier, setIsLoadingEarlier] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const earlierRequestRef = useRef(false);
  useEffect(
    () => () => {
      listRequestRef.current++;
      navigationRef.current++;
    },
    [],
  );

  const getNavigationGuard = useCallback(() => {
    const navigation = navigationRef.current;
    const rpc = rpcRef.current;
    return () => navigation === navigationRef.current && rpc === rpcRef.current;
  }, [rpcRef]);

  const updateThreadContextItems = useCallback((threadKey: string, items: AgentContextItem[]): void => {
    setThreadContextItems((prev) => mergeThreadContextItems(prev, threadKey, items));
  }, []);

  const removeThreadContextItem = useCallback((threadKey: string, itemKey: string): void => {
    setThreadContextItems((prev) => {
      const current = prev[threadKey] ?? [];
      const nextItems = current.filter((item) => getAgentContextItemKey(item) !== itemKey);
      if (nextItems.length === current.length) {
        return prev;
      }
      if (nextItems.length === 0) {
        const next = { ...prev };
        delete next[threadKey];
        return next;
      }
      return { ...prev, [threadKey]: nextItems };
    });
  }, []);

  const clearThreadContextItems = useCallback((threadKey: string): void => {
    setThreadContextItems((prev) => {
      if (!(threadKey in prev)) {
        return prev;
      }
      const next = { ...prev };
      delete next[threadKey];
      return next;
    });
  }, []);

  const deactivateServerThread = useCallback(async (): Promise<void> => {
    const activeSubscription = activeSubscriptionRef.current;
    activeSubscriptionRef.current = null;
    await deactivateThreadSubscription({
      rpc: rpcRef.current,
      activeSubscription,
      shelveThreadPrompts,
    });
  }, [rpcRef, shelveThreadPrompts]);

  const activateServerThread = useCallback(
    async (threadId: string): Promise<ThreadReadResponse> => {
      const rpc = rpcRef.current;
      if (!rpc) {
        throw new Error("WebSocket is not connected");
      }

      const navigation = navigationRef.current;
      const subscription = await switchThreadSubscription({
        rpc,
        activeSubscription: activeSubscriptionRef.current,
        threadId,
        activateThreadPrompts: () => {
          if (navigation === navigationRef.current) activateThreadPrompts(threadId);
        },
      });
      if (navigation !== navigationRef.current) {
        void rpc.unsubscribe(subscription.subscriptionId).catch(() => {});
        throw new Error("Conversation selection changed");
      }
      activeSubscriptionRef.current = subscription;
      return rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_READ, { threadId, includeItems: false });
    },
    [rpcRef, activateThreadPrompts],
  );

  const refreshThreadList = useCallback(
    async (rpc = rpcRef.current): Promise<SessionSummary[] | undefined> => {
      if (!rpc) return;
      const requestId = ++listRequestRef.current;
      setIsLoadingThreads(true);
      setThreadListError(null);
      try {
        let cursor: string | undefined;
        let threads: SessionSummary[] = [];
        do {
          const list = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_LIST, { limit: 20, cursor }, null);
          if (requestId !== listRequestRef.current || rpc !== rpcRef.current) return;
          threads = mergeSessionSummaries(threads, list.data);
          dispatch({ type: "set_threads", payload: threads });
          cursor = list.nextCursor;
        } while (cursor);
        return threads;
      } catch (error) {
        if (requestId !== listRequestRef.current || rpc !== rpcRef.current) return;
        setThreadListError("Could not load conversations.");
        logger.error("thread.list_failed", {
          message: "Failed to refresh thread list",
          error,
        });
      } finally {
        if (requestId === listRequestRef.current) setIsLoadingThreads(false);
      }
    },
    [rpcRef, dispatch],
  );

  const startNewThread = useCallback(async (): Promise<void> => {
    navigationRef.current++;
    activeThreadIdRef.current = null;
    setIsLoadingHistory(false);
    setIsPreparingThread(false);
    setIsLoadingEarlier(false);
    earlierRequestRef.current = false;
    setHistoryError(null);
    closeModals();
    void deactivateServerThread();
    dispatch({ type: "reset_draft", payload: { mode: "default" } });
    resetDraftModel();
    if (typeof window !== "undefined") {
      replaceDraftUrl();
    }
  }, [activeThreadIdRef, deactivateServerThread, dispatch, resetDraftModel, closeModals]);

  const openThread = useCallback(
    async (threadId: string): Promise<void> => {
      const rpc = rpcRef.current;
      if (!rpc) return;
      const navigation = ++navigationRef.current;
      const isCurrent = () => navigation === navigationRef.current && rpc === rpcRef.current;
      activeThreadIdRef.current = threadId;
      closeModals();
      void deactivateServerThread();
      setIsLoadingHistory(true);
      setIsPreparingThread(false);
      setIsLoadingEarlier(false);
      earlierRequestRef.current = false;
      setHistoryError(null);
      dispatch({ type: "select_history", payload: { threadId } });
      if (typeof window !== "undefined") replaceThreadUrl(threadId);
      try {
        const page = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_HISTORY, { threadId });
        if (!isCurrent()) return;
        // Commit the bounded transcript before starting potentially slow runtime preparation.
        flushSync(() => {
          dispatch({ type: "history_page", payload: { threadId, page } });
          setIsLoadingHistory(false);
          setIsPreparingThread(true);
        });
        const resumed = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_RESUME, { threadId }, null);
        if (!isCurrent()) return;
        if (!resumed.found) throw new Error("Conversation could not be restored.");
        const history = await activateServerThread(threadId);
        if (!isCurrent()) return;
        await applySessionModel(history.currentModel);
        if (!isCurrent()) return;
        dispatch({ type: "thread_metadata", payload: { threadId, history } });
        setEffortState(history.currentEffort);
        setFastModeState(history.currentFastMode ?? false);
        clearAttention(threadId);
      } catch (error) {
        if (!isCurrent()) return;
        setHistoryError(error instanceof Error ? error.message : "Could not open conversation.");
        logger.error("thread.open_failed", {
          message: "Failed to open thread",
          error,
          threadId,
        });
      } finally {
        if (isCurrent()) {
          setIsLoadingHistory(false);
          setIsPreparingThread(false);
        }
      }
    },
    [
      rpcRef,
      dispatch,
      setEffortState,
      setFastModeState,
      activeThreadIdRef,
      deactivateServerThread,
      applySessionModel,
      clearAttention,
      activateServerThread,
      closeModals,
    ],
  );

  const refreshThreadHistory = useCallback(
    async (threadId: string): Promise<void> => {
      const rpc = rpcRef.current;
      if (!rpc || activeThreadIdRef.current !== threadId || stateRef?.current.runtimeReady === false) return;
      const navigation = navigationRef.current;
      const turnId = stateRef?.current.activeTurnId;
      const isCurrent = () =>
        navigation === navigationRef.current &&
        rpc === rpcRef.current &&
        activeThreadIdRef.current === threadId &&
        stateRef?.current.activeTurnId === turnId;
      try {
        const page = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_HISTORY, { threadId });
        if (!isCurrent()) return;
        const history = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_READ, {
          threadId,
          includeItems: false,
        });
        if (!isCurrent()) return;
        dispatch({ type: "thread_metadata", payload: { threadId, history } });
        dispatch({ type: "history_page", payload: { threadId, page } });
        setHistoryError(null);
      } catch (error) {
        if (isCurrent()) setHistoryError(error instanceof Error ? error.message : "Could not refresh conversation.");
      }
    },
    [rpcRef, activeThreadIdRef, stateRef, dispatch],
  );

  const loadEarlierHistory = useCallback(async (): Promise<void> => {
    const rpc = rpcRef.current;
    const threadId = activeThreadIdRef.current;
    const cursor = stateRef?.current.historyCursor;
    if (!rpc || !threadId || !cursor || earlierRequestRef.current) return;
    const navigation = navigationRef.current;
    earlierRequestRef.current = true;
    setIsLoadingEarlier(true);
    setHistoryError(null);
    try {
      const page = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_HISTORY, { threadId, cursor });
      if (navigation !== navigationRef.current || rpc !== rpcRef.current) return;
      dispatch({ type: "history_page", payload: { threadId, page, older: true } });
    } catch (error) {
      if (navigation === navigationRef.current)
        setHistoryError(error instanceof Error ? error.message : "Could not load earlier messages.");
    } finally {
      if (navigation === navigationRef.current) {
        earlierRequestRef.current = false;
        setIsLoadingEarlier(false);
      }
    }
  }, [rpcRef, activeThreadIdRef, stateRef, dispatch]);

  const confirmDeleteThread = useCallback(async (): Promise<void> => {
    const threadId = pendingDeleteThreadId;
    setPendingDeleteThreadId(null);
    if (!threadId) return;
    const rpc = rpcRef.current;
    if (!rpc) return;
    const navigation = navigationRef.current;
    try {
      await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_DELETE, { threadId });
      if (navigation !== navigationRef.current) return;
      if (activeThreadIdRef.current === threadId) await startNewThread();
      void refreshThreadList(rpc);
    } catch (error) {
      if (navigation !== navigationRef.current) return;
      setHistoryError(error instanceof Error ? error.message : "Could not delete conversation.");
      logger.error("thread.delete_failed", {
        message: "Failed to delete thread",
        error,
        threadId,
      });
    }
  }, [pendingDeleteThreadId, rpcRef, activeThreadIdRef, startNewThread, refreshThreadList]);

  return {
    getNavigationGuard,
    pendingDeleteThreadId,
    setPendingDeleteThreadId,
    threadInputs,
    setThreadInputs,
    threadContextItems,
    setThreadContextItems,
    updateThreadContextItems,
    removeThreadContextItem,
    clearThreadContextItems,
    refreshThreadList,
    isLoadingThreads,
    threadListError,
    isLoadingHistory,
    isPreparingThread,
    isLoadingEarlier,
    historyError,
    loadEarlierHistory,
    refreshThreadHistory,
    startNewThread,
    openThread,
    confirmDeleteThread,
    activateServerThread,
    deactivateServerThread,
  };
}
