// @summary Correlates Codex JSON-RPC responses and buffers notifications independently of request callers.

import { EventStream } from "@diligent/core/event-stream";
import type { CodexProcess } from "./process";

export interface CodexNotification {
  method: string;
  params?: unknown;
}

type PendingRequest = ReturnType<typeof Promise.withResolvers<unknown>>;

export class CodexRpcClient {
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly events = new EventStream<CodexNotification, void>(
    () => false,
    () => {},
  );
  private readonly reader: Promise<void>;
  private failure?: Error;
  private shutdown?: Promise<void>;

  constructor(private readonly transport: Pick<CodexProcess, "readLine" | "writeLine" | "close">) {
    // A connection may fail before anyone starts consuming notifications.
    void this.events.result().catch(() => {});
    this.reader = this.readMessages();
  }

  async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.failure) throw this.failure;
    const id = this.nextRequestId++;
    const response = Promise.withResolvers<unknown>();
    this.pending.set(id, response);
    try {
      this.transport.writeLine(JSON.stringify({ id, method, params }));
      return await response.promise;
    } finally {
      this.pending.delete(id);
    }
  }

  notify(method: string, params: Record<string, unknown>): void {
    if (this.failure) throw this.failure;
    this.transport.writeLine(JSON.stringify({ method, params }));
  }

  async *notifications(): AsyncGenerator<CodexNotification> {
    yield* this.events;
    await this.events.result();
  }

  close(): Promise<void> {
    this.shutdown ??= this.dispose();
    return this.shutdown;
  }

  private async readMessages(): Promise<void> {
    try {
      while (!this.failure) {
        const message = parseMessage(await this.transport.readLine());
        if (message) this.dispatch(message);
      }
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private dispatch(message: Record<string, unknown>): void {
    if (typeof message.method === "string") {
      if (typeof message.id === "string" || typeof message.id === "number") {
        // Nested agents cannot delegate approvals or tool execution to this client.
        this.transport.writeLine(
          JSON.stringify({
            id: message.id,
            error: { code: -32601, message: `Unhandled Codex App Server request: ${message.method}` },
          }),
        );
      } else {
        this.events.push({ method: message.method, params: message.params });
      }
      return;
    }

    if (typeof message.id !== "number") return;
    const response = this.pending.get(message.id);
    if (!response) return;
    this.pending.delete(message.id);
    if ("error" in message) {
      const reason =
        isRecord(message.error) && typeof message.error.message === "string" ? message.error.message : "request failed";
      response.reject(new Error(`Codex App Server ${reason}`));
    } else if ("result" in message) {
      response.resolve(message.result);
    } else {
      response.reject(new Error("Codex App Server returned an invalid response."));
    }
  }

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    for (const response of this.pending.values()) response.reject(error);
    this.pending.clear();
    this.events.error(error);
  }

  private async dispose(): Promise<void> {
    this.fail(new Error("Codex App Server connection closed."));
    await this.transport.close();
    await this.reader;
  }
}

function parseMessage(line: string): Record<string, unknown> | undefined {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    throw new Error("Codex App Server returned invalid JSON.");
  }
  return isRecord(message) ? message : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
