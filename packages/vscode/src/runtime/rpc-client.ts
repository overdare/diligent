// @summary NDJSON JSON-RPC client over a spawned Diligent app-server stdio transport
import type { Readable, Writable } from "node:stream";
import type {
  DiligentClientRequest,
  DiligentClientResponse,
  DiligentServerNotification,
  DiligentServerRequest,
  DiligentServerRequestResponse,
  JSONRPCErrorResponse,
  JSONRPCMessage,
  JSONRPCNotification,
  JSONRPCResponse,
  JSONRPCSuccessResponse,
  RequestId,
} from "@diligent/protocol";
import {
  DiligentClientResponseSchema,
  DiligentServerRequestResponseSchema,
  JSONRPCMessageSchema,
} from "@diligent/protocol";
import { createNdjsonParser, formatNdjsonMessage } from "@diligent/runtime";

type RequestMethod = DiligentClientRequest["method"];
type RequestParams<M extends RequestMethod> = Extract<DiligentClientRequest, { method: M }>["params"];
type RequestResult<M extends RequestMethod> = Extract<DiligentClientResponse, { method: M }>["result"];

interface PendingRequest {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface DisposableLike {
  dispose(): void;
}

export interface RpcClientTransport {
  stdin: Writable;
  stdout: Readable;
  stderr?: Readable;
  kill(): void;
  exit?: Promise<number | null>;
}

export class DiligentRpcClient {
  private transport: RpcClientTransport | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<RequestId, PendingRequest>();
  private readonly notificationListeners = new Set<(message: DiligentServerNotification) => void>();
  private readonly serverRequestListeners = new Set<
    (requestId: RequestId, message: DiligentServerRequest) => Promise<DiligentServerRequestResponse>
  >();
  private readonly stderrListeners = new Set<(line: string) => void>();
  private closed = true;

  async start(transport: RpcClientTransport): Promise<void> {
    if (!this.closed) {
      return;
    }
    this.transport = transport;
    this.closed = false;
    this.consumeStdout(transport.stdout);
    this.consumeStderr(transport.stderr);
    void transport.exit?.then((code) => {
      if (!this.closed && code !== 0) {
        this.rejectAll(new Error(`Diligent app-server exited with code ${code}`));
      }
      this.closed = true;
    });
  }

  onNotification(listener: (message: DiligentServerNotification) => void): DisposableLike {
    this.notificationListeners.add(listener);
    return { dispose: () => this.notificationListeners.delete(listener) };
  }

  onServerRequest(
    listener: (requestId: RequestId, message: DiligentServerRequest) => Promise<DiligentServerRequestResponse>,
  ): DisposableLike {
    this.serverRequestListeners.add(listener);
    return { dispose: () => this.serverRequestListeners.delete(listener) };
  }

  onStderr(listener: (line: string) => void): DisposableLike {
    this.stderrListeners.add(listener);
    return { dispose: () => this.stderrListeners.delete(listener) };
  }

  async request<M extends RequestMethod>(method: M, params: RequestParams<M>): Promise<RequestResult<M>> {
    this.ensureOpen();
    const id = this.nextRequestId++;
    const result = await new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
      this.write({ id, method, params }).catch((error) => {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });

    const parsed = DiligentClientResponseSchema.safeParse({ method, result });
    if (!parsed.success) {
      throw new Error(`Invalid response for ${method}: ${parsed.error.message}`);
    }
    return parsed.data.result as RequestResult<M>;
  }

  async notify(method: string, params?: unknown): Promise<void> {
    const payload: JSONRPCNotification = params === undefined ? { method } : { method, params };
    await this.write(payload);
  }

  async dispose(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.transport?.kill();
    this.rejectAll(new Error("Diligent RPC client disposed"));
    await this.transport?.exit?.catch(() => undefined);
    this.transport = null;
  }

  private consumeStdout(stdout: Readable): void {
    const parser = createNdjsonParser((message) => {
      void this.handleIncoming(message);
    });
    stdout.setEncoding("utf8");
    stdout.on("data", (chunk: string) => {
      parser.push(chunk);
    });
    stdout.on("end", () => {
      parser.end();
    });
    stdout.on("error", (error) => {
      this.rejectAll(error instanceof Error ? error : new Error(String(error)));
    });
  }

  private consumeStderr(stderr?: Readable): void {
    if (!stderr) {
      return;
    }
    stderr.setEncoding("utf8");
    let buffer = "";
    stderr.on("data", (chunk: string) => {
      buffer += chunk;
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trimEnd();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) {
          for (const listener of this.stderrListeners) {
            listener(line);
          }
        }
        newlineIndex = buffer.indexOf("\n");
      }
    });
    stderr.on("end", () => {
      const tail = buffer.trimEnd();
      if (!tail) {
        return;
      }
      for (const listener of this.stderrListeners) {
        listener(tail);
      }
    });
  }

  private async handleIncoming(message: JSONRPCMessage): Promise<void> {
    const parsed = JSONRPCMessageSchema.safeParse(message);
    if (!parsed.success) {
      return;
    }

    if (this.isResponse(parsed.data)) {
      this.handleResponse(parsed.data);
      return;
    }

    if (this.isServerRequest(parsed.data)) {
      await this.handleServerRequest(parsed.data.id, parsed.data as DiligentServerRequest);
      return;
    }

    for (const listener of this.notificationListeners) {
      listener(parsed.data as DiligentServerNotification);
    }
  }

  private handleResponse(message: JSONRPCResponse): void {
    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    this.pending.delete(message.id);

    if (this.isErrorResponse(message)) {
      pending.reject(new Error(message.error.message));
      return;
    }

    pending.resolve((message as JSONRPCSuccessResponse).result);
  }

  private async handleServerRequest(requestId: RequestId, message: DiligentServerRequest): Promise<void> {
    for (const listener of this.serverRequestListeners) {
      const response = await listener(requestId, message);
      const parsed = DiligentServerRequestResponseSchema.safeParse(response);
      if (!parsed.success || parsed.data.method !== message.method) {
        continue;
      }
      await this.write({ id: requestId, result: parsed.data.result });
      return;
    }

    await this.write({
      id: requestId,
      error: { code: -32601, message: `Unhandled server request: ${message.method}` },
    });
  }

  private async write(message: JSONRPCMessage): Promise<void> {
    this.ensureOpen();
    const writable = this.transport?.stdin;
    if (!writable) {
      throw new Error("Diligent transport is not available");
    }
    const frame = formatNdjsonMessage(message);
    await new Promise<void>((resolve, reject) => {
      writable.write(frame, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  private ensureOpen(): void {
    if (this.closed || !this.transport) {
      throw new Error("Diligent RPC client is not connected");
    }
  }

  private isResponse(message: JSONRPCMessage): message is JSONRPCResponse {
    return "id" in message && ("result" in message || "error" in message);
  }

  private isErrorResponse(message: JSONRPCResponse): message is JSONRPCErrorResponse {
    return "error" in message;
  }

  private isServerRequest(message: JSONRPCMessage): message is DiligentServerRequest & { id: RequestId } {
    return "id" in message && "method" in message;
  }
}
