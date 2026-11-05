// @summary OVERDARE-styled native Claude Code terminal with reconnect and explicit lifecycle controls.

import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClaudeConversation } from "../../../claude/history";
import type { ClaudeSessionStatus } from "../../../claude/session";
import { copyTextToClipboard } from "../lib/clipboard";
import { installTerminalImeGuard } from "../lib/terminal-ime";
import { settleTerminalOperation, type TerminalOperation } from "../lib/terminal-lifecycle";
import { TerminalRenderer } from "../lib/terminal-renderer";
import { ClaudeIcon } from "./ClaudeIcon";
import { AgentLogo, Menu, SquarePen } from "./icons";
import { ResponsiveSidebar } from "./ResponsiveSidebar";
import { Sidebar } from "./Sidebar";
import { TerminalCommandIcon } from "./TerminalCommandIcon";
import { fieldClasses, iconButtonClasses } from "./ui-styles";
import "@xterm/xterm/css/xterm.css";

const initialStatus: ClaudeSessionStatus = { id: null, state: "idle" };

export function ClaudeTerminal({ mode = "claude" }: { mode?: "claude" | "shell" }) {
  const shell = mode === "shell";
  const LaunchIcon = shell ? TerminalCommandIcon : ClaudeIcon;
  const command = shell ? "shell" : "claude";
  const container = useRef<HTMLElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const renderer = useRef<TerminalRenderer | null>(null);
  const resizeOwner = useRef(false);
  const requestResize = useRef(() => {});
  const socket = useRef<WebSocket | null>(null);
  const sessionId = useRef<string | null>(null);
  const autoStart = useRef(true);
  const sidebarTrigger = useRef<HTMLButtonElement>(null);
  const [sidebarOverlay, setSidebarOverlay] = useState(() => window.matchMedia("(max-width: 639px)").matches);
  const [status, setStatus] = useState(initialStatus);
  const [connection, setConnection] = useState("Connecting");
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [showSessions, setShowSessions] = useState(false);
  const [conversations, setConversations] = useState<ClaudeConversation[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [search, setSearch] = useState("");
  const [operation, setOperationState] = useState<TerminalOperation | null>(null);
  const operationRef = useRef<TerminalOperation | null>(null);
  const [receivedOutput, setReceivedOutput] = useState(false);
  const setOperation = useCallback((value: TerminalOperation | null) => {
    operationRef.current = value;
    setOperationState(value);
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 639px)");
    const changed = () => setSidebarOverlay(media.matches);
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    if (!showSessions) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing && event.keyCode !== 229) {
        setShowSessions(false);
        sidebarTrigger.current?.focus();
      }
    };
    window.addEventListener("keydown", key);
    if (sidebarOverlay)
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>("#claude-sessions [data-sidebar-initial-focus]")?.focus(),
      );
    return () => window.removeEventListener("keydown", key);
  }, [showSessions, sidebarOverlay]);
  const send = useCallback((message: unknown) => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(message));
  }, []);

  useEffect(() => {
    if (!container.current) return;
    const style = getComputedStyle(document.documentElement);
    const color = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
    const view = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontSize: 13,
      lineHeight: 1.2,
      fontFamily: '"Cascadia Code", "Consolas", "Noto Sans Mono", monospace',
      scrollback: 8000,
      theme: {
        background: color("--color-bg", "#181b1f"),
        foreground: color("--color-text", "#ececee"),
        cursor: color("--color-accent", "#3b82f6"),
        selectionBackground: "#3b82f660",
        black: color("--color-bg", "#181b1f"),
        brightBlack: color("--color-text-muted", "#8e8e9a"),
        red: color("--color-text-error", "#f87171"),
        green: color("--color-text-success", "#22c55e"),
        yellow: color("--color-text-warning", "#fbbf24"),
        blue: color("--color-accent", "#3b82f6"),
        cyan: color("--color-text-info", "#38bdf8"),
        white: color("--color-text", "#ececee"),
      },
      ...(navigator.userAgent.includes("Windows") ? { windowsPty: { backend: "conpty" as const } } : {}),
    });
    const fitAddon = new FitAddon();
    view.loadAddon(fitAddon);
    view.open(container.current);
    const output = new TerminalRenderer(view);
    renderer.current = output;
    const disposeImeGuard = installTerminalImeGuard(view);
    // The server's headless terminal owns query replies. The browser renders the same bytes
    // but must not answer them a second time; ordinary keyboard and paste data stay untouched.
    for (const identifier of [
      { final: "n" },
      { prefix: "?", final: "n" },
      { final: "c" },
      { prefix: ">", final: "c" },
      { prefix: "=", final: "c" },
      { final: "t" },
      { intermediates: "$", final: "p" },
      { prefix: "?", intermediates: "$", final: "p" },
      { prefix: ">", final: "q" },
    ]) {
      view.parser.registerCsiHandler(identifier, () => true);
    }
    for (const identifier of [
      { intermediates: "$", final: "q" },
      { intermediates: "+", final: "q" },
    ])
      view.parser.registerDcsHandler(identifier, () => true);
    for (const identifier of [4, 10, 11, 12]) view.parser.registerOscHandler(identifier, (data) => data.includes("?"));
    terminal.current = view;
    fit.current = fitAddon;
    const resize = () => {
      if (!container.current?.clientWidth || !container.current.clientHeight) return;
      // Propose a size without changing this reader's grid. Every reader applies
      // the server's resize at the same point in the output stream.
      const size = fitAddon.proposeDimensions();
      if (resizeOwner.current && sessionId.current && size) send({ type: "resize", id: sessionId.current, ...size });
    };
    requestResize.current = resize;
    const observer = new ResizeObserver(resize);
    observer.observe(container.current);
    resize();
    const input = view.onData((data) => {
      if (!sessionId.current) return;
      // Keep each paste frame below the server's UTF-8 byte limit, without splitting surrogate pairs.
      const characters = Array.from(data);
      for (let offset = 0; offset < characters.length; offset += 4000)
        send({ type: "input", id: sessionId.current, data: characters.slice(offset, offset + 4000).join("") });
    });
    view.attachCustomKeyEventHandler((event) => {
      if (event.type === "keydown" && event.ctrlKey && event.shiftKey && event.code === "KeyC" && view.hasSelection()) {
        void copyTextToClipboard(view.getSelection());
        return false;
      }
      return true;
    });
    return () => {
      observer.disconnect();
      requestResize.current = () => {};
      output.dispose();
      renderer.current = null;
      input.dispose();
      disposeImeGuard();
      view.dispose();
      terminal.current = null;
      fit.current = null;
    };
  }, [send]);

  useEffect(() => {
    let disposed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let retries = 0;
    let current: WebSocket | null = null;
    const connect = async () => {
      setConnection(attempt === 0 ? "Connecting" : "Reconnecting");
      try {
        const response = await fetch(shell ? "/terminal/bootstrap" : "/claude/bootstrap", { cache: "no-store" });
        if (!response.ok)
          throw new Error("Studio terminal is unavailable. Open this view from a running Studio project.");
        const bootstrap = (await response.json()) as { wsUrl: string; token: string; unavailable?: string };
        if (disposed) return;
        setUnavailable(bootstrap.unavailable ?? null);
        current = new WebSocket(bootstrap.wsUrl, ["overdare-terminal", bootstrap.token]);
        current.binaryType = "arraybuffer";
        socket.current = current;
        current.onopen = () => {
          retries = 0;
          setConnection("Connected");
          setError(null);
        };
        current.onmessage = (event) => {
          if (disposed || event.target !== socket.current) return;
          if (event.data instanceof ArrayBuffer) {
            renderer.current?.write(new Uint8Array(event.data));
            if (event.data.byteLength) setReceivedOutput(true);
            return;
          }
          const message = JSON.parse(event.data) as {
            type: string;
            status?: ClaudeSessionStatus;
            message?: string;
            cols?: number;
            rows?: number;
            resizeOwner?: boolean;
            conversations?: ClaudeConversation[];
          };
          if (message.type === "reset") {
            setReceivedOutput(false);
            if (message.cols && message.rows) renderer.current?.reset(message.cols, message.rows);
          } else if (message.type === "resize") {
            if (message.cols && message.rows) renderer.current?.resize(message.cols, message.rows);
          } else if (message.type === "control") {
            resizeOwner.current = message.resizeOwner === true;
            requestResize.current();
          } else if (message.type === "status" && message.status) {
            sessionId.current = message.status.id;
            setStatus(message.status);
            if (autoStart.current) {
              autoStart.current = false;
              if (!bootstrap.unavailable && !["running", "starting"].includes(message.status.state)) {
                setOperation({ kind: "resume", previousId: message.status.id });
                send({ type: "start", ...(fit.current?.proposeDimensions() ?? { cols: 90, rows: 25 }) });
              }
            }
            setOperation(settleTerminalOperation(operationRef.current, message.status));
            if (message.status.state === "running") {
              requestResize.current();
              terminal.current?.focus();
            }
          } else if (message.type === "conversations") {
            setConversations(message.conversations ?? []);
            setLoadingSessions(false);
          } else if (message.type === "error") {
            setError(message.message ?? "Terminal request failed.");
            setLoadingSessions(false);
            setOperation(null);
          }
        };
        current.onclose = () => {
          if (disposed) return;
          resizeOwner.current = false;
          setOperation(null);
          setConnection("Reconnecting");
          retry = setTimeout(() => void connect(), Math.min(1000 * 2 ** retries++, 10_000));
        };
        current.onerror = () => current?.close();
      } catch (error) {
        if (!disposed) {
          setConnection("Disconnected");
          setError(error instanceof Error ? error.message : String(error));
        }
      }
    };
    void connect();
    return () => {
      disposed = true;
      clearTimeout(retry);
      current?.close();
      socket.current = null;
      resizeOwner.current = false;
    };
  }, [attempt, send, setOperation, shell]);

  const running = status.state === "running" || status.state === "starting";
  const switching = operation !== null;
  const start = () => {
    setError(null);
    setOperation({ kind: "resume", previousId: sessionId.current });
    send({ type: "start", ...(fit.current?.proposeDimensions() ?? { cols: 90, rows: 25 }) });
  };
  const loadSessions = () => {
    setError(null);
    setLoadingSessions(true);
    send({ type: "conversations" });
  };
  const selectConversation = (conversation: string) => {
    setError(null);
    setOperation({ kind: conversation === "new" ? "new" : "select", previousId: sessionId.current });
    setShowSessions(false);
    send({ type: "select", conversation, ...(fit.current?.proposeDimensions() ?? { cols: 90, rows: 25 }) });
  };
  const stop = () => {
    setOperation({ kind: "stop", previousId: sessionId.current });
    send({ type: "stop" });
  };
  const pendingLabel =
    shell && operation?.kind === "stop"
      ? "Stopping terminal…"
      : shell && (operation || status.state === "starting" || connection === "Connected")
        ? "Starting terminal…"
        : operation?.kind === "new"
          ? "Starting a new session…"
          : operation?.kind === "select"
            ? "Opening selected session…"
            : operation?.kind === "stop"
              ? "Stopping Claude…"
              : operation?.kind === "resume"
                ? "Resuming latest session…"
                : status.state === "starting"
                  ? "Starting Claude…"
                  : connection === "Reconnecting"
                    ? "Reconnecting to your terminal…"
                    : connection === "Connected"
                      ? "Waiting for Claude…"
                      : "Connecting to your terminal…";
  const failed = error ?? status.error ?? unavailable;
  const initialLoading =
    !failed &&
    !receivedOutput &&
    (connection === "Connecting" ||
      status.state === "idle" ||
      status.state === "starting" ||
      status.state === "running");
  const badge =
    connection !== "Connected"
      ? connection
      : status.state === "running"
        ? "Running"
        : status.state === "starting"
          ? "Starting"
          : status.state === "error"
            ? "Failed"
            : status.state === "exited"
              ? "Stopped"
              : "Ready";
  return (
    <div className="relative flex h-screen overflow-hidden bg-bg-sunken text-text">
      {!shell ? (
        <ResponsiveSidebar open={showSessions} id="claude-sessions">
          <div className="flex h-full min-h-0 flex-col">
            <Sidebar
              cwd={status.workspace ?? ""}
              threadList={conversations
                .filter((item) => item.title.toLowerCase().includes(search.toLowerCase()))
                .map((item) => ({
                  id: item.id,
                  name: item.title,
                  cwd: status.workspace ?? "",
                  path: "",
                  created: new Date(item.updatedAt).toISOString(),
                  modified: new Date(item.updatedAt).toISOString(),
                }))}
              activeThreadId={status.conversationId ?? null}
              isLoading={loadingSessions}
              error={error}
              disabled={connection !== "Connected" || switching || status.state === "starting" || Boolean(unavailable)}
              onNewThread={() => selectConversation("new")}
              onOpenThread={selectConversation}
              onClose={() => {
                setShowSessions(false);
                sidebarTrigger.current?.focus();
              }}
            />
            <div className="shrink-0 border-t border-border px-3 py-3">
              <input
                aria-label="Search sessions"
                placeholder="Search conversations"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className={`${fieldClasses} py-2`}
              />
              <button
                type="button"
                onClick={loadSessions}
                disabled={loadingSessions || connection !== "Connected"}
                className="mt-2 text-xs text-muted hover:text-text disabled:opacity-40"
              >
                Refresh
              </button>
              {!loadingSessions &&
              conversations.filter((item) => item.title.toLowerCase().includes(search.toLowerCase())).length === 0 ? (
                <p className="mt-2 text-xs text-muted">
                  {search ? "No matching sessions." : "No saved conversations yet."}
                </p>
              ) : null}
            </div>
          </div>
        </ResponsiveSidebar>
      ) : null}
      <main
        inert={!shell && showSessions && sidebarOverlay}
        aria-hidden={!shell && showSessions && sidebarOverlay ? true : undefined}
        className="flex min-w-0 min-h-0 flex-1 flex-col overflow-hidden"
      >
        <header className="flex h-16 shrink-0 items-center gap-2 border-b border-border bg-surface-dark px-3">
          {!shell ? (
            <>
              <button
                ref={sidebarTrigger}
                type="button"
                aria-label={showSessions ? "Close sidebar" : "Open sidebar"}
                title="Conversations"
                aria-controls="claude-sessions"
                aria-expanded={showSessions}
                onClick={() => {
                  setShowSessions(!showSessions);
                  if (!showSessions) loadSessions();
                }}
                className={iconButtonClasses}
              >
                <Menu className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
              </button>
              {!showSessions ? (
                <button
                  type="button"
                  aria-label="New conversation"
                  title="New conversation"
                  disabled={
                    connection !== "Connected" || switching || status.state === "starting" || Boolean(unavailable)
                  }
                  onClick={() => selectConversation("new")}
                  className={`${iconButtonClasses} hidden min-[320px]:inline-flex disabled:opacity-40`}
                >
                  <SquarePen className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                </button>
              ) : null}
            </>
          ) : null}
          <LaunchIcon className={`h-5 w-5 shrink-0 ${shell ? "text-muted" : "text-[#d97757]"}`} />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-widest text-muted">Local terminal</div>
            <h1 className="truncate font-mono text-sm font-medium">
              <span className="mr-1.5 text-muted" aria-hidden="true">
                $
              </span>
              {command}
            </h1>
          </div>
          <span
            className={`hidden min-[420px]:inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-1 text-[11px] ${connection === "Connected" && status.state === "running" ? "text-text-success" : "text-muted"}`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
            {badge}
          </span>
          <a
            href={shell ? "/claude" : "/terminal"}
            aria-label={shell ? "Run Claude Code" : "Terminal"}
            title={shell ? "Run Claude Code" : "Terminal"}
            className={iconButtonClasses}
          >
            {shell ? <ClaudeIcon className="h-4 w-4 text-[#d97757]" /> : <TerminalCommandIcon className="h-4 w-4" />}
          </a>
          <a
            href="/?view=agent"
            aria-label="Open OVERDARE AI Agent"
            title="OVERDARE AI Agent"
            className={iconButtonClasses}
          >
            <AgentLogo className="h-4 w-4" aria-hidden="true" />
          </a>
        </header>
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
          <span className="min-w-0 flex-1 truncate text-xs text-muted">
            <span title={status.workspace}>{status.workspace ?? "Studio project"}</span>
          </span>
          {shell ? (
            <button
              type="button"
              disabled={connection !== "Connected" || switching || status.state === "starting"}
              onClick={() => selectConversation("new")}
              className="rounded-md border border-border bg-surface-light px-3 py-1 text-xs hover:bg-surface-strong disabled:opacity-40"
            >
              New terminal
            </button>
          ) : null}
          {connection === "Disconnected" ? (
            <button
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
              className="rounded-md border border-border px-3 py-1 text-xs"
            >
              Reconnect
            </button>
          ) : null}
          {running ? (
            <details className="relative">
              <summary
                aria-label="Process actions"
                title="Process actions"
                className={`${iconButtonClasses} cursor-pointer list-none`}
              >
                ···
              </summary>
              <div className="absolute right-0 top-full z-30 mt-1 w-52 rounded-md border border-border bg-surface-dark p-1 shadow-panel">
                <button
                  type="button"
                  onClick={stop}
                  disabled={connection !== "Connected" || operation?.kind === "stop"}
                  className="w-full rounded px-3 py-2 text-left text-xs text-danger hover:bg-surface-light disabled:opacity-40"
                >
                  {shell ? "End terminal process" : "End Claude process"}
                </button>
                <p className="px-3 pb-2 text-[11px] text-muted">
                  To interrupt the current task, use Ctrl+C in the terminal.
                </p>
              </div>
            </details>
          ) : (
            <button
              type="button"
              onClick={start}
              disabled={connection !== "Connected" || Boolean(unavailable) || switching}
              className="rounded-md bg-accent px-3 py-1 text-xs text-white transition hover:bg-accent-hover disabled:opacity-40"
            >
              {shell ? "Start terminal" : "Resume latest"}
            </button>
          )}
        </div>
        {failed ? (
          <div role="alert" className="shrink-0 border-b border-border bg-surface px-4 py-3 text-xs text-danger">
            <p className="font-medium">
              {unavailable
                ? "Claude Code is not available"
                : connection === "Disconnected"
                  ? "Could not connect to the terminal"
                  : "Terminal request failed"}
            </p>
            <p className="mt-1 break-words text-muted">{failed}</p>
          </div>
        ) : null}
        {switching || connection === "Reconnecting" ? (
          <output className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-4 py-2 text-xs text-muted">
            <span
              className="h-3 w-3 animate-spin rounded-full border border-current border-r-transparent motion-reduce:animate-none"
              aria-hidden="true"
            />
            {pendingLabel}
          </output>
        ) : null}
        <div className="relative min-h-0 flex-1 p-3">
          <section
            ref={container}
            aria-label={shell ? "Project terminal" : "Claude Code terminal"}
            className="h-full w-full overflow-auto"
            onPointerDown={() => send({ type: "claim" })}
            onKeyDownCapture={() => {
              if (!resizeOwner.current) send({ type: "claim" });
            }}
            onPasteCapture={() => {
              if (!resizeOwner.current) send({ type: "claim" });
            }}
          />
          {initialLoading ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8">
              <div className="w-full max-w-xs rounded-xl border border-border bg-surface-dark p-6 shadow-xl">
                <div className="mb-5 flex items-center gap-3">
                  <LaunchIcon className={`h-8 w-8 ${shell ? "text-muted" : "text-[#d97757]"}`} />
                  <span className="font-mono text-base">
                    <span className="text-muted">$ </span>
                    {command}
                    <span className="ml-1 animate-pulse text-text-warning motion-reduce:animate-none">▏</span>
                  </span>
                </div>
                <p className="text-sm font-medium">{pendingLabel}</p>
                <p className="mt-2 text-xs leading-6 text-muted">
                  {shell
                    ? "Opening a shell in your Studio project folder."
                    : operation?.kind === "new"
                      ? "Opening a fresh conversation in this project."
                      : "Your latest conversation will continue automatically."}
                </p>
                <div className="mt-5 h-0.5 animate-pulse rounded bg-border-strong motion-reduce:animate-none" />
              </div>
            </div>
          ) : null}
          {status.state === "exited" && !switching ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-8 flex justify-center px-6">
              <div className="pointer-events-auto rounded-lg border border-border bg-surface-dark px-4 py-3 text-center shadow-lg">
                <p className="text-xs text-muted">Session stopped.</p>
                <p className="mt-1 text-[11px] text-muted">
                  {shell
                    ? "Start the terminal to continue working in this project."
                    : "Resume your latest conversation or start a new one."}
                </p>
              </div>
            </div>
          ) : null}
        </div>
        <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-border px-4 text-[11px] text-muted">
          <span>
            {status.state === "exited"
              ? `Exited${status.exitCode === undefined ? "" : ` (${status.exitCode})`}`
              : status.state === "starting"
                ? shell
                  ? "Starting terminal…"
                  : "Starting Claude Code…"
                : "Ctrl+C interrupt · Ctrl+Shift+C copy"}
          </span>
        </footer>
      </main>
    </div>
  );
}
