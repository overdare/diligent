// @summary Main application orchestrator: state management, RPC lifecycle, and inline prompt handling

import type {
  DiligentServerRequest,
  DiligentServerRequestResponse,
  Mode,
  SessionSummary,
  ThreadReadResponse,
  UserInputRequest,
} from "@diligent/protocol";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ModelInfo } from "../shared/ws-protocol";
import { Button } from "./components/Button";
import { InputDock } from "./components/InputDock";
import { MessageList } from "./components/MessageList";
import { Modal } from "./components/Modal";
import { Panel } from "./components/Panel";
import { Sidebar } from "./components/Sidebar";
import { StatusDot } from "./components/StatusDot";
import { type ConnectionState, getReconnectAttemptLimit, WebRpcClient } from "./lib/rpc-client";
import {
  hydrateFromThreadRead,
  initialThreadState,
  type RenderItem,
  reduceServerNotification,
  type ThreadState,
} from "./lib/thread-store";

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
  const rpcRef = useRef<WebRpcClient | null>(null);
  const activeThreadIdRef = useRef<string | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [cwd, setCwd] = useState<string>("");
  const [currentModel, setCurrentModel] = useState<string>("");
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [input, setInput] = useState("");
  const [state, dispatch] = useReducer(appReducer, initialThreadState);
  const [approvalPrompt, setApprovalPrompt] = useState<{ requestId: number; request: DiligentServerRequest } | null>(
    null,
  );
  const [questionPrompt, setQuestionPrompt] = useState<{ requestId: number; request: UserInputRequest } | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  // Keep a ref in sync so onConnected (closure) can read the latest activeThreadId
  activeThreadIdRef.current = state.activeThreadId;

  const refreshThreadList = useCallback(async (rpc = rpcRef.current): Promise<void> => {
    if (!rpc) return;
    try {
      const list = await rpc.request("thread/list", { limit: 100 });
      dispatch({ type: "set_threads", payload: list.data });
    } catch (error) {
      console.error(error);
    }
  }, []);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const rpc = new WebRpcClient(`${protocol}://${window.location.host}/rpc`);
    rpcRef.current = rpc;

    rpc.onConnectionChange((next) => {
      setConnection(next);
      if (next === "connected") {
        setReconnectAttempts(0);
        return;
      }
      if (next === "reconnecting") {
        setReconnectAttempts((prev) => prev + 1);
      }
    });

    rpc.onConnected(async (meta) => {
      setCwd(meta.cwd);
      setCurrentModel(meta.currentModel);
      setAvailableModels(meta.availableModels);
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
            await refreshThreadList(rpc);
            return;
          }
        }

        const started = await rpc.request("thread/start", { cwd: meta.cwd, mode: meta.mode });
        const history = await rpc.request("thread/read", { threadId: started.threadId });
        dispatch({ type: "hydrate", payload: { threadId: started.threadId, mode: meta.mode, history } });
        await refreshThreadList(rpc);
      } catch (error) {
        console.error(error);
      }
    });

    rpc.onNotification((notification) => dispatch({ type: "notification", payload: notification }));

    rpc.onServerRequest((requestId, request) => {
      if (request.method === "approval/request") {
        setApprovalPrompt({ requestId, request });
        return;
      }
      setAnswers({});
      setQuestionPrompt({ requestId, request: request.params.request });
    });

    void rpc.connect();
    return () => rpc.disconnect();
  }, [refreshThreadList]);

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
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    if (!state.toast) return;
    const id = setTimeout(() => dispatch({ type: "clear_toast" }), 4000);
    return () => clearTimeout(id);
  }, [state.toast]);

  const canSend = input.trim().length > 0 && state.threadStatus !== "busy";

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

  const changeModel = async (modelId: string) => {
    const rpc = rpcRef.current;
    if (!rpc) return;
    setCurrentModel(modelId);
    try {
      await rpc.requestRaw("config/set", { model: modelId });
    } catch (error) {
      console.error(error);
    }
  };

  const threadTitle = useMemo(() => {
    const active = state.threadList.find((t) => t.id === state.activeThreadId);
    const raw = active?.firstUserMessage ?? state.items.find((i) => i.kind === "user")?.text ?? "";
    return raw.length > 40 ? `${raw.slice(0, 40)}…` : raw;
  }, [state.activeThreadId, state.threadList, state.items]);

  const statusDotColor: "success" | "accent" | "danger" =
    state.threadStatus === "idle" ? "success" : state.threadStatus === "busy" ? "accent" : "danger";
  const statusDotPulse = state.threadStatus !== "idle";

  const resolveApproval = (decision: "once" | "always" | "reject") => {
    if (!approvalPrompt) return;
    rpcRef.current?.respondServerRequest(approvalPrompt.requestId, {
      method: "approval/request",
      result: { decision },
    });
    setApprovalPrompt(null);
  };

  const resolveQuestion = (respondAnswers: Record<string, string>) => {
    if (!questionPrompt) return;
    rpcRef.current?.respondServerRequest(questionPrompt.requestId, {
      method: "userInput/request",
      result: { answers: respondAnswers },
    } as DiligentServerRequestResponse);
    setQuestionPrompt(null);
  };

  const showConnectionModal = connection === "reconnecting" || (connection === "disconnected" && reconnectAttempts > 0);
  const retryLimit = getReconnectAttemptLimit();

  const retryConnection = () => {
    const rpc = rpcRef.current;
    if (!rpc || connection === "connecting" || connection === "reconnecting") return;
    setReconnectAttempts(0);
    void rpc.connect();
  };

  return (
    <div className="h-screen bg-bg text-text">
      <div className="mx-auto grid h-full max-w-app grid-cols-1 gap-2 p-2 lg:grid-cols-[280px_1fr]">
        <Sidebar
          cwd={cwd}
          threadList={state.threadList}
          activeThreadId={state.activeThreadId}
          onNewThread={() => void startNewThread()}
          onOpenThread={(id) => void openThread(id)}
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
              approvalPrompt?.request.method === "approval/request"
                ? { request: approvalPrompt.request.params.request, onDecide: resolveApproval }
                : null
            }
            questionPrompt={
              questionPrompt
                ? {
                    request: questionPrompt.request,
                    answers,
                    onAnswerChange: (id, val) => setAnswers((prev) => ({ ...prev, [id]: val })),
                    onSubmit: () => resolveQuestion(answers),
                    onCancel: () => resolveQuestion({}),
                  }
                : null
            }
          />

          <InputDock
            input={input}
            onInputChange={setInput}
            onSend={() => void sendMessage()}
            onInterrupt={() => void interruptTurn()}
            canSend={canSend}
            threadStatus={state.threadStatus}
            connection={connection}
            cwd={cwd}
            mode={state.mode}
            onModeChange={(m) => void setMode(m)}
            currentModel={currentModel}
            availableModels={availableModels}
            onModelChange={(m) => void changeModel(m)}
            usage={state.usage}
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
