// @summary Child-process-backed JSON-RPC client for TUI/app-server stdio communication

import { createNdjsonParser, formatNdjsonMessage } from "@diligent/core";
import {
  DILIGENT_SERVER_REQUEST_METHODS,
  type DiligentClientRequest,
  type DiligentClientResponse,
  type DiligentServerNotification,
  type DiligentServerRequest,
  type DiligentServerRequestResponse,
  JSONRPCErrorResponseSchema,
  type JSONRPCMessage,
  type JSONRPCResponse,
  type RequestId,
} from "@diligent/protocol";

type CliRequestMethod = DiligentClientRequest["method"];
type CliRequestParams<M extends CliRequestMethod> = Extract<DiligentClientRequest, { method: M }>["params"];
type CliRequestResult<M extends CliRequestMethod> = Extract<DiligentClientResponse, { method: M }>["result"];

export interface AppServerRpcClient {
  request<M extends CliRequestMethod>(method: M, params: CliRequestParams<M>): Promise<CliRequestResult<M>>;
  notify(method: string, params?: unknown): Promise<void> | void;
  setNotificationListener(listener: ((notification: DiligentServerNotification) => void | Promise<void>) | null): void;
  setServerRequestHandler(
    handler: ((requestId: RequestId, request: DiligentServerRequest) => Promise<DiligentServerRequestResponse>) | null,
  ): void;
  dispose(): Promise<void>;
}

export interface SpawnedAppServer extends AppServerRpcClient {}

interface ChildProcessLike {
  stdin: WritableStream | null;
  stdout: ReadableStream | null;
  stderr: ReadableStream | null;
  exited: Promise<number>;
  kill(signal?: string | number): void;
}

interface WritableStream {
  write(chunk: string): number | Promise<number>;
  end(): void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

const DEFAULT_FATAL_APPROVAL: DiligentServerRequestResponse = {
  method: DILIGENT_SERVER_REQUEST_METHODS.APPROVAL_REQUEST,
  result: { decision: "once" },
};

const DEFAULT_FATAL_USER_INPUT: DiligentServerRequestResponse = {
  method: DILIGENT_SERVER_REQUEST_METHODS.USER_INPUT_REQUEST,
  result: { answers: {} },
};

export class StdioAppServerRpcClient implements SpawnedAppServer {
  private readonly stdoutReader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly stderrReader: ReadableStreamDefaultReader<Uint8Array> | null;
  private readonly fatalErrorPrefix: string;
  private notificationListener: ((notification: DiligentServerNotification) => void | Promise<void>) | null = null;
  private serverRequestHandler:
    | ((requestId: RequestId, request: DiligentServerRequest) => Promise<DiligentServerRequestResponse>)
    | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<RequestId, PendingRequest>();
  private closed = false;
  private readonly readLoop: Promise<void>;
  private readonly stderrLoop: Promise<void> | null;
  private fatalError: Error | null = null;

  constructor(
    private readonly child: ChildProcessLike,
    private readonly onStderrLine?: (line: string) => void,
  ) {
    this.fatalErrorPrefix = "App-server exited";
    if (!child.stdin || !child.stdout) {
      throw new Error("Spawned app-server requires piped stdin/stdout");
    }

    this.stdoutReader = child.stdout.getReader();
    this.stderrReader = child.stderr?.getReader() ?? null;

    this.readLoop = this.consumeStdout();
    this.stderrLoop = this.consumeStderr();

    void child.exited.then((code) => {
      if (this.closed) {
        return;
      }
      if (code !== 0 && !this.fatalError) {
        this.fatalError = new Error(this.buildExitMessage(code));
      }
      this.closed = true;
      this.rejectPending(this.fatalError ?? new Error(this.buildExitMessage(code)));
    });
  }

  setNotificationListener(listener: ((notification: DiligentServerNotification) => void | Promise<void>) | null): void {
    this.notificationListener = listener;
  }

  setServerRequestHandler(
    handler: ((requestId: RequestId, request: DiligentServerRequest) => Promise<DiligentServerRequestResponse>) | null,
  ): void {
    this.serverRequestHandler = handler;
  }

