// @summary Session-owned subprocesses backing yielded bash commands

import type { ThreadTerminalParams, ThreadTerminalResponse } from "@diligent/protocol";
import { type SpawnOptions, spawnProcess, spawnTerminal } from "../util/process";
import { TerminalTextDecoder } from "../util/terminal-output";
import { InteractiveTerminal } from "./interactive-terminal";

const PROCESS_LIMIT = 16;
const OUTPUT_LIMIT = 512 * 1024; // UTF-16 code units, at most 1 MiB of text per process.
const LIFETIME_MS = 30 * 60_000;
const PIPE_DRAIN_MS = 250;
export const SHELL_INPUT_LIMIT = 16 * 1024;

type StopReason = "aborted" | "terminated" | "expired";
type Completion = { exitCode: number | null; reason?: StopReason; error?: string };
export type ShellProcessOptions = Pick<SpawnOptions, "cwd" | "env"> & { tty?: boolean };

/** Output and input of a spawned command, either over pipes or a pseudo-terminal. */
interface ShellIo {
  readonly exited: Promise<number>;
  /** Called once after `exited`: closes input and waits, bounded, for output still in flight. */
  drain(): Promise<void>;
  /** Returns an error message instead of writing when input cannot be accepted. */
  write(input: string): string | undefined;
}

/** Process IDs are only usable by the session that spawned them, including within a shared collab registry. */
export class ShellProcessRegistry {
  private readonly sessions = new Map<string, Map<string, ShellProcess>>();
  private closed = false;
  private readonly terminals = new Map<string, InteractiveTerminal>();
  interactiveConnection?: (sessionId: string) => string | undefined;

  openTerminal(
    connectionId: string,
    sessionId: string,
    toolCallId: string,
    argv: string[],
    options: Pick<SpawnOptions, "cwd" | "env" | "signal"> & { onExit?: () => void },
  ): Promise<number> {
    if (this.closed) throw new Error("Shell process registry is shutting down");
    if (this.terminals.has(toolCallId)) throw new Error("Terminal already exists");
    const entry = new InteractiveTerminal(connectionId, sessionId, argv, options);
    this.terminals.set(toolCallId, entry);
    return entry.exited.finally(() => {
      // Let the attached client pull the last output, without storing it in session history.
      setTimeout(() => {
        if (this.terminals.get(toolCallId) === entry) this.terminals.delete(toolCallId);
      }, 10_000).unref();
    });
  }

  exchangeTerminal(connectionId: string, params: ThreadTerminalParams): ThreadTerminalResponse {
    const entry = this.terminals.get(params.toolCallId);
    if (!entry) {
      if (params.input !== undefined) throw new Error("Terminal input is closed");
      return { state: "waiting", cursor: 0, output: "", reset: params.cursor !== 0 };
    }
    if (entry.connectionId !== connectionId) throw new Error("Terminal belongs to another connection");
    if (params.cancel && params.input !== undefined) throw new Error("Cannot write and cancel together");
    return entry.exchange(params);
  }

  closeTerminals(connectionId: string): void {
    for (const [id, entry] of this.terminals) {
      if (entry.connectionId !== connectionId) continue;
      this.terminals.delete(id);
      entry.stop();
    }
  }

  start(owner: string, command: string, argv: string[], options: ShellProcessOptions): ShellProcess {
    if (this.closed) throw new Error("Shell process registry is shutting down");
    const entries = this.sessions.get(owner) ?? new Map<string, ShellProcess>();
    if (entries.size === PROCESS_LIMIT) {
      const finished = [...entries.values()].find((entry) => entry.completion && !entry.busy);
      if (!finished) throw new Error(`At most ${PROCESS_LIMIT} background shell processes are allowed per session`);
      this.forget(owner, finished);
    }
    const entry = new ShellProcess(command, argv, options, () => this.forget(owner, entry));
    this.sessions.set(owner, entries);
    entries.set(entry.id, entry);
    return entry;
  }

  get(owner: string, id: string): ShellProcess | undefined {
    return this.sessions.get(owner)?.get(id);
  }

  forget(owner: string, entry: ShellProcess): void {
    const entries = this.sessions.get(owner);
    if (!entries?.delete(entry.id)) return;
    entry.clearRetention();
    if (!entries.size) this.sessions.delete(owner);
  }

  async dispose(owner?: string): Promise<void> {
    if (owner === undefined) this.closed = true;
    const entries = owner === undefined ? this.sessions.values() : [this.sessions.get(owner)];
    const settling: Promise<void>[] = [];
    for (const [id, entry] of this.terminals) {
      if (owner !== undefined && entry.sessionId !== owner) continue;
      this.terminals.delete(id);
      entry.stop();
      settling.push(entry.exited.catch(() => undefined).then(() => undefined));
    }
    for (const owned of entries) {
      if (!owned) continue;
      for (const entry of owned.values()) {
        entry.stop("terminated");
        settling.push(entry.done.then(() => entry.clearRetention()));
      }
    }
    await Promise.all(settling);
    if (owner === undefined) this.sessions.clear();
    else this.sessions.delete(owner);
  }
}

