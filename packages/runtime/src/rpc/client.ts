// @summary Shared JSON-RPC client correlation for requests, notifications, and server-initiated requests

import {
  type DiligentClientRequest,
  type DiligentClientResponse,
  DiligentClientResponseSchema,
  type DiligentServerNotification,
  type DiligentServerRequest,
  type DiligentServerRequestResponse,
  DiligentServerRequestResponseSchema,
  JSONRPCErrorResponseSchema,
  type JSONRPCMessage,
  type JSONRPCResponse,
  JSONRPCResponseSchema,
  type RequestId,
} from "../protocol/index";
import type { RpcMessageSink } from "./channel";

type RequestMethod = DiligentClientRequest["method"];
type RequestParams<M extends RequestMethod> = Extract<DiligentClientRequest, { method: M }>["params"];
type RequestResult<M extends RequestMethod> = Extract<DiligentClientResponse, { method: M }>["result"];

interface PendingRequest {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export interface RpcClientHandlers {
  onNotification?: (notification: DiligentServerNotification) => void | Promise<void>;
  onServerRequest?: (request: DiligentServerRequest) => Promise<DiligentServerRequestResponse>;
}

export class RpcClientSession {
  private nextRequestId = 1;
  private readonly pending = new Map<RequestId, PendingRequest>();

  constructor(
    private readonly sink: RpcMessageSink,
    private readonly handlers: RpcClientHandlers = {},
  ) {}

  async request<M extends RequestMethod>(method: M, params: RequestParams<M>): Promise<RequestResult<M>> {
    const id = this.nextRequestId++;
    const result = await new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
      Promise.resolve(this.sink.send({ id, method, params })).catch((error) => {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });

    const parsed = DiligentClientResponseSchema.safeParse({ method, result });
    if (!parsed.success) {
      throw new Error(`Invalid response for method ${method}: ${parsed.error.message}`);
    }

    return parsed.data.result as RequestResult<M>;
  }

  notify(method: string, params?: unknown): Promise<void> | void {
    return this.sink.send(params === undefined ? { method } : { method, params });
  }

  async handleMessage(message: JSONRPCMessage): Promise<void> {
    if ("id" in message && ("result" in message || "error" in message)) {
      this.handleResponse(message);
      return;
    }

    if ("method" in message && !("id" in message)) {
      await this.handlers.onNotification?.(message as DiligentServerNotification);
      return;
    }

    if ("method" in message && "id" in message) {
      const response = await this.handleServerRequest(message.id, message as DiligentServerRequest);
      await this.sink.send(response);
    }
  }

  close(error = new Error("RPC client closed")): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  private handleResponse(message: JSONRPCResponse): void {
    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    this.pending.delete(message.id);

    const errorResponse = JSONRPCErrorResponseSchema.safeParse(message);
    if (errorResponse.success) {
      pending.reject(new Error(errorResponse.data.error.message));
      return;
    }

    const response = JSONRPCResponseSchema.safeParse(message);
    if (!response.success || !("result" in response.data)) {
      pending.reject(new Error("Invalid JSON-RPC response"));
      return;
    }

    pending.resolve(response.data.result);
  }

  private async handleServerRequest(id: RequestId, request: DiligentServerRequest): Promise<JSONRPCMessage> {
    if (!this.handlers.onServerRequest) {
      return JSONRPCErrorResponseSchema.parse({
        id,
        error: { code: -32601, message: `Unhandled server request: ${request.method}` },
      });
    }

    try {
      const response = await this.handlers.onServerRequest(request);
      const parsed = DiligentServerRequestResponseSchema.safeParse(response);
      if (!parsed.success || parsed.data.method !== request.method) {
        return JSONRPCErrorResponseSchema.parse({
          id,
          error: { code: -32602, message: `Invalid server request response for ${request.method}` },
        });
      }

      return { id, result: parsed.data.result };
    } catch (error) {
      return JSONRPCErrorResponseSchema.parse({
        id,
        error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
      });
    }
  }
}
