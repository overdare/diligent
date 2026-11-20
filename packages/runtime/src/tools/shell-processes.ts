// @summary Session-owned subprocesses backing yielded bash commands

import { type SpawnOptions, spawnProcess } from "../util/process";

const PROCESS_LIMIT = 16;
const OUTPUT_LIMIT = 512 * 1024; // UTF-16 code units, at most 1 MiB of text per process.
const LIFETIME_MS = 30 * 60_000;
const PIPE_DRAIN_MS = 250;
export const SHELL_INPUT_LIMIT = 16 * 1024;

type StopReason = "aborted" | "terminated" | "expired";
type Completion = { exitCode: number | null; reason?: StopReason; error?: string };

/** Process IDs are only usable by the session that spawned them, including within a shared collab registry. */
export class ShellProcessRegistry {
  private readonly sessions = new Map<string, Map<string, ShellProcess>>();
  private closed = false;

  start(owner: string, command: string, argv: string[], options: Pick<SpawnOptions, "cwd" | "env">): ShellProcess {
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
  private readonly child: ReturnType<typeof spawnProcess>;
  private reason?: StopReason;
  private retention?: ReturnType<typeof setTimeout>;
  private stdinError?: Error;
  private observer?: { finish(): void; onOutput?: (delta: string) => void };
  private chunks: string[] = [];
  private head = 0;
  private chars = 0;
  private droppedChars = 0;
  private lastStderr = false;

  constructor(command: string, argv: string[], options: Pick<SpawnOptions, "cwd" | "env">, expire: () => void) {
    this.command = command;
    this.child = spawnProcess(argv, {
      ...options,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      signal: this.controller.signal,
      cleanupGroupOnExit: true,
    });
    const child = this.child;
    const stdout = new TextDecoder();
    const stderr = new TextDecoder();
    child.stdout?.on("data", (chunk: Buffer) => this.append(stdout.decode(chunk, { stream: true }), false));
    child.stderr?.on("data", (chunk: Buffer) => this.append(stderr.decode(chunk, { stream: true }), true));
    child.stdin?.on("error", (error: Error) => {
      this.stdinError = error;
    });
    const closed = Promise.withResolvers<void>();
    child.once("close", () => closed.resolve());
    const lifetime = setTimeout(() => this.stop("expired"), LIFETIME_MS).unref();
    this.done = (async () => {
      let exitCode: number | null = null;
      let error: string | undefined;
      try {
        exitCode = await child.exited;
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
      }
      // A descendant outside the process group can still hold inherited pipes open. Bound the drain.
      const drain = setTimeout(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
        closed.resolve();
      }, PIPE_DRAIN_MS);
      child.stdin?.destroy();
      await closed.promise;
      clearTimeout(drain);
      clearTimeout(lifetime);
      this.append(stdout.decode(), false);
      this.append(stderr.decode(), true);
      this.completion = { exitCode, reason: this.reason, error };
      this.retention = setTimeout(expire, LIFETIME_MS).unref();
      this.observer?.finish();
    })();
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
    const stdin = this.child.stdin;
    if (this.completion || this.reason || !stdin?.writable || this.stdinError) return "Process stdin is closed";
    if (stdin.writableLength + Buffer.byteLength(input) > SHELL_INPUT_LIMIT) return "Process stdin buffer is full";
    stdin.write(input);
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
