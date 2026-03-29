// @summary React hook for thread CRUD, switching, and per-thread input state

import type { Mode, SessionSummary, ThinkingEffort, ThreadReadResponse } from "@diligent/protocol";
import { DILIGENT_CLIENT_REQUEST_METHODS } from "@diligent/protocol";
import type { RefObject } from "react";
import { useCallback, useRef, useState } from "react";
import { replaceDraftUrl, replaceThreadUrl } from "./app-utils";
import type { WebRpcClient } from "./rpc-client";

export const DRAFT_INPUT_KEY = "__draft__";

export function clearDraftThreadInput(threadInputs: Record<string, string>): Record<string, string> {
  if (!(DRAFT_INPUT_KEY in threadInputs)) {
    return threadInputs;
  }
  const next = { ...threadInputs };
  delete next[DRAFT_INPUT_KEY];
  return next;
}

type ThreadHydrateAction = {
  type: "hydrate";
  payload: { threadId: string; mode: Mode; history: ThreadReadResponse };
};
type ThreadResetDraftAction = { type: "reset_draft"; payload: { mode: Mode } };
type ThreadSetAction = { type: "set_threads"; payload: SessionSummary[] };
type ThreadDispatch = (action: ThreadHydrateAction | ThreadResetDraftAction | ThreadSetAction) => void;

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
      console.error(error);
    }
  }

  const subscribed = await rpc.subscribe(threadId);
  activateThreadPrompts(threadId);
  return { threadId, subscriptionId: subscribed.subscriptionId };
}

export function useThreadManager({
  rpcRef,
  dispatch,
  activeThreadIdRef,
  modeRef,
  applySessionModel,
  resetDraftModel,
  setEffortState,
  activateThreadPrompts,
  clearAttention,
  closeModals,
}: {
  rpcRef: RefObject<WebRpcClient | null>;
  dispatch: ThreadDispatch;
  activeThreadIdRef: RefObject<string | null>;
  modeRef: RefObject<Mode>;
  applySessionModel: (sessionModel?: string) => Promise<void>;
  resetDraftModel: () => void;
  setEffortState: (effort: ThinkingEffort) => void;
  activateThreadPrompts: (threadId: string) => void;
  clearAttention: (threadId: string) => void;
  closeModals: () => void;
}) {
  const [pendingDeleteThreadId, setPendingDeleteThreadId] = useState<string | null>(null);
  const [threadInputs, setThreadInputs] = useState<Record<string, string>>({});
  const activeSubscriptionRef = useRef<ActiveThreadSubscription | null>(null);

  const deactivateServerThread = useCallback(async (): Promise<void> => {
    const rpc = rpcRef.current;
    const activeSubscription = activeSubscriptionRef.current;
    activeSubscriptionRef.current = null;
    if (!rpc || !activeSubscription) return;
    try {
      await rpc.unsubscribe(activeSubscription.subscriptionId);
    } catch (error) {
      console.error(error);
    }
  }, [rpcRef]);

  const activateServerThread = useCallback(
    async (threadId: string): Promise<ThreadReadResponse> => {
      const rpc = rpcRef.current;
      if (!rpc) {
        throw new Error("WebSocket is not connected");
      }

      activeSubscriptionRef.current = await switchThreadSubscription({
        rpc,
        activeSubscription: activeSubscriptionRef.current,
        threadId,
        activateThreadPrompts,
      });

      return rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_READ, { threadId });
    },
    [rpcRef, activateThreadPrompts],
  );

  const refreshThreadList = useCallback(
    async (rpc = rpcRef.current): Promise<void> => {
      if (!rpc) return;
      try {
        const list = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_LIST, { limit: 100 });
        dispatch({ type: "set_threads", payload: list.data });
      } catch (error) {
        console.error(error);
      }
    },
    [rpcRef, dispatch],
  );

  const startNewThread = useCallback(async (): Promise<void> => {
    closeModals();
    await deactivateServerThread();
    const mode = modeRef.current;
    dispatch({ type: "reset_draft", payload: { mode } });
    resetDraftModel();
    setEffortState("medium");
    if (typeof window !== "undefined") {
      replaceDraftUrl();
    }
  }, [deactivateServerThread, dispatch, modeRef, resetDraftModel, setEffortState, closeModals]);

  const openThread = useCallback(
    async (threadId: string): Promise<void> => {
      const rpc = rpcRef.current;
      if (!rpc) return;
      closeModals();
      const mode = modeRef.current;
      try {
        const resumed = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_RESUME, { threadId });
        if (!resumed.found || !resumed.threadId) return;
        const resumedId = resumed.threadId;
        const history = await activateServerThread(resumedId);

        dispatch({ type: "hydrate", payload: { threadId: resumedId, mode, history } });
        setEffortState(history.currentEffort);
        if (typeof window !== "undefined") {
          replaceThreadUrl(resumedId);
        }
        await refreshThreadList(rpc);
        await applySessionModel(history.currentModel);
        clearAttention(resumedId);
      } catch (error) {
        console.error(error);
      }
    },
    [
      rpcRef,
      modeRef,
      dispatch,
      setEffortState,
      refreshThreadList,
      applySessionModel,
      clearAttention,
      activateServerThread,
      closeModals,
    ],
  );

  const confirmDeleteThread = useCallback(async (): Promise<void> => {
    const threadId = pendingDeleteThreadId;
    setPendingDeleteThreadId(null);
    if (!threadId) return;
    const rpc = rpcRef.current;
    if (!rpc) return;
    const mode = modeRef.current;
    const activeThreadId = activeThreadIdRef.current;
    try {
      await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_DELETE, { threadId });
      if (activeThreadId === threadId) {
        const resumed = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_RESUME, { mostRecent: true });
        if (resumed.found && resumed.threadId) {
          const history = await activateServerThread(resumed.threadId);
          dispatch({ type: "hydrate", payload: { threadId: resumed.threadId, mode, history } });
          setEffortState(history.currentEffort);
          if (typeof window !== "undefined") {
            replaceThreadUrl(resumed.threadId);
          }
        } else {
          await deactivateServerThread();
          dispatch({ type: "reset_draft", payload: { mode } });
          resetDraftModel();
          setEffortState("medium");
          if (typeof window !== "undefined") {
            replaceDraftUrl();
          }
        }
      }
      await refreshThreadList(rpc);
    } catch (error) {
      console.error(error);
    }
  }, [
    pendingDeleteThreadId,
    rpcRef,
    modeRef,
    activeThreadIdRef,
    dispatch,
    resetDraftModel,
    setEffortState,
    refreshThreadList,
    activateServerThread,
    deactivateServerThread,
  ]);

  return {
    pendingDeleteThreadId,
    setPendingDeleteThreadId,
    threadInputs,
    setThreadInputs,
    refreshThreadList,
    startNewThread,
    openThread,
    confirmDeleteThread,
    activateServerThread,
    deactivateServerThread,
  };
}
