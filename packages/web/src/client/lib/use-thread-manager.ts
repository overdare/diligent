// @summary Custom hook managing thread CRUD operations, per-thread input state, and URL sync

import type { Mode, ThreadReadResponse, ThinkingEffort } from "@diligent/protocol";
import { DILIGENT_CLIENT_REQUEST_METHODS } from "@diligent/protocol";
import { useCallback, useState } from "react";
import type { RefObject } from "react";
import type { WebRpcClient } from "./rpc-client";

// ---------------------------------------------------------------------------
// URL ↔ threadId helpers
// ---------------------------------------------------------------------------

/** Extract threadId from the current URL path (e.g. "/abc123" → "abc123"). Returns null if at root. */
export function getThreadIdFromUrl(): string | null {
  const path = window.location.pathname.replace(/^\/+/, "");
  return path || null;
}

/** Push `/{threadId}` into the browser address bar (no reload). */
export function pushThreadUrl(threadId: string): void {
  if (getThreadIdFromUrl() !== threadId) {
    window.history.pushState(null, "", `/${threadId}`);
  }
}

/** Replace current URL with `/{threadId}` (used for initial load so back doesn't double-stack). */
export function replaceThreadUrl(threadId: string): void {
  if (getThreadIdFromUrl() !== threadId) {
    window.history.replaceState(null, "", `/${threadId}`);
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseThreadManagerOptions {
  rpcRef: RefObject<WebRpcClient | null>;
  adapterRef: RefObject<{ reset: () => void }>;
  mode: Mode;
  activeThreadId: string | null;
  cwdRef: RefObject<string>;
  setEffortState: (effort: ThinkingEffort) => void;
  setAttentionThreadIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  activateThread: (threadId: string) => void;
  applySessionModel: (model?: string) => Promise<void>;
  currentModelRef: RefObject<string>;
  refreshThreadList: (rpc?: WebRpcClient) => Promise<void>;
  onHydrate: (threadId: string, mode: Mode, history: ThreadReadResponse) => void;
}

export function useThreadManager({
  rpcRef,
  adapterRef,
  mode,
  activeThreadId,
  cwdRef,
  setEffortState,
  setAttentionThreadIds,
  activateThread,
  applySessionModel,
  currentModelRef,
  refreshThreadList,
  onHydrate,
}: UseThreadManagerOptions) {
  const [threadInputs, setThreadInputs] = useState<Record<string, string>>({});
  const [pendingDeleteThreadId, setPendingDeleteThreadId] = useState<string | null>(null);

  const activeInput = activeThreadId ? (threadInputs[activeThreadId] ?? "") : "";

  const setActiveInput = useCallback(
    (value: string) => {
      const threadId = activeThreadId;
      if (!threadId) return;
      setThreadInputs((prev) => {
        const next = value.length > 0 ? { ...prev, [threadId]: value } : { ...prev };
        if (value.length === 0) delete next[threadId];
        return next;
      });
    },
    [activeThreadId],
  );

  const clearThreadInput = useCallback((threadId: string) => {
    setThreadInputs((prev) => {
      if (!(threadId in prev)) return prev;
      const next = { ...prev };
      delete next[threadId];
      return next;
    });
  }, []);

  const startNewThread = async (): Promise<void> => {
    const rpc = rpcRef.current;
    if (!rpc) return;
    adapterRef.current.reset();
    try {
      const started = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_START, {
        cwd: cwdRef.current || "/",
        mode,
        model: currentModelRef.current || undefined,
      });
      const history = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_READ, { threadId: started.threadId });
      onHydrate(started.threadId, mode, history);
      setEffortState(history.currentEffort);
      pushThreadUrl(started.threadId);
      activateThread(started.threadId);
      await refreshThreadList(rpc);
    } catch (error) {
      console.error(error);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: refs and mutable state are accessed intentionally
  const openThread = useCallback(
    async (threadId: string): Promise<void> => {
      const rpc = rpcRef.current;
      if (!rpc) return;
      adapterRef.current.reset();
      try {
        const resumed = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_RESUME, { threadId });
        if (!resumed.found || !resumed.threadId) return;
        const resumedId = resumed.threadId;
        const history = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_READ, { threadId: resumedId });
        onHydrate(resumedId, mode, history);
        setEffortState(history.currentEffort);
        pushThreadUrl(resumedId);
        await refreshThreadList(rpc);
        await applySessionModel(history.currentModel);

        setAttentionThreadIds((prev) => {
          if (!prev.has(resumedId)) return prev;
          const next = new Set(prev);
          next.delete(resumedId);
          return next;
        });

        activateThread(resumedId);
      } catch (error) {
        console.error(error);
      }
    },
    [mode, onHydrate, setEffortState, refreshThreadList, applySessionModel, setAttentionThreadIds, activateThread],
  );

  const confirmDeleteThread = async (): Promise<void> => {
    const threadId = pendingDeleteThreadId;
    setPendingDeleteThreadId(null);
    if (!threadId) return;
    const rpc = rpcRef.current;
    if (!rpc) return;
    adapterRef.current.reset();
    try {
      await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_DELETE, { threadId });
      if (activeThreadId === threadId) {
        const resumed = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_RESUME, { mostRecent: true });
        if (resumed.found && resumed.threadId) {
          const history = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_READ, {
            threadId: resumed.threadId,
          });
          onHydrate(resumed.threadId, mode, history);
          setEffortState(history.currentEffort);
          replaceThreadUrl(resumed.threadId);
        } else {
          const started = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_START, {
            cwd: cwdRef.current || "/",
            mode,
          });
          const history = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_READ, {
            threadId: started.threadId,
          });
          onHydrate(started.threadId, mode, history);
          setEffortState(history.currentEffort);
          replaceThreadUrl(started.threadId);
        }
      }
      await refreshThreadList(rpc);
    } catch (error) {
      console.error(error);
    }
  };

  return {
    threadInputs,
    pendingDeleteThreadId,
    setPendingDeleteThreadId,
    activeInput,
    setActiveInput,
    clearThreadInput,
    startNewThread,
    openThread,
    confirmDeleteThread,
  };
}
