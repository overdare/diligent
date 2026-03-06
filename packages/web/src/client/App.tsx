// @summary Main application orchestrator: state management, RPC lifecycle, and inline prompt handling

import type { AgentEvent } from "@diligent/core/client";
import { ProtocolNotificationAdapter } from "@diligent/core/client";
import type { DiligentServerNotification, Mode, SessionSummary, ThreadReadResponse } from "@diligent/protocol";
import {
  DILIGENT_CLIENT_NOTIFICATION_METHODS,
  DILIGENT_CLIENT_REQUEST_METHODS,
  DILIGENT_SERVER_NOTIFICATION_METHODS,
  DILIGENT_SERVER_REQUEST_METHODS,
  DILIGENT_VERSION,
} from "@diligent/protocol";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Button } from "./components/Button";
import { InputDock } from "./components/InputDock";
import { MessageList } from "./components/MessageList";
import { Modal } from "./components/Modal";
import { Panel } from "./components/Panel";
import { PlanPanel } from "./components/PlanPanel";
import { ProviderSettingsModal } from "./components/ProviderSettingsModal";
import { Sidebar } from "./components/Sidebar";
import { StatusDot } from "./components/StatusDot";
import { SteeringQueuePanel } from "./components/SteeringQueuePanel";
import { getReconnectAttemptLimit } from "./lib/rpc-client";
import {
  hydrateFromThreadRead,
  initialThreadState,
  type RenderItem,
  reduceServerNotification,
  type ThreadState,
} from "./lib/thread-store";
import { useProviderManager } from "./lib/use-provider-manager";
import { useRpcClient } from "./lib/use-rpc";
import { useServerRequests } from "./lib/use-server-requests";

type AppAction =
  | { type: "notification"; payload: { notification: DiligentServerNotification; events: AgentEvent[] } }
  | { type: "hydrate"; payload: { threadId: string; mode: Mode; history: ThreadReadResponse } }
  | { type: "set_threads"; payload: SessionSummary[] }
  | { type: "set_mode"; payload: Mode }
  | { type: "local_user"; payload: string }
  | { type: "local_steer"; payload: string }
  | { type: "optimistic_thread"; payload: { threadId: string; message: string } }
  | { type: "clear_toast" };

function appReducer(state: ThreadState, action: AppAction): ThreadState {
  if (action.type === "notification")
    return reduceServerNotification(state, action.payload.notification, action.payload.events);
  if (action.type === "hydrate") {
    return hydrateFromThreadRead(
      { ...state, activeThreadId: action.payload.threadId, mode: action.payload.mode },
      action.payload.history,
    );
  }
  if (action.type === "set_mode") return { ...state, mode: action.payload };
  if (action.type === "set_threads") {
    // Merge: preserve optimistic firstUserMessage if the server hasn't persisted it yet
    const optimisticMessages = new Map(
      state.threadList.filter((t) => t.firstUserMessage).map((t) => [t.id, t.firstUserMessage!]),
    );
    const merged = action.payload.map((t) =>
      !t.firstUserMessage && optimisticMessages.has(t.id)
        ? { ...t, firstUserMessage: optimisticMessages.get(t.id) }
        : t,
    );
    return { ...state, threadList: merged };
  }
  if (action.type === "local_user") {
    const userItem: RenderItem = {
      id: `local-user-${Date.now()}`,
      kind: "user",
      text: action.payload,
      timestamp: Date.now(),
    };
    return { ...state, items: [...state.items, userItem] };
  }
  if (action.type === "local_steer") {
    return { ...state, pendingSteers: [...state.pendingSteers, action.payload] };
  }
  if (action.type === "optimistic_thread") {
    const { threadId, message } = action.payload;
    const now = new Date().toISOString();
    const existing = state.threadList.find((t) => t.id === threadId);
    if (existing) {
      // Thread already in list (e.g. empty thread from startNewThread) — update firstUserMessage if missing
      if (existing.firstUserMessage) return state;
      return {
        ...state,
        threadList: state.threadList.map((t) =>
          t.id === threadId ? { ...t, firstUserMessage: message, modified: now } : t,
        ),
      };
    }
    // Thread not yet in list — prepend optimistic entry
    const optimistic: SessionSummary = {
      id: threadId,
      path: "",
      cwd: "",
      created: now,
      modified: now,
      messageCount: 1,
      firstUserMessage: message,
    };
    return { ...state, threadList: [optimistic, ...state.threadList] };
  }
  if (action.type === "clear_toast") return { ...state, toast: null };
  return state;
}

