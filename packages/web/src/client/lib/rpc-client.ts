// @summary Browser WebSocket JSON-RPC client with reconnect support and server-request handling
import type {
  DiligentClientRequest,
  DiligentClientResponse,
  DiligentServerNotification,
  DiligentServerRequest,
  DiligentServerRequestResponse,
  DiligentWebRequest,
  DiligentWebResponse,
  JSONRPCResponse,
  Mode,
  ModelInfo,
} from "@diligent/protocol";
import { DILIGENT_WEB_REQUEST_METHODS } from "@diligent/protocol";
import type { WsServerMessage } from "../../shared/ws-protocol";

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";
export const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 5000, 5000] as const;

type RequestMethod = DiligentClientRequest["method"];
type RequestParams<M extends RequestMethod> = Extract<DiligentClientRequest, { method: M }>["params"];
type RequestResult<M extends RequestMethod> = Extract<DiligentClientResponse, { method: M }>["result"];

type WebMethod = DiligentWebRequest["method"];
type WebParams<M extends WebMethod> = Extract<DiligentWebRequest, { method: M }>["params"];
type WebResult<M extends WebMethod> = Extract<DiligentWebResponse, { method: M }>["result"];

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

interface ConnectedPayload {
  cwd: string;
  mode: Mode;
  serverVersion: string;
  currentModel: string | undefined;
  availableModels: ModelInfo[];
}

export class WebRpcClient {
  private ws: WebSocket | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly reconnectDelays = [...RECONNECT_DELAYS_MS];
  private reconnectAttempts = 0;
  private stopped = false;

  private readonly activeSubscriptions = new Map<string, string>(); // subscriptionId → threadId

  private connectionListener: ((state: ConnectionState) => void) | null = null;
  private connectedListener: ((payload: ConnectedPayload) => void) | null = null;
  private notificationListener: ((notification: DiligentServerNotification) => void) | null = null;
  private serverRequestListener: ((id: number, request: DiligentServerRequest) => void) | null = null;
  private serverRequestResolvedListener: ((id: number) => void) | null = null;

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

  onServerRequestResolved(listener: ((id: number) => void) | null): void {
    this.serverRequestResolvedListener = listener;
  }

  async connect(): Promise<void> {
    this.stopped = false;
    this.emitConnection("connecting");
    try {
      await this.openSocket();
    } catch {
      if (this.stopped) {
        this.emitConnection("disconnected");
        return;
      }
      await this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.stopped = true;
    this.ws?.close();
    this.ws = null;
    this.activeSubscriptions.clear();
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

  async webRequest<M extends WebMethod>(method: M, params: WebParams<M>, timeoutMs = 30_000): Promise<WebResult<M>> {
    return this.requestRaw(method, params, timeoutMs) as Promise<WebResult<M>>;
  }

  async requestRaw(method: string, params: unknown, timeoutMs = 30_000): Promise<unknown> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not connected");
    }

    const id = this.nextRequestId++;
    const payload = { type: "rpc_request" as const, id, method, params };

    return new Promise<unknown>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC timeout for ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timeoutId });
      ws.send(JSON.stringify(payload));
    });
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

  async subscribe(threadId: string): Promise<{ subscriptionId: string }> {
    const result = (await this.webRequest(DILIGENT_WEB_REQUEST_METHODS.THREAD_SUBSCRIBE, { threadId })) as {
      subscriptionId: string;
    };
    this.activeSubscriptions.set(result.subscriptionId, threadId);
    return result;
  }

  async unsubscribe(subscriptionId: string): Promise<{ ok: boolean }> {
    const result = (await this.webRequest(DILIGENT_WEB_REQUEST_METHODS.THREAD_UNSUBSCRIBE, { subscriptionId })) as {
      ok: boolean;
    };
    if (result.ok) {
      this.activeSubscriptions.delete(subscriptionId);
    }
    return result;
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
      let settled = false;

      ws.onopen = () => {
        if (settled) return;
        settled = true;
        this.reconnectAttempts = 0;
        this.emitConnection("connected");
        resolve();
      };

      ws.onerror = () => {
        if (settled) return;
        settled = true;
        this.ws = null;
        ws.onclose = null;
        reject(new Error("WebSocket open failed"));
      };

      ws.onclose = () => {
        this.ws = null;
        if (!settled) {
          settled = true;
          reject(new Error("WebSocket open failed"));
          return;
        }
        if (this.stopped) {
          this.emitConnection("disconnected");
          return;
        }
        void this.scheduleReconnect();
      };

      ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };
    }).catch((error) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
      throw error;
    });

    if (this.ws !== ws) {
      if (this.stopped) {
        this.emitConnection("disconnected");
        return;
      }
      void this.scheduleReconnect();
    }
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
      this.resubscribeAll();
      this.connectedListener?.({
        cwd: message.cwd,
        mode: message.mode,
        serverVersion: message.serverVersion,
        currentModel: message.currentModel,
        availableModels: message.availableModels,
      });
      return;
    }

    if (message.type === "rpc_response") {
      this.handleRpcResponse(message.response);
      return;
    }

    if (message.type === "server_notification") {
      if (message.notification.method.startsWith("collab/")) {
        const params = message.notification.params as { threadId?: string; callId?: string; childThreadId?: string };
        console.log("[WebRpcClient][collab] received server_notification", {
          method: message.notification.method,
          threadId: params.threadId,
          callId: params.callId,
          childThreadId: params.childThreadId,
        });
      }
      this.notificationListener?.(message.notification);
      return;
    }

    if (message.type === "server_request") {
      this.serverRequestListener?.(message.id, message.request);
      return;
    }

    if (message.type === "server_request_resolved") {
      this.serverRequestResolvedListener?.(message.id);
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

  private resubscribeAll(): void {
    // Collect unique threadIds, then clear old (now-invalid) subscriptionIds
    const threadIds = new Set(this.activeSubscriptions.values());
    this.activeSubscriptions.clear();

    for (const threadId of threadIds) {
      // Fire-and-forget — subscribe() will re-populate activeSubscriptions
      void this.subscribe(threadId).catch(() => {});
    }
  }

  private emitConnection(state: ConnectionState): void {
    this.connectionListener?.(state);
  }
}

export function getReconnectDelay(attempt: number): number {
  return RECONNECT_DELAYS_MS[Math.min(Math.max(attempt, 0), RECONNECT_DELAYS_MS.length - 1)];
}

export function getReconnectAttemptLimit(): number {
  return RECONNECT_DELAYS_MS.length;
}
