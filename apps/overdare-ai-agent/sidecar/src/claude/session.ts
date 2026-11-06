// @summary Product-owned Claude PTY lifecycle with bounded replay and no transcript logging.
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Terminal as HeadlessTerminal } from "@xterm/headless";
import { type ClaudeLaunch, type ClaudeLaunchOptions, nativeHostBinary, prepareClaudeLaunch } from "./launch";

export interface TerminalSize {
  cols: number;
  rows: number;
}
export interface ClaudeSessionStatus {
  id: string | null;
  state: "idle" | "starting" | "running" | "exited" | "error";
  workspace?: string;
  error?: string;
  exitCode?: number;
  conversationId?: string;
}
export type ClaudeTerminalEvent =
  | { type: "status"; status: ClaudeSessionStatus }
  | { type: "reset"; cols: number; rows: number }
  | { type: "resize"; cols: number; rows: number }
  | Uint8Array;
export interface ClaudeSessionOptions {
  launch: (conversation?: ClaudeLaunchOptions["conversation"]) => Promise<ClaudeLaunch>;
  helperPath?: string;
  helperArgs?: string[];
  scrollback?: number;
}

export function validTerminalSize(value: unknown): value is TerminalSize {
  const size = value as TerminalSize | null;
  return Boolean(
    size &&
      Number.isInteger(size.cols) &&
      Number.isInteger(size.rows) &&
      size.cols >= 2 &&
      size.cols <= 500 &&
      size.rows >= 2 &&
      size.rows <= 300,
  );
}

export class ClaudeTerminalSession {
  private status: ClaudeSessionStatus = { id: null, state: "idle" };
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending: Promise<ClaudeSessionStatus> | null = null;
  private stopping: Promise<void> | null = null;
  private closed = false;
  private cancelLaunch = false;
  private cleanup: Promise<void> = Promise.resolve();
  private screen: HeadlessTerminal;
  private serializer = new SerializeAddon();
  private cursorVisible = true;
  private listeners = new Map<(event: ClaudeTerminalEvent) => void, boolean>();

  constructor(private readonly options: ClaudeSessionOptions) {
    this.screen = new HeadlessTerminal({
      cols: 90,
      rows: 25,
      scrollback: options.scrollback ?? 4000,
      allowProposedApi: true,
      ...(process.platform === "win32" ? { windowsPty: { backend: "conpty" as const } } : {}),
    });
    this.screen.loadAddon(this.serializer);
    // SerializeAddon omits DECTCEM. Observe the parsed mode without consuming it,
    // so reconnecting does not show a second cursor over an application's own.
    for (const [final, visible] of [
      ["h", true],
      ["l", false],
    ] as const) {
      this.screen.parser.registerCsiHandler({ prefix: "?", final }, (params) => {
        if (params.includes(25)) this.cursorVisible = visible;
        return false;
      });
    }
    const resetCursor = () => {
      this.cursorVisible = true;
      return false;
    };
    this.screen.parser.registerEscHandler({ final: "c" }, resetCursor);
    this.screen.parser.registerCsiHandler({ intermediates: "!", final: "p" }, resetCursor);
    // The authoritative terminal answers device queries even while no browser is connected.
    // The browser suppresses query responses so each request is answered only once.
    this.screen.onData((data) => {
      if (this.status.id) this.input(this.status.id, data);
    });
  }
  snapshot(): ClaudeSessionStatus {
    return { ...this.status };
  }
  subscribe(listener: (event: ClaudeTerminalEvent) => void): () => void {
    this.listeners.set(listener, false);
    this.screen.write("", () => {
      if (!this.listeners.has(listener)) return;
      listener({ type: "reset", cols: this.screen.cols, rows: this.screen.rows });
      listener(new TextEncoder().encode(`${this.serializer.serialize()}\x1b[?25${this.cursorVisible ? "h" : "l"}`));
      listener({ type: "status", status: this.snapshot() });
      this.listeners.set(listener, true);
    });
    return () => this.listeners.delete(listener);
  }
  private publish(event: ClaudeTerminalEvent): void {
    for (const [listener, ready] of this.listeners) if (ready) listener(event);
  }
  private update(status: ClaudeSessionStatus): void {
    this.status = status;
    this.publish({ type: "status", status: this.snapshot() });
  }
  private flushScreen(): Promise<void> {
    return new Promise((resolve) => this.screen.write("", resolve));
  }