export class ShellProcess {
  readonly id = crypto.randomUUID();
  readonly done: Promise<void>;
  completion?: Completion;
  inputApproved = false;
  busy = false;
  private readonly controller = new AbortController();
  private readonly io: ShellIo;
  private reason?: StopReason;
  private retention?: ReturnType<typeof setTimeout>;
  private observer?: { finish(): void; onOutput?: (delta: string) => void };
  private chunks: string[] = [];
  private head = 0;
  private chars = 0;
  private droppedChars = 0;
  private lastStderr = false;

  constructor(command: string, argv: string[], options: ShellProcessOptions, expire: () => void) {
    this.command = command;
    const { tty, ...spawnOptions } = options;
    const io = tty ? this.spawnTerminal(argv, spawnOptions) : this.spawnPipes(argv, spawnOptions);
    this.io = io;
    const lifetime = setTimeout(() => this.stop("expired"), LIFETIME_MS).unref();
    this.done = (async () => {
      let exitCode: number | null = null;
      let error: string | undefined;
      try {
        exitCode = await io.exited;
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
      }
      await io.drain();
      clearTimeout(lifetime);
      this.completion = { exitCode, reason: this.reason, error };
      this.retention = setTimeout(expire, LIFETIME_MS).unref();
      this.observer?.finish();
    })();
  }

  private spawnPipes(argv: string[], options: Pick<SpawnOptions, "cwd" | "env">): ShellIo {
    const child = spawnProcess(argv, {
      ...options,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      signal: this.controller.signal,
      cleanupGroupOnExit: true,
    });
    const stdout = new TextDecoder();
    const stderr = new TextDecoder();
    let stdinError: Error | undefined;
    child.stdout?.on("data", (chunk: Buffer) => this.append(stdout.decode(chunk, { stream: true }), false));
    child.stderr?.on("data", (chunk: Buffer) => this.append(stderr.decode(chunk, { stream: true }), true));
    child.stdin?.on("error", (error: Error) => {
      stdinError = error;
    });
    const closed = Promise.withResolvers<void>();
    child.once("close", () => closed.resolve());
    return {
      exited: child.exited,
      drain: async () => {
        // A descendant outside the process group can still hold inherited pipes open. Bound the drain.
        const drain = setTimeout(() => {
          child.stdout?.destroy();
          child.stderr?.destroy();
          closed.resolve();
        }, PIPE_DRAIN_MS);
        child.stdin?.destroy();
        await closed.promise;
        clearTimeout(drain);
        this.append(stdout.decode(), false);
        this.append(stderr.decode(), true);
      },
      write: (input) => {
        const stdin = child.stdin;
        if (!stdin?.writable || stdinError) return "Process stdin is closed";
        if (stdin.writableLength + Buffer.byteLength(input) > SHELL_INPUT_LIMIT) return "Process stdin buffer is full";
        stdin.write(input);
      },
    };
  }

  /** Terminal output is one stream, so it never gets a `[stderr]` section. */
  private spawnTerminal(argv: string[], options: Pick<SpawnOptions, "cwd" | "env">): ShellIo {
    const output = new TerminalTextDecoder();
    const child = spawnTerminal(argv, {
      ...options,
      signal: this.controller.signal,
      cleanupGroupOnExit: true,
      onData: (data) => this.append(output.write(data), false),
    });
    return {
      exited: child.exited,
      drain: async () => this.append(output.end(), false),
      write: (input) => (child.write(input) ? undefined : "Process terminal is closed"),
    };
  }

  readonly command: string;

  stop(reason: StopReason): void {
    if (this.completion || this.reason) return;
    this.reason = reason;
    this.controller.abort();
  }

  clearRetention(): void {
    clearTimeout(this.retention);
  }

  wait(ms: number | undefined, signal: AbortSignal, onOutput?: (delta: string) => void): Promise<void> {
    if (ms === 0 || this.completion || signal.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", finish);
        this.observer = undefined;
        resolve();
      };
      const timer = ms === undefined ? undefined : setTimeout(finish, ms);
      this.observer = { finish, onOutput };
      signal.addEventListener("abort", finish, { once: true });
    });
  }

  write(input: string): string | undefined {
    if (this.completion || this.reason) return "Process stdin is closed";
    return this.io.write(input);
  }

  takeOutput(): string {
    const marker = this.droppedChars ? `[… ${this.droppedChars} characters no longer buffered …]\n` : "";
    const output = marker + this.chunks.slice(this.head).join("");
    this.chunks = [];
    this.head = 0;
    this.chars = 0;
    this.droppedChars = 0;
    this.lastStderr = false;
    return output;
  }

  private append(text: string, stderr: boolean): void {
    if (!text) return;
    const delta = stderr && !this.lastStderr ? `\n[stderr]\n${text}` : text;
    this.lastStderr = stderr;
    this.observer?.onOutput?.(delta);
    const retained = delta.length > OUTPUT_LIMIT ? delta.slice(-OUTPUT_LIMIT) : delta;
    this.droppedChars += delta.length - retained.length;
    this.chunks.push(retained);
    this.chars += retained.length;
    while (this.chars > OUTPUT_LIMIT) {
      const removed = this.chunks[this.head++].length;
      this.chars -= removed;
      this.droppedChars += removed;
    }
    if (this.head > 0 && this.head * 2 >= this.chunks.length) {
      this.chunks.splice(0, this.head);
      this.head = 0;
    }
  }
}
