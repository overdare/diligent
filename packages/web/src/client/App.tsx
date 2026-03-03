// @summary Main application orchestrator: state management, RPC lifecycle, and inline prompt handling

import type { DiligentServerNotification, Mode, SessionSummary, ThreadReadResponse } from "@diligent/protocol";
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
  | { type: "notification"; payload: Parameters<typeof reduceServerNotification>[1] }
  | { type: "hydrate"; payload: { threadId: string; mode: Mode; history: ThreadReadResponse } }
  | { type: "set_threads"; payload: SessionSummary[] }
  | { type: "set_mode"; payload: Mode }
  | { type: "local_user"; payload: string }
  | { type: "clear_toast" };

function appReducer(state: ThreadState, action: AppAction): ThreadState {
  if (action.type === "notification") return reduceServerNotification(state, action.payload);
  if (action.type === "hydrate") {
    return hydrateFromThreadRead(
      { ...state, activeThreadId: action.payload.threadId, mode: action.payload.mode },
      action.payload.history,
    );
  }
  if (action.type === "set_mode") return { ...state, mode: action.payload };
  if (action.type === "set_threads") return { ...state, threadList: action.payload };
  if (action.type === "local_user") {
    const userItem: RenderItem = {
      id: `local-user-${Date.now()}`,
      kind: "user",
      text: action.payload,
      timestamp: Date.now(),
    };
    return { ...state, items: [...state.items, userItem] };
  }
  if (action.type === "clear_toast") return { ...state, toast: null };
  return state;
}