  async start(size: TerminalSize, conversation?: ClaudeLaunchOptions["conversation"]): Promise<ClaudeSessionStatus> {
    if (!validTerminalSize(size)) throw new Error("Invalid terminal size.");
    if (this.closed) throw new Error("The Studio terminal host has stopped.");
    if (this.stopping) {
      await this.stopping;
      return this.start(size, conversation);
    }
    if (this.pending) return this.pending;
    if (this.child && (this.status.state === "error" || this.status.state === "exited")) {
      await this.stop();
      return this.start(size, conversation);
    }
    if (this.child) return this.snapshot();
    this.cancelLaunch = false;
    this.pending = this.launch(size, conversation).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async launch(
    size: TerminalSize,
    conversation?: ClaudeLaunchOptions["conversation"],
  ): Promise<ClaudeSessionStatus> {
    // reset() does not discard xterm's asynchronous write queue. Finish parsing and
    // publishing the old process before resetting the shared screen for a new one.
    await this.flushScreen();
    this.screen.reset();
    this.cursorVisible = true;
    this.screen.resize(size.cols, size.rows);
    this.publish({ type: "reset", cols: size.cols, rows: size.rows });
    this.update({ id: randomUUID(), state: "starting" });
    let launch: ClaudeLaunch | undefined;
    let cleanupOwnedByChild = false;
    try {
      launch = await this.options.launch(conversation);
      if (this.cancelLaunch) {
        await launch.cleanup();
        this.update({ ...this.status, state: "exited" });
        return this.snapshot();
      }
      if (this.closed) throw new Error("The Studio terminal host has stopped.");
      const helper = this.options.helperPath ?? nativeHostBinary("overdare-terminal");
      const child = spawn(helper, this.options.helperArgs ?? [], { stdio: "pipe", windowsHide: true });
      this.child = child;
      cleanupOwnedByChild = true;
      const prepared = launch;
      // stderr is drained but deliberately never recorded: terminal content can contain secrets.
      child.stderr.resume();
      const lines = createInterface({ input: child.stdout });
      await new Promise<void>((resolve, reject) => {
        let ready = false;
        let queuedOutputBytes = 0;
        let failure: string | undefined;
        const timer = setTimeout(() => {
          failure = "Claude terminal startup timed out.";
          child.kill();
          reject(new Error(failure));
        }, 15_000);
        child.once("error", (error) => {
          clearTimeout(timer);
          failure = `Cannot start Claude terminal: ${error.message}`;
          reject(new Error(failure));
        });
        lines.on("line", (line) => {
          if (line.length > 128 * 1024) {
            failure = "Invalid terminal host response.";
            child.kill();
            return;
          }
          let event: { type: string; data?: string; message?: string; code?: number };
          try {
            event = JSON.parse(line);
          } catch {
            failure = "Invalid terminal host response.";
            child.kill();
            return;
          }
          if (event.type === "ready") {
            ready = true;
            clearTimeout(timer);
            this.update({
              id: this.status.id,
              state: "running",
              workspace: prepared.cwd,
              conversationId: prepared.conversationId,
            });
            resolve();
          } else if (event.type === "output" && typeof event.data === "string") {
            const bytes = new Uint8Array(Buffer.from(event.data, "base64"));
            queuedOutputBytes += bytes.length;
            if (queuedOutputBytes > 256 * 1024) lines.pause();
            this.screen.write(bytes, () => {
              queuedOutputBytes -= bytes.length;
              this.publish(bytes);
              if (queuedOutputBytes < 128 * 1024) lines.resume();
            });
          } else if (event.type === "error") {
            failure = event.message ?? "Claude terminal failed.";
            this.update({ ...this.status, state: "error", error: failure });
            clearTimeout(timer);
            reject(new Error(failure));
            child.kill();
          } else if (event.type === "exit") {
            this.update({ ...this.status, state: "exited", exitCode: event.code });
          }
        });
        child.once("close", (code) => {
          clearTimeout(timer);
          lines.close();
          if (this.child === child) {
            this.child = null;
            if (failure) this.update({ ...this.status, state: "error", error: failure });
            else this.update({ ...this.status, state: "exited", exitCode: this.status.exitCode ?? code ?? undefined });
          }
          this.cleanup = prepared.cleanup().catch(() => {});
          if (!ready) reject(new Error(failure ?? "Claude terminal exited before startup."));
        });
        child.stdin.on("error", () => {});
        child.stdin.write(
          `${JSON.stringify({ program: prepared.program, args: prepared.args, cwd: prepared.cwd, env: prepared.env, ...size })}\n`,
        );
      });
      return this.snapshot();
    } catch (error) {
      if (!cleanupOwnedByChild) await launch?.cleanup();
      if (this.cancelLaunch) {
        this.update({ ...this.status, state: "exited" });
        return this.snapshot();
      }
      const message = error instanceof Error ? error.message : String(error);
      this.update({ ...this.status, state: "error", error: message });
      throw error;
    }
  }

  input(id: string, data: string): void {
    if (id !== this.status.id || this.status.state !== "running" || !this.child) return;
    if (Buffer.byteLength(data) > 32 * 1024) throw new Error("Terminal input is too large.");
    if (this.child.stdin.writableLength > 256 * 1024) throw new Error("Terminal input is busy. Try again.");
    this.child.stdin.write(`${JSON.stringify({ type: "input", data: Buffer.from(data).toString("base64") })}\n`);
  }
  resize(id: string, size: TerminalSize): void {
    if (!validTerminalSize(size)) throw new Error("Invalid terminal size.");
    if (id !== this.status.id || !this.child) return;
    const child = this.child;
    this.screen.write("", () => {
      if (id !== this.status.id || this.child !== child || child.stdin.writableEnded) return;
      if (this.screen.cols === size.cols && this.screen.rows === size.rows) return;
      this.screen.resize(size.cols, size.rows);
      // Readers must apply this in the same ordered stream as terminal bytes.
      // Only then ask ConPTY to redraw for the new dimensions.
      this.publish({ type: "resize", cols: size.cols, rows: size.rows });
      child.stdin.write(`${JSON.stringify({ type: "resize", cols: size.cols, rows: size.rows })}\n`);
    });
  }
  async stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.cancelLaunch = true;
    this.stopping = (async () => {
      const child = this.child;
      if (child) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => child.kill(), 2000);
          child.once("close", () => {
            clearTimeout(timer);
            resolve();
          });
          child.stdin.end(`${JSON.stringify({ type: "stop" })}\n`);
        });
      }
      await this.pending?.catch(() => {});
      await this.cleanup;
      await this.flushScreen();
      if (!this.child && this.status.state !== "exited") this.update({ ...this.status, state: "exited" });
    })().finally(() => {
      this.stopping = null;
    });
    return this.stopping;
  }
  async close(): Promise<void> {
    this.closed = true;
    await this.stop();
    this.listeners.clear();
    this.screen.dispose();
  }
}

export function createClaudeSession(options: ClaudeLaunchOptions): ClaudeTerminalSession {
  return new ClaudeTerminalSession({
    launch: (conversation) => prepareClaudeLaunch({ ...options, conversation: conversation ?? options.conversation }),
  });
}
