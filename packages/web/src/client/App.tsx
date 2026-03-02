// @summary Main Web CLI application with live thread stream, mode control, and modal callbacks

import type {
  DiligentServerRequest,
  DiligentServerRequestResponse,
  Mode,
  SessionSummary,
  ThreadReadResponse,
  UserInputRequest,
} from "@diligent/protocol";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Badge } from "./components/Badge";
import { Button } from "./components/Button";
import { Input } from "./components/Input";
import { Modal } from "./components/Modal";
import { Panel } from "./components/Panel";
import { StreamBlock } from "./components/StreamBlock";
import { ToolCallRow } from "./components/ToolCallRow";
import { type ConnectionState, WebRpcClient } from "./lib/rpc-client";
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
  if (action.type === "notification") {
    return reduceServerNotification(state, action.payload);
  }

  if (action.type === "hydrate") {
    const base = {
      ...state,
      activeThreadId: action.payload.threadId,
      mode: action.payload.mode,
    };
    return hydrateFromThreadRead(base, action.payload.history);
  }

  if (action.type === "set_mode") {
    return {
      ...state,
      mode: action.payload,
    };
  }

  if (action.type === "set_threads") {
    return {
      ...state,
      threadList: action.payload,
    };
  }

  if (action.type === "local_user") {
    const userItem: RenderItem = {
      id: `local-user-${Date.now()}`,
      kind: "user",
      text: action.payload,
      timestamp: Date.now(),
    };
    return {
      ...state,
      items: [...state.items, userItem],
    };
  }

  if (action.type === "clear_toast") {
    return {
      ...state,
      toast: null,
    };
  }

  return state;
}