  async request<M extends CliRequestMethod>(method: M, params: CliRequestParams<M>): Promise<CliRequestResult<M>> {
    this.ensureOpen();
    const id = this.nextRequestId++;
    const result = await new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      Promise.resolve(this.child.stdin!.write(formatNdjsonMessage({ id, method, params }))).catch((error) => {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
    return result as CliRequestResult<M>;
  }

  notify(method: string, params?: unknown): Promise<void> | void {
    this.ensureOpen();
    const message = params === undefined ? { method } : { method, params };
    const result = this.child.stdin!.write(formatNdjsonMessage(message));
    if (result instanceof Promise) {
      return result.then(() => {});
    }
  }

  async dispose(): Promise<void> {
    if (this.closed) {
      await Promise.allSettled([this.child.exited, this.readLoop, this.stderrLoop ?? Promise.resolve()]);
      return;
    }
    this.closed = true;
    try {
      this.child.stdin?.end();
    } catch {
      // ignore shutdown races
    }
    this.child.kill();
    this.rejectPending(new Error("RPC client disposed"));
    try {
      this.stdoutReader.releaseLock();
    } catch {
      // ignore closed stream errors
    }
    try {
      this.stderrReader?.releaseLock();
    } catch {
      // ignore closed stream errors
    }
    await Promise.allSettled([this.child.exited, this.readLoop, this.stderrLoop ?? Promise.resolve()]);
  }

  private async consumeStdout(): Promise<void> {
    const decoder = new TextDecoder();
    const parser = createNdjsonParser((message) => {
      void this.handleMessage(message).catch((error) => {
        this.fatalError = error instanceof Error ? error : new Error(String(error));
        this.rejectPending(this.fatalError);
        this.child.kill();
      });
    });

    try {
      while (true) {
        const { done, value } = await this.stdoutReader.read();
        if (done) break;
        parser.push(decoder.decode(value, { stream: true }));
      }
      parser.end();
    } catch (error) {
      if (!this.closed) {
        this.fatalError = error instanceof Error ? error : new Error(String(error));
        this.rejectPending(this.fatalError);
      }
    }
  }

  private async consumeStderr(): Promise<void> {
    if (!this.stderrReader || !this.onStderrLine) {
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await this.stderrReader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trimEnd();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) {
          this.onStderrLine(line);
        }
        newlineIndex = buffer.indexOf("\n");
      }
    }

    const tail = buffer.trimEnd();
    if (tail) {
      this.onStderrLine(tail);
    }
  }

  private async handleMessage(message: JSONRPCMessage): Promise<void> {
    if ("id" in message && ("result" in message || "error" in message)) {
      this.handleResponse(message);
      return;
    }

    if ("method" in message && !("id" in message)) {
      await this.notificationListener?.(message as DiligentServerNotification);
      return;
    }

    if ("method" in message && "id" in message) {
      const response = await this.handleServerRequest(message.id, message as DiligentServerRequest);
      await this.child.stdin!.write(formatNdjsonMessage(response));
    }
  }

  private handleResponse(message: JSONRPCResponse): void {
    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    this.pending.delete(message.id);

    if ("error" in message) {
      pending.reject(new Error(message.error.message));
      return;
    }

    pending.resolve(message.result);
  }

  private async handleServerRequest(id: RequestId, request: DiligentServerRequest): Promise<JSONRPCResponse> {
    try {
      const response = this.serverRequestHandler
        ? await this.serverRequestHandler(id, request)
        : request.method === DILIGENT_SERVER_REQUEST_METHODS.APPROVAL_REQUEST
          ? DEFAULT_FATAL_APPROVAL
          : DEFAULT_FATAL_USER_INPUT;

      return { id, result: response.result };
    } catch (error) {
      return JSONRPCErrorResponseSchema.parse({
        id,
        error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  private ensureOpen(): void {
    if (this.fatalError) {
      throw this.fatalError;
    }
    if (this.closed) {
      throw new Error("App-server RPC client is closed");
    }
  }

  private buildExitMessage(code: number): string {
    return `${this.fatalErrorPrefix} with code ${code}`;
  }
}
