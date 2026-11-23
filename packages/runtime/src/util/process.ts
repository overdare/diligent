// @summary Cross-platform child process spawn (pipes or a POSIX pseudo-terminal) with abort, timeout, and process-group kill

import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

export type Stdio = "inherit" | "pipe" | "ignore";

export interface SpawnOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdin?: Stdio;
  stdout?: Stdio;
  stderr?: Stdio;
  signal?: AbortSignal;
  /** Terminate remaining group members if the command exits before them. POSIX only. */
  cleanupGroupOnExit?: boolean;
}

export type Child = ChildProcess & { exited: Promise<number> };

const TERMINATION_GRACE_MS = 1_000;
const GROUP_POLL_MS = 25;

/** Signal the entire POSIX group. Return false only when the group no longer exists. */
function signalGroup(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    // EPERM can mean the group still exists even though we cannot signal it.
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function terminateGroup(pid: number): Promise<void> {
  if (!signalGroup(pid, "SIGTERM")) return;
  const deadline = performance.now() + TERMINATION_GRACE_MS;
  while (signalGroup(pid, 0)) {
    const remaining = deadline - performance.now();
    if (remaining <= 0) {
      signalGroup(pid, "SIGKILL");
      return;
    }
    await delay(Math.min(GROUP_POLL_MS, remaining));
  }
}

const runningGroups = new Set<number>();
let exitCleanupInstalled = false;

function trackGroup(pid: number): void {
  if (!exitCleanupInstalled) {
    exitCleanupInstalled = true;
    process.once("exit", () => {
      // The exit event cannot wait for graceful shutdown.
      for (const group of runningGroups) signalGroup(group, "SIGKILL");
    });
  }
  runningGroups.add(pid);
}

/** Ties a command's process group to cancellation, cleanup after the leader exits, and runtime exit. */
function superviseGroup(
  groupId: number | undefined,
  isRunning: () => boolean,
  opts: Pick<SpawnOptions, "signal" | "cleanupGroupOnExit">,
  killTree?: () => void,
): { leaderExited(): Promise<void>; failed(): void } {
  if (groupId !== undefined) trackGroup(groupId);
  let termination: Promise<void> | undefined;
  const abort = () => {
    if (!isRunning()) return;
    if (groupId !== undefined) termination ??= terminateGroup(groupId);
    else killTree?.();
  };
  if (opts.signal) {
    opts.signal.addEventListener("abort", abort, { once: true });
    if (opts.signal.aborted) abort();
  }
  return {
    async leaderExited() {
      opts.signal?.removeEventListener("abort", abort);
      if (groupId !== undefined && opts.cleanupGroupOnExit) termination ??= terminateGroup(groupId);
      // The group can outlive its leader. Keep tracking it until cancellation finishes.
      if (termination) await termination;
      if (groupId !== undefined) runningGroups.delete(groupId);
    },
    failed() {
      opts.signal?.removeEventListener("abort", abort);
      if (groupId !== undefined) runningGroups.delete(groupId);
    },
  };
}

export function spawnProcess(cmd: string[], opts: SpawnOptions = {}): Child {
  if (cmd.length === 0) throw new Error("Command is required");
  opts.signal?.throwIfAborted();

  const proc = nodeSpawn(cmd[0], cmd.slice(1), {
    cwd: opts.cwd,
    env: opts.env,
    stdio: [opts.stdin ?? "ignore", opts.stdout ?? "ignore", opts.stderr ?? "ignore"],
    // POSIX: isolate the command and its descendants in a new process group without a controlling terminal.
    detached: process.platform !== "win32",
  });
  const group = superviseGroup(
    process.platform === "win32" ? undefined : proc.pid,
    () => proc.exitCode === null && proc.signalCode === null,
    opts,
    () => {
      if (process.platform === "win32" && proc.pid !== undefined) {
        nodeSpawn("taskkill", ["/F", "/T", "/PID", String(proc.pid)], { stdio: "ignore" });
      }
    },
  );

  const exited = Promise.withResolvers<number>();
  proc.once("exit", async (code, signal) => {
    await group.leaderExited();
    exited.resolve(code ?? (signal ? 1 : 0));
  });
  proc.once("error", (err) => {
    group.failed();
    exited.reject(err);
  });

  const child = proc as Child;
  child.exited = exited.promise;
  return child;
}

export const TERMINAL_UNSUPPORTED_MESSAGE =
  "tty is not supported on Windows yet. Run the command without tty; it will use pipes instead of a terminal.";
const TERMINAL_COLUMNS = 120;
const TERMINAL_ROWS = 40;
const TERMINAL_DRAIN_MS = 250;

export interface TerminalSpawnOptions extends Pick<SpawnOptions, "cwd" | "env" | "signal" | "cleanupGroupOnExit"> {
  /** Receives everything the command writes to the terminal; stdout and stderr share it. */
  onData: (data: Uint8Array) => void;
  /** Called as soon as the command itself exits, before the rest of its group is cleaned up. */
  onExit?: () => void;
}

export interface TerminalChild {
  /** Resolves after the command exited, its group was cleaned up, output drained, and the terminal closed. */
  readonly exited: Promise<number>;
  /** Writes input as if typed at the terminal. Returns false once the terminal is closed. */
  write(data: string): boolean;
}

/** Spawn a command attached to a new pseudo-terminal. POSIX only. */
export function spawnTerminal(cmd: string[], opts: TerminalSpawnOptions): TerminalChild {
  if (process.platform === "win32") throw new Error(TERMINAL_UNSUPPORTED_MESSAGE);
  if (cmd.length === 0) throw new Error("Command is required");
  opts.signal?.throwIfAborted();

  const outputClosed = Promise.withResolvers<void>();
  // Bun starts the command in a new session that owns the terminal, so its PID is also its process group ID.
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd,
    env: opts.env,
    terminal: {
      cols: TERMINAL_COLUMNS,
      rows: TERMINAL_ROWS,
      data: (_terminal, data) => opts.onData(data),
      exit: () => outputClosed.resolve(),
    },
  });
  const terminal = proc.terminal!;
  const group = superviseGroup(proc.pid, () => proc.exitCode === null && proc.signalCode === null, opts);

  const exited = proc.exited.then(async () => {
    opts.onExit?.();
    await group.leaderExited();
    // A descendant outside the group can keep the terminal open. Bound the wait for output already written.
    const drain = setTimeout(outputClosed.resolve, TERMINAL_DRAIN_MS);
    await outputClosed.promise;
    clearTimeout(drain);
    terminal.close();
    return proc.exitCode ?? (proc.signalCode ? 1 : 0);
  });

  return {
    exited,
    write(data) {
      if (terminal.closed) return false;
      terminal.write(data);
      return true;
    },
  };
}

/** Spawn and collect full stdout/stderr. Returns [stdout, stderr, exitCode]. */
export function spawnCollect(
  cmd: string[],
  opts: Omit<SpawnOptions, "stdout" | "stderr"> = {},
): Promise<[string, string, number]> {
  return new Promise((resolve, reject) => {
    const proc = spawnProcess(cmd, { ...opts, stdout: "pipe", stderr: "pipe" });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    proc.stdout?.on("data", (c: Buffer) => stdoutChunks.push(c));
    proc.stderr?.on("data", (c: Buffer) => stderrChunks.push(c));

    proc.exited
      .then((code) => resolve([Buffer.concat(stdoutChunks).toString(), Buffer.concat(stderrChunks).toString(), code]))
      .catch(reject);
  });
}