export function App() {
  const rpcRef = useRef<WebRpcClient | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [cwd, setCwd] = useState<string>("");
  const [input, setInput] = useState("");
  const [state, dispatch] = useReducer(appReducer, initialThreadState);
  const [approvalPrompt, setApprovalPrompt] = useState<{ requestId: number; request: DiligentServerRequest } | null>(
    null,
  );
  const [questionPrompt, setQuestionPrompt] = useState<{ requestId: number; request: UserInputRequest } | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});

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

    rpc.onConnectionChange((status) => {
      setConnection(status);
    });

    rpc.onConnected(async (meta) => {
      setCwd(meta.cwd);

      try {
        await rpc.request("initialize", {
          clientName: "diligent-web",
          clientVersion: "0.0.1",
          protocolVersion: 1,
        });

        rpc.notify("initialized", { ready: true });

        const started = await rpc.request("thread/start", {
          cwd: meta.cwd,
          mode: meta.mode,
        });

        const history = await rpc.request("thread/read", {
          threadId: started.threadId,
        });

        dispatch({
          type: "hydrate",
          payload: {
            threadId: started.threadId,
            mode: meta.mode,
            history,
          },
        });
        await refreshThreadList(rpc);
      } catch (error) {
        console.error(error);
      }
    });

    rpc.onNotification((notification) => {
      dispatch({ type: "notification", payload: notification });
    });

    rpc.onServerRequest((requestId, request) => {
      if (request.method === "approval/request") {
        setApprovalPrompt({ requestId, request });
        return;
      }

      setAnswers({});
      setQuestionPrompt({ requestId, request: request.params.request });
    });

    void rpc.connect();

    return () => {
      rpc.disconnect();
    };
  }, [refreshThreadList]);

  const startNewThread = async (): Promise<void> => {
    const rpc = rpcRef.current;
    if (!rpc) return;

    try {
      const started = await rpc.request("thread/start", {
        cwd: cwd || "/",
        mode: state.mode,
      });
      const history = await rpc.request("thread/read", {
        threadId: started.threadId,
      });
      dispatch({
        type: "hydrate",
        payload: {
          threadId: started.threadId,
          mode: state.mode,
          history,
        },
      });
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

      const history = await rpc.request("thread/read", {
        threadId: resumed.threadId,
      });
      dispatch({
        type: "hydrate",
        payload: {
          threadId: resumed.threadId,
          mode: state.mode,
          history,
        },
      });
      await refreshThreadList(rpc);
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    if (!state.toast) return;

    const timeoutId = setTimeout(() => {
      dispatch({ type: "clear_toast" });
    }, 4000);

    return () => clearTimeout(timeoutId);
  }, [state.toast]);

  const canSend = input.trim().length > 0 && state.threadStatus !== "busy";

  const sendMessage = async () => {
    const rpc = rpcRef.current;
    if (!rpc || !state.activeThreadId || !canSend) return;

    const message = input.trim();
    setInput("");
    dispatch({ type: "local_user", payload: message });

    try {
      await rpc.request("turn/start", {
        threadId: state.activeThreadId,
        message,
      });
    } catch (error) {
      console.error(error);
    }
  };

  const interruptTurn = async () => {
    const rpc = rpcRef.current;
    if (!rpc || !state.activeThreadId) return;
    await rpc.request("turn/interrupt", {
      threadId: state.activeThreadId,
    });
  };

  const setMode = async (mode: Mode) => {
    const rpc = rpcRef.current;
    if (!rpc || !state.activeThreadId) return;
    await rpc.request("mode/set", {
      threadId: state.activeThreadId,
      mode,
    });
    dispatch({ type: "set_mode", payload: mode });
  };

  const connectionTone = useMemo(() => {
    if (connection === "connected") return "text-success";
    if (connection === "reconnecting") return "text-accent";
    return "text-danger";
  }, [connection]);

  return (
    <div className="h-screen bg-bg text-text">
      <div className="mx-auto grid h-full max-w-[1400px] grid-cols-1 gap-2 p-2 lg:grid-cols-[280px_1fr]">
        <Panel className="flex min-h-0 flex-col overflow-hidden">
          <div className="border-b border-text/10 px-4 py-3">
            <h1 className="font-mono text-sm font-semibold uppercase tracking-wider text-accent">Diligent Web CLI</h1>
            <p className="mt-1 truncate text-xs text-muted">{cwd || "-"}</p>
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            <button
              type="button"
              onClick={() => void startNewThread()}
              className="w-full rounded-md border border-text/10 bg-bg/60 px-3 py-2 text-left text-sm text-text transition hover:border-accent/40"
            >
              + New Thread
            </button>

            <div className="rounded-md border border-accent/30 bg-accent/10 px-3 py-2">
              <div className="text-xs uppercase tracking-wide text-muted">active thread</div>
              <div className="mt-1 truncate font-mono text-sm text-text">{state.activeThreadId ?? "none"}</div>
            </div>

            <div className="rounded-md border border-text/10 bg-bg/60 px-3 py-2">
              <div className="text-xs uppercase tracking-wide text-muted">messages</div>
              <div className="mt-1 text-sm text-text">{state.items.length}</div>
            </div>

            <div className="space-y-1 pt-2">
              {state.threadList.map((thread) => (
                <button
                  key={thread.id}
                  type="button"
                  onClick={() => void openThread(thread.id)}
                  className={`w-full rounded-md border px-3 py-2 text-left transition ${
                    state.activeThreadId === thread.id
                      ? "border-accent/40 bg-accent/10"
                      : "border-text/10 bg-bg/50 hover:border-text/30"
                  }`}
                >
                  <div className="truncate text-sm text-text">
                    {thread.firstUserMessage || thread.name || "Untitled thread"}
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-muted">{thread.id}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-text/10 px-3 py-2 text-xs text-muted">
            <div className="flex items-center justify-between">
              <span>connection</span>
              <span className={connectionTone}>{connection}</span>
            </div>
          </div>
        </Panel>

        <Panel className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-text/10 px-3 py-2">
            <div className="flex items-center gap-2">
              <Badge className="text-success">thread: {state.activeThreadId ?? "none"}</Badge>
              <Badge>status: {state.threadStatus}</Badge>
            </div>

            <div className="flex items-center gap-2">
              <label htmlFor="mode" className="text-xs font-semibold uppercase tracking-wide text-muted">
                mode
              </label>
              <select
                id="mode"
                aria-label="Mode selector"
                value={state.mode}
                onChange={(event) => {
                  void setMode(event.target.value as Mode);
                }}
                className="h-8 rounded-md border border-text/20 bg-bg px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <option value="default">default</option>
                <option value="plan">plan</option>
                <option value="execute">execute</option>
              </select>
            </div>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {state.items.length === 0 ? (
              <div className="rounded-md border border-dashed border-text/15 bg-bg/30 p-6 text-center text-sm text-muted">
                Start a conversation from the input box below.
              </div>
            ) : (
              state.items.map((item) =>
                item.kind === "tool" ? (
                  <ToolCallRow key={item.id + item.timestamp} item={item} />
                ) : (
                  <StreamBlock key={item.id + item.timestamp} item={item} />
                ),
              )
            )}
          </div>

          <div className="border-t border-text/10 bg-bg/60 px-3 py-3">
            <div className="flex flex-col gap-2 md:flex-row">
              <Input
                aria-label="Message input"
                placeholder="Ask anything..."
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
              />
              <Button aria-label="Send message" onClick={() => void sendMessage()} disabled={!canSend}>
                Send
              </Button>
              <Button
                aria-label="Interrupt turn"
                intent="ghost"
                onClick={() => void interruptTurn()}
                disabled={state.threadStatus !== "busy"}
              >
                Stop
              </Button>
            </div>

            <div className="mt-2 flex items-center justify-between text-xs text-muted">
              <span className="truncate">{cwd || "-"}</span>
              <span>mode {state.mode}</span>
            </div>
          </div>
        </Panel>
      </div>

      {state.toast ? (
        <div
          className={`fixed bottom-4 right-4 rounded-md border px-3 py-2 text-sm shadow-panel ${
            state.toast.kind === "error"
              ? "border-danger/40 bg-surface text-danger"
              : "border-accent/40 bg-surface text-accent"
          }`}
        >
          {state.toast.message}
        </div>
      ) : null}

      {approvalPrompt?.request.method === "approval/request" ? (
        <Modal
          title="Approval required"
          description={`${approvalPrompt.request.params.request.toolName} requests ${approvalPrompt.request.params.request.permission}`}
        >
          <pre className="mb-3 whitespace-pre-wrap rounded bg-bg/70 p-2 font-mono text-xs text-muted">
            {approvalPrompt.request.params.request.description}
          </pre>
          <div className="flex gap-2">
            <Button
              size="sm"
              intent="ghost"
              onClick={() => {
                rpcRef.current?.respondServerRequest(approvalPrompt.requestId, {
                  method: "approval/request",
                  result: { decision: "once" },
                });
                setApprovalPrompt(null);
              }}
            >
              Once
            </Button>
            <Button
              size="sm"
              onClick={() => {
                rpcRef.current?.respondServerRequest(approvalPrompt.requestId, {
                  method: "approval/request",
                  result: { decision: "always" },
                });
                setApprovalPrompt(null);
              }}
            >
              Always
            </Button>
            <Button
              size="sm"
              intent="danger"
              onClick={() => {
                rpcRef.current?.respondServerRequest(approvalPrompt.requestId, {
                  method: "approval/request",
                  result: { decision: "reject" },
                });
                setApprovalPrompt(null);
              }}
            >
              Reject
            </Button>
          </div>
        </Modal>
      ) : null}

      {questionPrompt ? (
        <Modal title="Input required" description="The agent asked for additional information.">
          <div className="space-y-3">
            {questionPrompt.request.questions.map((question) => (
              <div key={question.id} className="space-y-1">
                <label htmlFor={question.id} className="text-sm font-semibold text-text">
                  {question.header}
                </label>
                <p className="text-xs text-muted">{question.question}</p>
                <Input
                  id={question.id}
                  aria-label={question.header}
                  type={question.is_secret ? "password" : "text"}
                  value={answers[question.id] ?? ""}
                  onChange={(event) => {
                    setAnswers((prev) => ({ ...prev, [question.id]: event.target.value }));
                  }}
                />
              </div>
            ))}
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button
              size="sm"
              intent="ghost"
              onClick={() => {
                rpcRef.current?.respondServerRequest(questionPrompt.requestId, {
                  method: "userInput/request",
                  result: { answers: {} },
                } as DiligentServerRequestResponse);
                setQuestionPrompt(null);
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                rpcRef.current?.respondServerRequest(questionPrompt.requestId, {
                  method: "userInput/request",
                  result: { answers },
                } as DiligentServerRequestResponse);
                setQuestionPrompt(null);
              }}
            >
              Submit
            </Button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