// ---------------------------------------------------------------------------
// URL ↔ threadId helpers
// ---------------------------------------------------------------------------

/** Extract threadId from the current URL path (e.g. "/abc123" → "abc123"). Returns null if at root. */
function getThreadIdFromUrl(): string | null {
  const path = window.location.pathname.replace(/^\/+/, "");
  return path || null;
}

/** Push `/{threadId}` into the browser address bar (no reload). */
function pushThreadUrl(threadId: string): void {
  if (getThreadIdFromUrl() !== threadId) {
    window.history.pushState(null, "", `/${threadId}`);
  }
}

/** Replace current URL with `/{threadId}` (used for initial load so back doesn't double-stack). */
function replaceThreadUrl(threadId: string): void {
  if (getThreadIdFromUrl() !== threadId) {
    window.history.replaceState(null, "", `/${threadId}`);
  }
}

export function App() {
  const wsUrl = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/rpc`;
  const { rpcRef, connection, reconnectAttempts, retryConnection } = useRpcClient(wsUrl);
  const providerMgr = useProviderManager(rpcRef);
  const activeThreadIdRef = useRef<string | null>(null);
  const [state, dispatch] = useReducer(appReducer, initialThreadState);
  const adapterRef = useRef(new ProtocolNotificationAdapter());
  const stateRef = useRef(state);
  stateRef.current = state;
  const [cwd, setCwd] = useState<string>("");
  const [input, setInput] = useState("");
  const [showProviderModal, setShowProviderModal] = useState(false);
  const [focusedProvider, setFocusedProvider] = useState<string | null>(null);
  const [pendingDeleteThreadId, setPendingDeleteThreadId] = useState<string | null>(null);
  const [oauthPending, setOauthPending] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);
  // Threads needing attention (turn completed, approval/user-input buffered while user is elsewhere)
  const [attentionThreadIds, setAttentionThreadIds] = useState<Set<string>>(new Set());

  const markAttention = useCallback((threadId: string) => {
    setAttentionThreadIds((prev) => {
      if (prev.has(threadId)) return prev;
      const next = new Set(prev);
      next.add(threadId);
      return next;
    });
  }, []);

  const serverRequests = useServerRequests(rpcRef, activeThreadIdRef, markAttention);

  // Keep ref in sync so onConnected closure can read latest activeThreadId
  activeThreadIdRef.current = state.activeThreadId;

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
    [rpcRef],
  );

  // Register onConnected, onNotification, onServerRequest on the rpc instance created by useRpcClient.
  // Runs once on mount (all deps are stable useCallbacks). Listeners replace each other on re-registration.
  useEffect(() => {
    const rpc = rpcRef.current;
    if (!rpc) return;

    rpc.onConnected(async (meta) => {
      setCwd(meta.cwd);
      adapterRef.current.reset();
      // Sync model + available models into refs immediately so applySessionModel can use them
      providerMgr.setInitialModel(meta.currentModel ?? "", meta.availableModels);
      try {
        await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.INITIALIZE, {
          clientName: "diligent-web",
          clientVersion: DILIGENT_VERSION,
          protocolVersion: 1,
        });
        rpc.notify(DILIGENT_CLIENT_NOTIFICATION_METHODS.INITIALIZED, { ready: true });

        // 1. On reconnect, resume the previous active thread
        const prevThreadId = activeThreadIdRef.current;
        if (prevThreadId) {
          const resumed = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_RESUME, { threadId: prevThreadId });
          if (resumed.found && resumed.threadId) {
            const history = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_READ, {
              threadId: resumed.threadId,
            });
            dispatch({ type: "hydrate", payload: { threadId: resumed.threadId, mode: meta.mode, history } });
            replaceThreadUrl(resumed.threadId);
            await providerMgr.applySessionModel(history.messages as { role: string; model?: string }[]);
            await refreshThreadList(rpc);
            return;
          }
        }

        // 2. On fresh load, honour the threadId in the URL (e.g. /abc123)
        const urlThreadId = getThreadIdFromUrl();
        if (urlThreadId) {
          const resumed = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_RESUME, { threadId: urlThreadId });
          if (resumed.found && resumed.threadId) {
            const history = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_READ, {
              threadId: resumed.threadId,
            });
            dispatch({ type: "hydrate", payload: { threadId: resumed.threadId, mode: meta.mode, history } });
            replaceThreadUrl(resumed.threadId);
            await providerMgr.applySessionModel(history.messages as { role: string; model?: string }[]);
            await refreshThreadList(rpc);
            return;
          }
          // URL threadId was invalid — fall through to most recent
        }

        // 3. Fall back to the most recent session
        const mostRecent = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_RESUME, { mostRecent: true });
        if (mostRecent.found && mostRecent.threadId) {
          const history = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_READ, {
            threadId: mostRecent.threadId,
          });
          dispatch({ type: "hydrate", payload: { threadId: mostRecent.threadId, mode: meta.mode, history } });
          replaceThreadUrl(mostRecent.threadId);
          await providerMgr.applySessionModel(history.messages as { role: string; model?: string }[]);
          await refreshThreadList(rpc);
          return;
        }

        // 4. No sessions at all — start a new thread
        const started = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_START, {
          cwd: meta.cwd,
          mode: meta.mode,
        });
        const history = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_READ, { threadId: started.threadId });
        dispatch({ type: "hydrate", payload: { threadId: started.threadId, mode: meta.mode, history } });
        replaceThreadUrl(started.threadId);
        await refreshThreadList(rpc);
      } catch (error) {
        console.error(error);
      } finally {
        // Always refresh providers regardless of thread setup outcome
        await providerMgr.refreshProviders(rpc);
      }
    });

    rpc.onNotification((notification: DiligentServerNotification) => {
      if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.ACCOUNT_LOGIN_COMPLETED) {
        const params = notification.params;
        if (params.success) {
          setOauthPending(false);
          setOauthError(null);
        } else {
          setOauthPending(false);
          setOauthError(params.error ?? "OAuth flow failed");
        }
        providerMgr.onAccountLoginCompleted(params);
        return;
      }
      if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.ACCOUNT_UPDATED) {
        void providerMgr.onAccountUpdated(notification.params);
        return;
      }
      // Mark non-active threads as needing attention when their turn completes
      if (
        notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED &&
        "threadId" in notification.params &&
        activeThreadIdRef.current &&
        notification.params.threadId !== activeThreadIdRef.current
      ) {
        markAttention(notification.params.threadId);
      }

      // Refresh sidebar on status changes: busy picks up new sessions, idle picks up completed ones
      if (notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_STATUS_CHANGED) {
        void refreshThreadList(rpc);
        // Re-hydrate if any items are still showing as in-flight (notifications missed during disconnect)
        const params = notification.params as { status?: string };
        if (params.status === "idle") {
          const hasInFlightItems = stateRef.current.items.some(
            (i) =>
              (i.kind === "tool" && i.status === "streaming") ||
              (i.kind === "assistant" && !(i as { thinkingDone: boolean }).thinkingDone),
          );
          if (hasInFlightItems) {
            const threadId = activeThreadIdRef.current;
            if (threadId) {
              console.log("[App] thread/status/changed idle with in-flight items — re-hydrating thread", threadId);
              void rpc
                .request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_READ, { threadId })
                .then((history) => {
                  adapterRef.current.reset();
                  dispatch({ type: "hydrate", payload: { threadId, mode: stateRef.current.mode, history } });
                })
                .catch(console.error);
            }
          }
        }
      }
      const events = adapterRef.current.toAgentEvents(notification);
      dispatch({ type: "notification", payload: { notification, events } });
    });
    rpc.onServerRequest((requestId, request) => serverRequests.handleServerRequest(requestId, request));
    rpc.onServerRequestResolved((requestId) => serverRequests.handleServerRequestResolved(requestId));
  }, [
    refreshThreadList,
    providerMgr.refreshProviders,
    providerMgr.setInitialModel,
    providerMgr.applySessionModel,
    providerMgr.onAccountLoginCompleted,
    providerMgr.onAccountUpdated,
    serverRequests.handleServerRequest,
    serverRequests.handleServerRequestResolved,
    markAttention,
    rpcRef.current,
  ]);

  const startNewThread = async (): Promise<void> => {
    const rpc = rpcRef.current;
    if (!rpc) return;
    adapterRef.current.reset();
    try {
      const started = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_START, {
        cwd: cwd || "/",
        mode: state.mode,
      });
      const history = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_READ, { threadId: started.threadId });
      dispatch({ type: "hydrate", payload: { threadId: started.threadId, mode: state.mode, history } });
      pushThreadUrl(started.threadId);
      serverRequests.activateThread(started.threadId);
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
        dispatch({ type: "hydrate", payload: { threadId: resumedId, mode: state.mode, history } });
        pushThreadUrl(resumedId);
        await refreshThreadList(rpc);
        await providerMgr.applySessionModel(history.messages as { role: string; model?: string }[]);

        // Clear attention marker for this thread
        setAttentionThreadIds((prev) => {
          if (!prev.has(resumedId)) return prev;
          const next = new Set(prev);
          next.delete(resumedId);
          return next;
        });

        // Promote any buffered approval for this thread → shows the approval dialog.
        serverRequests.activateThread(resumedId);
      } catch (error) {
        console.error(error);
      }
    },
    [dispatch, state.mode, providerMgr, serverRequests, refreshThreadList],
  );

  // Handle browser back/forward navigation between threads
  useEffect(() => {
    const handlePopState = () => {
      const urlThreadId = getThreadIdFromUrl();
      if (urlThreadId && urlThreadId !== activeThreadIdRef.current) {
        void openThread(urlThreadId);
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [openThread]);

  // Temporarily disable the browser context menu across the whole web app.
  // Area-specific right-click actions can be attached later on top of this.
  useEffect(() => {
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };
    window.addEventListener("contextmenu", handleContextMenu);
    return () => window.removeEventListener("contextmenu", handleContextMenu);
  }, []);

  useEffect(() => {
    if (!state.toast) return;
    if (state.toast.kind === "error") {
      console.error("[diligent]", state.toast.message);
    }
    if (state.toast.fatal) return;
    const id = setTimeout(() => dispatch({ type: "clear_toast" }), 4000);
    return () => clearTimeout(id);
  }, [state.toast]);

  const isBusy = state.threadStatus === "busy";
  const canSend = input.trim().length > 0 && !isBusy;
  const canSteer = input.trim().length > 0 && isBusy;

  const sendMessage = async () => {
    const rpc = rpcRef.current;
    if (!rpc || !state.activeThreadId || !canSend) return;
    const message = input.trim();
    setInput("");
    dispatch({ type: "local_user", payload: message });
    // If this is the first message in the thread, immediately add an optimistic sidebar entry
    if (state.items.length === 0 && state.activeThreadId) {
      dispatch({ type: "optimistic_thread", payload: { threadId: state.activeThreadId, message } });
    }
    try {
      await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.TURN_START, { threadId: state.activeThreadId, message });
    } catch (error) {
      console.error(error);
    }
  };

  const steerMessage = async () => {
    const rpc = rpcRef.current;
    if (!rpc || !state.activeThreadId || !canSteer) return;
    const content = input.trim();
    setInput("");
    dispatch({ type: "local_steer", payload: content });
    try {
      await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.TURN_STEER, {
        threadId: state.activeThreadId,
        content,
        followUp: false,
      });
    } catch (error) {
      console.error(error);
    }
  };

  const confirmDeleteThread = async (): Promise<void> => {
    const threadId = pendingDeleteThreadId;
    setPendingDeleteThreadId(null);
    if (!threadId) return;
    const rpc = rpcRef.current;
    if (!rpc) return;
    adapterRef.current.reset();
    try {
      await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_DELETE, { threadId });
      // If the deleted thread was active, switch to most recent or start new
      if (state.activeThreadId === threadId) {
        const resumed = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_RESUME, { mostRecent: true });
        if (resumed.found && resumed.threadId) {
          const history = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_READ, {
            threadId: resumed.threadId,
          });
          dispatch({ type: "hydrate", payload: { threadId: resumed.threadId, mode: state.mode, history } });
          replaceThreadUrl(resumed.threadId);
        } else {
          const started = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_START, {
            cwd: cwd || "/",
            mode: state.mode,
          });
          const history = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_READ, {
            threadId: started.threadId,
          });
          dispatch({ type: "hydrate", payload: { threadId: started.threadId, mode: state.mode, history } });
          replaceThreadUrl(started.threadId);
        }
      }
      await refreshThreadList(rpc);
    } catch (error) {
      console.error(error);
    }
  };

  const interruptTurn = async () => {
    const rpc = rpcRef.current;
    if (!rpc || !state.activeThreadId) return;
    console.log("[App] Stop pressed — sending turn/interrupt for thread", state.activeThreadId);
    try {
      const result = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.TURN_INTERRUPT, {
        threadId: state.activeThreadId,
      });
      console.log("[App] turn/interrupt response:", result);
    } catch (error) {
      console.error("[App] turn/interrupt failed:", error);
    }
  };

  const setMode = async (mode: Mode) => {
    const rpc = rpcRef.current;
    if (!rpc || !state.activeThreadId) return;
    await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.MODE_SET, { threadId: state.activeThreadId, mode });
    dispatch({ type: "set_mode", payload: mode });
  };

  const threadTitle = useMemo(() => {
    const active = state.threadList.find((t) => t.id === state.activeThreadId);
    const raw = active?.firstUserMessage ?? state.items.find((i) => i.kind === "user")?.text ?? "";
    return raw.length > 40 ? `${raw.slice(0, 40)}…` : raw;
  }, [state.activeThreadId, state.threadList, state.items]);

  const statusDotColor: "success" | "accent" | "danger" =
    state.threadStatus === "idle" ? "success" : state.threadStatus === "busy" ? "accent" : "danger";
  const statusDotPulse = state.threadStatus !== "idle";

  const showPlan = state.planState?.steps.some((s) => !s.done);

  const showConnectionModal = connection === "reconnecting" || (connection === "disconnected" && reconnectAttempts > 0);
  const retryLimit = getReconnectAttemptLimit();

  return (
    <div className="h-screen bg-bg text-text">
      <div className="mx-auto grid h-full max-w-app grid-cols-1 gap-2 p-2 lg:grid-cols-[280px_1fr]">
        <Sidebar
          cwd={cwd}
          threadList={state.threadList}
          activeThreadId={state.activeThreadId}
          attentionThreadIds={attentionThreadIds}
          onNewThread={() => void startNewThread()}
          onOpenThread={(id) => void openThread(id)}
          onDeleteThread={(id) => setPendingDeleteThreadId(id)}
          providers={providerMgr.providers}
          onOpenProviders={(p) => {
            setFocusedProvider(p ?? null);
            setShowProviderModal(true);
          }}
        />

        <Panel className="flex min-h-0 flex-col overflow-hidden">
          {/* Thread title bar */}
          <div className="flex shrink-0 items-center gap-2.5 border-b border-text/10 px-4 py-2.5">
            <StatusDot color={statusDotColor} pulse={statusDotPulse} size="md" />
            {state.threadStatus !== "idle" && (
              <span
                className={`shrink-0 font-mono text-xs ${state.threadStatus === "busy" ? "text-accent" : "text-danger"}`}
              >
                {state.threadStatus === "busy" ? "Running..." : state.threadStatus}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted">
              {threadTitle || "new conversation"}
            </span>
          </div>

          <MessageList
            items={state.items}
            threadStatus={state.threadStatus}
            onSelectPrompt={(p) => setInput(p)}
            approvalPrompt={
              serverRequests.approvalPrompt?.request.method === DILIGENT_SERVER_REQUEST_METHODS.APPROVAL_REQUEST
                ? {
                    request: serverRequests.approvalPrompt.request.params.request,
                    onDecide: serverRequests.resolveApproval,
                  }
                : null
            }
            questionPrompt={
              serverRequests.questionPrompt
                ? {
                    request: serverRequests.questionPrompt.request,
                    answers: serverRequests.answers,
                    onAnswerChange: (id, val) => serverRequests.setAnswers((prev) => ({ ...prev, [id]: val })),
                    onSubmit: () => serverRequests.resolveQuestion(serverRequests.answers),
                    onCancel: () => serverRequests.resolveQuestion({}),
                  }
                : null
            }
          />

          {showPlan && <PlanPanel planState={state.planState!} />}

          <SteeringQueuePanel pendingSteers={state.pendingSteers} />

          <InputDock
            input={input}
            onInputChange={setInput}
            onSend={() => void sendMessage()}
            onSteer={() => void steerMessage()}
            onInterrupt={() => void interruptTurn()}
            canSend={canSend}
            canSteer={canSteer}
            threadStatus={state.threadStatus}
            connection={connection}
            cwd={cwd}
            mode={state.mode}
            onModeChange={(m) => void setMode(m)}
            currentModel={providerMgr.currentModel}
            availableModels={providerMgr.availableModels}
            onModelChange={(m) => void providerMgr.changeModel(m)}
            usage={state.usage}
            currentContextTokens={state.currentContextTokens}
            contextWindow={
              providerMgr.availableModels.find((m) => m.id === providerMgr.currentModel)?.contextWindow ?? 0
            }
            hasProvider={providerMgr.providers.some((p) => p.configured || p.oauthConnected)}
            onOpenProviders={() => setShowProviderModal(true)}
          />
        </Panel>
      </div>

      {state.toast ? (
        <div
          className={`toast-animate fixed bottom-12 left-1/2 -translate-x-1/2 rounded-md border px-3 py-2 text-sm shadow-panel ${
            state.toast.kind === "error"
              ? "border-danger/40 bg-surface text-danger"
              : "border-accent/40 bg-surface text-accent"
          } ${state.toast.fatal ? "cursor-pointer" : ""}`}
          onClick={state.toast.fatal ? () => dispatch({ type: "clear_toast" }) : undefined}
        >
          {state.toast.message}
          {state.toast.fatal && <span className="ml-2 opacity-50">×</span>}
        </div>
      ) : null}

      {showProviderModal ? (
        <ProviderSettingsModal
          providers={providerMgr.providers}
          focusProvider={focusedProvider ?? undefined}
          oauthPending={oauthPending}
          oauthError={oauthError}
          onSet={providerMgr.handleSetProviderKey}
          onRemove={providerMgr.handleRemoveProviderKey}
          onOAuthStart={async () => {
            setOauthPending(true);
            setOauthError(null);
            return providerMgr.handleOAuthStart();
          }}
          onClose={() => {
            setShowProviderModal(false);
            setFocusedProvider(null);
            setOauthError(null);
          }}
        />
      ) : null}

      {pendingDeleteThreadId ? (
        <Modal
          title="Delete conversation?"
          description="This will permanently delete the conversation file. This action cannot be undone."
          onCancel={() => setPendingDeleteThreadId(null)}
          onConfirm={() => void confirmDeleteThread()}
        >
          <div className="flex items-center justify-end gap-2">
            <Button intent="ghost" size="sm" onClick={() => setPendingDeleteThreadId(null)}>
              Cancel
            </Button>
            <Button intent="danger" size="sm" onClick={() => void confirmDeleteThread()}>
              Delete
            </Button>
          </div>
        </Modal>
      ) : null}

      {showConnectionModal ? (
        <Modal
          title={connection === "reconnecting" ? "Connection lost" : "Reconnect failed"}
          description={
            connection === "reconnecting"
              ? `WebSocket disconnected. Retrying... (${Math.min(reconnectAttempts, retryLimit)}/${retryLimit})`
              : `Automatic retry stopped after ${retryLimit} attempts.`
          }
          onConfirm={connection === "disconnected" ? retryConnection : undefined}
        >
          {connection === "reconnecting" ? (
            <div className="text-sm text-muted">Please wait while we restore the session.</div>
          ) : (
            <div className="flex items-center justify-end gap-2">
              <Button intent="ghost" size="sm" onClick={retryConnection}>
                Retry now
              </Button>
            </div>
          )}
        </Modal>
      ) : null}
    </div>
  );
}
