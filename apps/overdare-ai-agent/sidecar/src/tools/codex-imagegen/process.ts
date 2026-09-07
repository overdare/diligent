// @summary Owns a Codex child process, its line stream, deadline, and shutdown.

import { spawn } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import type { Readable, Writable } from "node:stream";

export interface CodexChildProcess {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "exit", listener: (code: number | null) => void): this;
}

export type SpawnCodexAppServer = (
  executable: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; stdio: ["pipe", "pipe", "pipe"] },
) => CodexChildProcess;

export interface CodexProcessOptions {
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
  spawn?: SpawnCodexAppServer;
  shutdownGraceMs?: number;
}

export class CodexProcess {
  private readonly child: CodexChildProcess;
  private readonly lines: Interface;
  private readonly output: AsyncIterator<string>;
  private readonly stopped = new AbortController();
  private readonly exited = Promise.withResolvers<void>();
  private readonly deadline: ReturnType<typeof setTimeout>;
  private hasExited = false;
  private stderrTail = "";
  private shutdown?: Promise<void>;

  constructor(private readonly options: CodexProcessOptions) {
    options.signal?.throwIfAborted();
    this.child = (options.spawn ?? spawn)(process.env.DILIGENT_CODEX_BIN?.trim() || "codex", ["app-server"], {
      cwd: options.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.lines = createInterface({ input: this.child.stdout });
    this.output = this.lines[Symbol.asyncIterator]();
    this.lines.on("error", this.stop);
    this.child.stdin.on("error", this.stop);
    this.child.stdout.on("error", this.stop);
    this.child.stderr.on("error", this.stop);
    // Always drain stderr so a full pipe cannot stall the child.
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-4_000);
    });
    this.child.on("error", (error) => {
      // A failed spawn emits error without exit.
      this.hasExited = true;
      this.exited.resolve();
      this.stop(error);
    });
    this.child.on("exit", (code) => {
      this.hasExited = true;
      this.exited.resolve();
      const diagnostics = this.stderrTail.trim();
      this.stop(
        new Error(
          `Codex App Server exited before image generation completed (code ${code ?? "unknown"}).` +
            (diagnostics ? `\n${diagnostics}` : ""),
        ),
      );
    });
    this.deadline = setTimeout(
      () => this.stop(new Error(`Codex image generation timed out after ${options.timeoutMs}ms.`)),
      options.timeoutMs,
    );
    options.signal?.addEventListener("abort", this.onAbort, { once: true });
    if (options.signal?.aborted) this.onAbort();
  }

  writeLine(line: string): void {
    this.stopped.signal.throwIfAborted();
    this.child.stdin.write(`${line}\n`);
  }

  async readLine(): Promise<string> {
    this.stopped.signal.throwIfAborted();
    const line = await this.output.next();
    this.stopped.signal.throwIfAborted();
    if (line.done) throw new Error("Codex App Server output closed before image generation completed.");
    return line.value;
  }

  close(): Promise<void> {
    this.shutdown ??= this.dispose();
    return this.shutdown;
  }

  private readonly onAbort = (): void => {
    const reason = this.options.signal?.reason;
    this.stop(reason instanceof Error ? reason : new DOMException("Aborted", "AbortError"));
  };

  private readonly stop = (error: Error): void => {
    if (this.stopped.signal.aborted) return;
    this.stopped.abort(error);
    this.lines.close();
  };

  private async dispose(): Promise<void> {
    clearTimeout(this.deadline);
    this.options.signal?.removeEventListener("abort", this.onAbort);
    this.stop(new Error("Codex App Server session closed."));
    if (!this.hasExited) {
      const forceKill = setTimeout(() => this.child.kill("SIGKILL"), this.options.shutdownGraceMs ?? 1_000);
      try {
        this.child.kill("SIGTERM");
        await this.exited.promise;
      } finally {
        clearTimeout(forceKill);
      }
    }
    this.child.stdin.destroy();
    this.child.stdout.destroy();
    this.child.stderr.destroy();
  }
}
