// @summary Cross-platform child process spawn with abort, timeout, and Windows process-tree kill

import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";

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

/** Kill the process and its entire process tree. On Windows uses taskkill /F /T. */
function killTree(proc: ChildProcess): void {
  if (process.platform === "win32" && proc.pid !== undefined) {
    nodeSpawn("taskkill", ["/F", "/T", "/PID", String(proc.pid)], { stdio: "ignore" });
  } else {
    proc.kill("SIGKILL");
  }
}

export function spawnProcess(cmd: string[], opts: SpawnOptions = {}): Child {
  if (cmd.length === 0) throw new Error("Command is required");
  opts.signal?.throwIfAborted();

  const proc = nodeSpawn(cmd[0], cmd.slice(1), {
    cwd: opts.cwd,
    env: opts.env,
    stdio: [opts.stdin ?? "ignore", opts.stdout ?? "ignore", opts.stderr ?? "ignore"],
  });

  const abort = () => {
    if (proc.exitCode !== null || proc.signalCode !== null) return;
    killTree(proc);
  };

  const exited = new Promise<number>((resolve, reject) => {
    proc.once("exit", (code, signal) => {
      opts.signal?.removeEventListener("abort", abort);
      resolve(code ?? (signal ? 1 : 0));
    });
    proc.once("error", (err) => {
      opts.signal?.removeEventListener("abort", abort);
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
export function spawnCollect(cmd: string[], opts: Omit<SpawnOptions, "stdout" | "stderr"> = {}): Promise<[string, string, number]> {
  return new Promise((resolve, reject) => {
    const proc = spawnProcess(cmd, { ...opts, stdout: "pipe", stderr: "pipe" });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    proc.stdout?.on("data", (c: Buffer) => stdoutChunks.push(c));
    proc.stderr?.on("data", (c: Buffer) => stderrChunks.push(c));

    proc.exited
      .then((code) =>
        resolve([Buffer.concat(stdoutChunks).toString(), Buffer.concat(stderrChunks).toString(), code]),
      )
      .catch(reject);
  });
}
