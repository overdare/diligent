// @summary Cross-platform child process spawn with abort, timeout, and process-tree kill (process group on POSIX)

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
  const groupId = process.platform === "win32" ? undefined : proc.pid;
  if (groupId !== undefined) trackGroup(groupId);

  let termination: Promise<void> | undefined;
  const abort = () => {
    if (proc.exitCode !== null || proc.signalCode !== null) return;
    if (groupId !== undefined) {
      termination ??= terminateGroup(groupId);
    } else if (process.platform === "win32" && proc.pid !== undefined) {
      nodeSpawn("taskkill", ["/F", "/T", "/PID", String(proc.pid)], { stdio: "ignore" });
    }
  };

  const exited = new Promise<number>((resolve, reject) => {
    proc.once("exit", async (code, signal) => {
      opts.signal?.removeEventListener("abort", abort);
      // The group can outlive its leader. Keep tracking it until cancellation finishes.
      if (termination) await termination;
      if (groupId !== undefined) runningGroups.delete(groupId);
      resolve(code ?? (signal ? 1 : 0));
    });
    proc.once("error", (err) => {
      opts.signal?.removeEventListener("abort", abort);
      if (groupId !== undefined) runningGroups.delete(groupId);
      reject(err);
    });
  });

  if (opts.signal) {
    opts.signal.addEventListener("abort", abort, { once: true });
    if (opts.signal.aborted) abort();
  }

  const child = proc as Child;
  child.exited = exited;
  return child;
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
