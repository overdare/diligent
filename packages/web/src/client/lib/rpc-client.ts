// @summary Browser WebSocket JSON-RPC client with reconnect support and server-request handling
import type {
  DiligentClientRequest,
  DiligentClientResponse,
  DiligentServerNotification,
  DiligentServerRequest,
  DiligentServerRequestResponse,
  JSONRPCResponse,
} from "@diligent/protocol";
import type { WsServerMessage } from "../../shared/ws-protocol";

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";

type RequestMethod = DiligentClientRequest["method"];
type RequestParams<M extends RequestMethod> = Extract<DiligentClientRequest, { method: M }>["params"];
type RequestResult<M extends RequestMethod> = Extract<DiligentClientResponse, { method: M }>["result"];

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

interface ConnectedPayload {
  cwd: string;
  mode: "default" | "plan" | "execute";
  serverVersion: string;
}

export class WebRpcClient {
  private ws: WebSocket | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly reconnectDelays = [1000, 2000, 5000, 5000, 5000];
  private reconnectAttempts = 0;
  private stopped = false;

  private connectionListener: ((state: ConnectionState) => void) | null = null;
  private connectedListener: ((payload: ConnectedPayload) => void) | null = null;
  private notificationListener: ((notification: DiligentServerNotification) => void) | null = null;
  private serverRequestListener: ((id: number, request: DiligentServerRequest) => void) | null = null;

  constructor(private readonly url: string) {}

  onConnectionChange(listener: ((state: ConnectionState) => void) | null): void {
    this.connectionListener = listener;
  }

  onConnected(listener: ((payload: ConnectedPayload) => void) | null): void {
    this.connectedListener = listener;
  }

  onNotification(listener: ((notification: DiligentServerNotification) => void) | null): void {
    this.notificationListener = listener;
  }

  onServerRequest(listener: ((id: number, request: DiligentServerRequest) => void) | null): void {
    this.serverRequestListener = listener;
  }

  async connect(): Promise<void> {
    this.stopped = false;
    this.emitConnection("connecting");
    await this.openSocket();
  }

  disconnect(): void {
    this.stopped = true;
    this.ws?.close();
    this.ws = null;
    this.rejectPending("disconnected");
    this.emitConnection("disconnected");
  }

  async request<M extends RequestMethod>(
    method: M,
    params: RequestParams<M>,
    timeoutMs = 30_000,
  ): Promise<RequestResult<M>> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not connected");
    }

    const id = this.nextRequestId++;
    const payload = {
      type: "rpc_request" as const,
      id,
      method,
      params,
    };

    const result = await new Promise<unknown>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC timeout for ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timeoutId });
      ws.send(JSON.stringify(payload));
    });

    return result as RequestResult<M>;
  }

  notify(method: string, params?: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.ws.send(
      JSON.stringify({
        type: "rpc_notify",
        method,
        params,
      }),
    );
  }

  respondServerRequest(id: number, response: DiligentServerRequestResponse): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.ws.send(
      JSON.stringify({
        type: "server_request_response",
        id,
        response,
      }),
    );
  }

  private async openSocket(): Promise<void> {
    const ws = new WebSocket(this.url);
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.emitConnection("connected");
        resolve();
      };

      ws.onerror = () => {
        reject(new Error("WebSocket open failed"));
      };
    });

    ws.onmessage = (event) => {
      this.handleMessage(event.data);
    };

    ws.onclose = () => {
      this.ws = null;
      if (this.stopped) {
        this.emitConnection("disconnected");
        return;
      }
      void this.scheduleReconnect();
    };
  }

  private async scheduleReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.reconnectDelays.length) {
      this.emitConnection("disconnected");
      this.rejectPending("reconnect attempts exhausted");
      return;
    }

    const delay = this.reconnectDelays[this.reconnectAttempts++];
    this.emitConnection("reconnecting");
    await new Promise((resolve) => setTimeout(resolve, delay));

    if (this.stopped) {
      this.emitConnection("disconnected");
      return;
    }

    try {
      await this.openSocket();
    } catch {
      await this.scheduleReconnect();
    }
  }

  private handleMessage(raw: unknown): void {
    let message: WsServerMessage;
    try {
      message = JSON.parse(String(raw)) as WsServerMessage;
    } catch {
      return;
    }

    if (message.type === "connected") {
      this.connectedListener?.({
        cwd: message.cwd,
        mode: message.mode,
        serverVersion: message.serverVersion,
      });
      return;
    }

    if (message.type === "rpc_response") {
      this.handleRpcResponse(message.response);
      return;
    }

    if (message.type === "server_notification") {
      this.notificationListener?.(message.notification);
      return;
    }

    if (message.type === "server_request") {
      this.serverRequestListener?.(message.id, message.request);
    }
  }

  private handleRpcResponse(response: JSONRPCResponse): void {
    const id = Number(response.id);
    const pending = this.pending.get(id);
    if (!pending) return;

    clearTimeout(pending.timeoutId);
    this.pending.delete(id);

    if ("error" in response) {
      pending.reject(new Error(response.error.message));
      return;
    }

    pending.resolve(response.result);
  }

  private rejectPending(reason: string): void {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error(reason));
      this.pending.delete(id);
    }
  }

  private emitConnection(state: ConnectionState): void {
    this.connectionListener?.(state);
  }
}

export function getReconnectDelay(attempt: number): number {
  const delays = [1000, 2000, 5000, 5000, 5000];
  return delays[Math.min(Math.max(attempt, 0), delays.length - 1)];
}