export function App() {
  const wsUrl = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/rpc`;
  const { rpcRef, connection, reconnectAttempts, retryConnection } = useRpcClient(wsUrl);
  const providerMgr = useProviderManager(rpcRef);
  const serverRequests = useServerRequests(rpcRef);

  const [state, dispatch] = useReducer(appReducer, initialThreadState);
  const activeThreadIdRef = useRef<string | null>(null);
  const [cwd, setCwd] = useState<string>("");
  const [input, setInput] = useState("");
  const [showProviderModal, setShowProviderModal] = useState(false);
  const [focusedProvider, setFocusedProvider] = useState<string | null>(null);
  const [pendingDeleteThreadId, setPendingDeleteThreadId] = useState<string | null>(null);
  const [oauthPending, setOauthPending] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);

  // Keep ref in sync so onConnected closure can read latest activeThreadId
  activeThreadIdRef.current = state.activeThreadId;

  const refreshThreadList = useCallback(
    async (rpc = rpcRef.current): Promise<void> => {
      if (!rpc) return;
      try {
        const list = await rpc.request("thread/list", { limit: 100 });
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
      // Sync model + available models into refs immediately so applySessionModel can use them
      providerMgr.setInitialModel(meta.currentModel ?? "", meta.availableModels);
      try {
        await rpc.request("initialize", { clientName: "diligent-web", clientVersion: "0.0.1", protocolVersion: 1 });
        rpc.notify("initialized", { ready: true });

        // On reconnect, resume the previous thread if one exists
        const prevThreadId = activeThreadIdRef.current;
        if (prevThreadId) {
          const resumed = await rpc.request("thread/resume", { threadId: prevThreadId });
          if (resumed.found && resumed.threadId) {
            const history = await rpc.request("thread/read", { threadId: resumed.threadId });
            dispatch({ type: "hydrate", payload: { threadId: resumed.threadId, mode: meta.mode, history } });
            await providerMgr.applySessionModel(history.messages as { role: string; model?: string }[]);
            await refreshThreadList(rpc);
            return;
          }
        }

        // Try to resume the most recent session
        const mostRecent = await rpc.request("thread/resume", { mostRecent: true });
        if (mostRecent.found && mostRecent.threadId) {
          const history = await rpc.request("thread/read", { threadId: mostRecent.threadId });
          dispatch({ type: "hydrate", payload: { threadId: mostRecent.threadId, mode: meta.mode, history } });
          await providerMgr.applySessionModel(history.messages as { role: string; model?: string }[]);
          await refreshThreadList(rpc);
          return;
        }

        const started = await rpc.request("thread/start", { cwd: meta.cwd, mode: meta.mode });
        const history = await rpc.request("thread/read", { threadId: started.threadId });
        dispatch({ type: "hydrate", payload: { threadId: started.threadId, mode: meta.mode, history } });
        await refreshThreadList(rpc);
      } catch (error) {
        console.error(error);
      } finally {
        // Always refresh providers regardless of thread setup outcome
        await providerMgr.refreshProviders(rpc);
      }
    });

    rpc.onNotification((notification: DiligentServerNotification) => {
      if (notification.method === "account/login/completed") {
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
      if (notification.method === "account/updated") {
        void providerMgr.onAccountUpdated(notification.params);
        return;
      }
      dispatch({ type: "notification", payload: notification });
    });
    rpc.onServerRequest((requestId, request) => serverRequests.handleServerRequest(requestId, request));
  }, [
    refreshThreadList,
    providerMgr.refreshProviders,
    providerMgr.setInitialModel,
    providerMgr.applySessionModel,
    providerMgr.onAccountLoginCompleted,
    providerMgr.onAccountUpdated,
    serverRequests.handleServerRequest,
  ]);

  const startNewThread = async (): Promise<void> => {
    const rpc = rpcRef.current;
    if (!rpc) return;
    try {
      const started = await rpc.request("thread/start", { cwd: cwd || "/", mode: state.mode });
      const history = await rpc.request("thread/read", { threadId: started.threadId });
      dispatch({ type: "hydrate", payload: { threadId: started.threadId, mode: state.mode, history } });
      await refreshThreadList(rpc);
    } catch (error) {
      console.error(error);
    }
  };

  const openThread = async (threadId: string): Promise<void> => {
    const rpc = rpcRef.current;
    if (!rpc) return;
    try {
      const resumed = await rpc.request("thread/resume", { threadId });
      if (!resumed.found || !resumed.threadId) return;
      const history = await rpc.request("thread/read", { threadId: resumed.threadId });
      dispatch({ type: "hydrate", payload: { threadId: resumed.threadId, mode: state.mode, history } });
      await refreshThreadList(rpc);
      await providerMgr.applySessionModel(history.messages as { role: string; model?: string }[]);
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    if (!state.toast) return;
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
    try {
      await rpc.request("turn/start", { threadId: state.activeThreadId, message });
    } catch (error) {
      console.error(error);
    }
  };

  const steerMessage = async () => {
    const rpc = rpcRef.current;
    if (!rpc || !state.activeThreadId || !canSteer) return;
    const content = input.trim();
    setInput("");
    dispatch({ type: "local_user", payload: `[steering] ${content}` });
    try {
      await rpc.request("turn/steer", { threadId: state.activeThreadId, content, followUp: false });
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
    try {
      await rpc.request("thread/delete", { threadId });
      // If the deleted thread was active, switch to most recent or start new
      if (state.activeThreadId === threadId) {
        const resumed = await rpc.request("thread/resume", { mostRecent: true });
        if (resumed.found && resumed.threadId) {
          const history = await rpc.request("thread/read", { threadId: resumed.threadId });
          dispatch({ type: "hydrate", payload: { threadId: resumed.threadId, mode: state.mode, history } });
        } else {
          const started = await rpc.request("thread/start", { cwd: cwd || "/", mode: state.mode });
          const history = await rpc.request("thread/read", { threadId: started.threadId });
          dispatch({ type: "hydrate", payload: { threadId: started.threadId, mode: state.mode, history } });
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
    await rpc.request("turn/interrupt", { threadId: state.activeThreadId });
  };

  const setMode = async (mode: Mode) => {
    const rpc = rpcRef.current;
    if (!rpc || !state.activeThreadId) return;
    await rpc.request("mode/set", { threadId: state.activeThreadId, mode });
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

  const showPlan = state.planState && state.planState.steps.some((s) => !s.done);

  const showConnectionModal = connection === "reconnecting" || (connection === "disconnected" && reconnectAttempts > 0);
  const retryLimit = getReconnectAttemptLimit();

  return (
    <div className="h-screen bg-bg text-text">
      <div className="mx-auto grid h-full max-w-app grid-cols-1 gap-2 p-2 lg:grid-cols-[280px_1fr]">
        <Sidebar
          cwd={cwd}
          threadList={state.threadList}
          activeThreadId={state.activeThreadId}
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
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted">
              {threadTitle || "new conversation"}
            </span>
          </div>

          <MessageList
            items={state.items}
            threadStatus={state.threadStatus}
            onSelectPrompt={(p) => setInput(p)}
            approvalPrompt={
              serverRequests.approvalPrompt?.request.method === "approval/request"
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
          }`}
        >
          {state.toast.message}
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
        <Modal title="Delete conversation?" description="This will permanently delete the conversation file. This action cannot be undone.">
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
