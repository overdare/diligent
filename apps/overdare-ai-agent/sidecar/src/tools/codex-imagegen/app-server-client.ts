// @summary Manages one Codex app-server stdio session and correlates JSON-RPC requests and notifications.

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

export type JsonRecord = Record<string, unknown>;

export interface CodexNotification {
  method: string;
  params?: unknown;
}

export interface CodexAppServerSession {
  request(method: string, params?: JsonRecord): Promise<unknown>;
  notify(method: string, params?: JsonRecord): void;
  waitForNotification<T>(match: (notification: CodexNotification) => T | undefined): Promise<T>;
}

export type ConnectCodexAppServer = <T>(input: {
  cwd: string;
  signal?: AbortSignal;
  timeoutMs: number;
  run(session: CodexAppServerSession): Promise<T>;
}) => Promise<T>;

export interface CodexAppServerProcess {
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
) => CodexAppServerProcess;

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

interface NotificationWaiter<T = unknown> {
  match(notification: CodexNotification): T | undefined;
  resolve(value: T): void;
  reject(error: Error): void;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function isRequestId(value: unknown): value is string | number {
  return typeof value === "string" || typeof value === "number";
}

function errorMessage(error: unknown): string {
  if (!isRecord(error)) return "request failed";
  return typeof error.message === "string" && error.message.length > 0 ? error.message : "request failed";
}

const spawnCodexAppServer: SpawnCodexAppServer = (executable, args, options) => spawn(executable, args, options);

export function createCodexAppServerConnector(
  spawnAppServer: SpawnCodexAppServer = spawnCodexAppServer,
  options: { shutdownGraceMs?: number } = {},
): ConnectCodexAppServer {
  return async (input) => {
    input.signal?.throwIfAborted();
    const executable = process.env.DILIGENT_CODEX_BIN?.trim() || "codex";
    const child = spawnAppServer(executable, ["app-server"], {
      cwd: input.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = createInterface({ input: child.stdout });
    const pending = new Map<number, PendingRequest>();
    const waiters = new Set<NotificationWaiter>();
    let requestId = 1;
    let closed: Error | undefined;
    let hasExited = false;
    const exited = Promise.withResolvers<void>();
    const failure = Promise.withResolvers<never>();
    let stderrTail = "";

    // Codex writes diagnostics to stderr. It must always be consumed: leaving a piped stream unread
    // can fill the OS buffer and block image generation indefinitely.
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderrTail = `${stderrTail}${chunk}`.slice(-4_000);
    });

    const finish = (error: Error) => {
      if (closed) return;
      closed = error;
      lines.close();
      failure.reject(error);
      for (const request of pending.values()) request.reject(error);
      pending.clear();
      for (const waiter of waiters) {
        waiter.reject(error);
      }
      waiters.clear();
    };

    const onAbort = () =>
      finish(input.signal?.reason instanceof Error ? input.signal.reason : new DOMException("Aborted", "AbortError"));
    input.signal?.addEventListener("abort", onAbort, { once: true });
    if (input.signal?.aborted) onAbort();
    const deadline = setTimeout(
      () => finish(new Error(`Codex image generation timed out after ${input.timeoutMs}ms.`)),
      input.timeoutMs,
    );

    const write = (message: JsonRecord): void => {
      if (closed) throw closed;
      if (!child.stdin.writable) throw new Error("Codex App Server is not available.");
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };

    const dispatchNotification = (notification: CodexNotification): void => {
      for (const waiter of [...waiters]) {
        try {
          const value = waiter.match(notification);
          if (value === undefined) continue;
          waiters.delete(waiter);
          waiter.resolve(value);
        } catch (error) {
          waiters.delete(waiter);
          waiter.reject(error instanceof Error ? error : new Error(String(error)));
        }
      }
    };

    lines.on("line", (line) => {
      let message: unknown;
      try {
        message = JSON.parse(line) as unknown;
      } catch (error) {
        finish(new Error(`Codex App Server returned invalid JSON: ${error instanceof Error ? error.message : error}`));
        return;
      }
      if (!isRecord(message)) return;

      if (typeof message.id === "number" && ("result" in message || "error" in message)) {
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        if (message.error !== undefined) request.reject(new Error(`Codex App Server ${errorMessage(message.error)}`));
        else request.resolve(message.result);
        return;
      }

      if (typeof message.method !== "string") return;
      if (isRequestId(message.id)) {
        try {
          write({
            id: message.id,
            error: { code: -32601, message: `Unhandled Codex App Server request: ${message.method}` },
          });
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
        return;
      }
      dispatchNotification({
        method: message.method,
        ...(message.params === undefined ? {} : { params: message.params }),
      });
    });
    lines.on("error", (error) => finish(error));
    child.stdin.on("error", (error) => finish(error instanceof Error ? error : new Error(String(error))));
    child.stdout.on("error", (error) => finish(error));
    child.stderr.on("error", (error) => finish(error));
    child.on("error", (error) => {
      // A failed spawn emits error without exit.
      hasExited = true;
      exited.resolve();
      finish(error);
    });
    child.on("exit", (code) => {
      hasExited = true;
      exited.resolve();
      if (closed) return;
      const diagnostics = stderrTail.trim();
      finish(
        new Error(
          `Codex App Server exited before image generation completed (code ${code ?? "unknown"}).` +
            (diagnostics ? `\n${diagnostics}` : ""),
        ),
      );
    });

    const session: CodexAppServerSession = {
      request: (method, params = {}) =>
        new Promise((resolve, reject) => {
          if (closed || !child.stdin.writable) {
            reject(closed ?? new Error("Codex App Server is not available."));
            return;
          }
          const id = requestId++;
          pending.set(id, { resolve, reject });
          try {
            write({ id, method, params });
          } catch (error) {
            pending.delete(id);
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        }),
      notify: (method, params) => write(params === undefined ? { method } : { method, params }),
      waitForNotification: (match) =>
        new Promise((resolve, reject) => {
          if (closed) {
            reject(closed);
            return;
          }
          waiters.add({ match, resolve, reject });
        }),
    };

    try {
      // Observe failure before starting work, including a caller already aborted during spawn.
      return await Promise.race([
        failure.promise,
        (async () => {
          await session.request("initialize", {
            clientInfo: { name: "overdare-image-generation", title: "OVERDARE Image Generation", version: "0.0.1" },
            capabilities: { experimentalApi: true },
          });
          session.notify("initialized", {});
          return input.run(session);
        })(),
      ]);
    } finally {
      clearTimeout(deadline);
      input.signal?.removeEventListener("abort", onAbort);
      finish(new Error("Codex App Server session closed."));
      // Reap the process on success as well as failure; SIGTERM alone can leave a child running.
      if (!hasExited) {
        const forceKill = setTimeout(() => child.kill("SIGKILL"), options.shutdownGraceMs ?? 1_000);
        try {
          child.kill("SIGTERM");
          await exited.promise;
        } finally {
          clearTimeout(forceKill);
        }
      }
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
    }
  };
}

export const withCodexAppServer = createCodexAppServerConnector();
