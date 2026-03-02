// @summary WebSocket bridge that multiplexes JSON-RPC calls, notifications, and server requests
import type { DiligentAppServer } from "@diligent/core";
import type {
  DiligentServerNotification,
  DiligentServerRequest,
  DiligentServerRequestResponse,
} from "@diligent/protocol";
import {
  DILIGENT_SERVER_REQUEST_METHODS,
  DiligentServerRequestResponseSchema,
  JSONRPCErrorResponseSchema,
  JSONRPCResponseSchema,
} from "@diligent/protocol";
import type { ServerWebSocket } from "bun";
import type { ConnectedMessage, ModelInfo, WsClientMessage, WsServerMessage } from "../shared/ws-protocol";

interface RpcSession {
  id: string;
  ws: ServerWebSocket<RpcWsData>;
  cwd: string;
  mode: "default" | "plan" | "execute";
  currentThreadId: string | null;
  pendingServerRequests: Map<
    number,
    {
      resolve: (response: DiligentServerRequestResponse) => void;
      timeoutId: ReturnType<typeof setTimeout>;
      request: DiligentServerRequest;
    }
  >;
}

export interface RpcWsData {
  sessionId: string;
}

function toSafeFallback(request: DiligentServerRequest): DiligentServerRequestResponse {
  if (request.method === DILIGENT_SERVER_REQUEST_METHODS.APPROVAL_REQUEST) {
    return {
      method: DILIGENT_SERVER_REQUEST_METHODS.APPROVAL_REQUEST,
      result: { decision: "reject" },
    };
  }

  return {
    method: DILIGENT_SERVER_REQUEST_METHODS.USER_INPUT_REQUEST,
    result: { answers: {} },
  };
}

interface ModelConfig {
  currentModelId: string;
  availableModels: ModelInfo[];
  onModelChange: (modelId: string) => void;
}

export class RpcBridge {
  private readonly sessions = new Map<string, RpcSession>();
  private readonly threadOwners = new Map<string, string>();
  private serverRequestSeq = 0;
  private currentModelId: string;

  constructor(
    private readonly appServer: DiligentAppServer,
    private readonly cwd: string,
    private readonly initialMode: "default" | "plan" | "execute",
    private readonly modelConfig: ModelConfig,
  ) {
    this.currentModelId = modelConfig.currentModelId;
    this.appServer.setNotificationListener(async (notification) => {
      this.routeNotification(notification);
    });

    this.appServer.setServerRequestHandler(async (request) => {
      const threadId = request.params.threadId;
      const session = threadId ? this.findSessionByThreadId(threadId) : null;
      if (!session) {
        return toSafeFallback(request);
      }

      return this.requestFromClient(session.id, request);
    });
  }

  open(ws: ServerWebSocket<RpcWsData>): void {
    const sessionId = ws.data.sessionId;
    const session: RpcSession = {
      id: sessionId,
      ws,
      cwd: this.cwd,
      mode: this.initialMode,
      currentThreadId: null,
      pendingServerRequests: new Map(),
    };

    this.sessions.set(sessionId, session);

    const connected: ConnectedMessage = {
      type: "connected",
      cwd: this.cwd,
      mode: this.initialMode,
      serverVersion: "0.0.1",
      currentModel: this.currentModelId,
      availableModels: this.modelConfig.availableModels,
    };
    this.send(ws, connected);
  }

  close(ws: ServerWebSocket<RpcWsData>): void {
    const session = this.sessions.get(ws.data.sessionId);
    if (!session) return;

    for (const pending of session.pendingServerRequests.values()) {
      clearTimeout(pending.timeoutId);
      pending.resolve(toSafeFallback(pending.request));
    }

    if (session.currentThreadId) {
      this.threadOwners.delete(session.currentThreadId);
    }

    this.sessions.delete(session.id);
  }

  async message(ws: ServerWebSocket<RpcWsData>, raw: string | Buffer): Promise<void> {
    let parsed: WsClientMessage;
    try {
      parsed = JSON.parse(typeof raw === "string" ? raw : raw.toString()) as WsClientMessage;
    } catch {
      this.send(ws, { type: "error", message: "Malformed JSON" });
      return;
    }

    if (parsed.type === "rpc_notify") {
      await this.appServer.handleNotification({ method: parsed.method, params: parsed.params });
      return;
    }

    if (parsed.type === "rpc_request") {
      const session = this.sessions.get(ws.data.sessionId);
      if (!session) {
        this.send(ws, { type: "error", message: "Session not found" });
        return;
      }

      if (parsed.method === "config/set") {
        const params = parsed.params as { model?: string } | undefined;
        const modelId = params?.model;
        if (modelId) {
          const valid = this.modelConfig.availableModels.find((m) => m.id === modelId);
          if (valid) {
            this.currentModelId = modelId;
            this.modelConfig.onModelChange(modelId);
            this.send(ws, {
              type: "rpc_response",
              response: JSONRPCResponseSchema.parse({ id: parsed.id, result: { model: modelId } }),
            });
          } else {
            this.send(ws, {
              type: "rpc_response",
              response: JSONRPCErrorResponseSchema.parse({
                id: parsed.id,
                error: { code: -32602, message: `Unknown model: ${modelId}` },
              }),
            });
          }
        } else {
          this.send(ws, {
            type: "rpc_response",
            response: JSONRPCResponseSchema.parse({ id: parsed.id, result: { model: this.currentModelId } }),
          });
        }
        return;
      }

      const params = this.withSessionDefaults(parsed.method, parsed.params, session);
      const response = await this.appServer.handleRequest({
        id: parsed.id,
        method: parsed.method,
        params,
      });

      if (parsed.method === "thread/start" && "result" in response) {
        const maybeThreadId = (response.result as { threadId?: string }).threadId;
        if (maybeThreadId) {
          if (session.currentThreadId) {
            this.threadOwners.delete(session.currentThreadId);
          }
          session.currentThreadId = maybeThreadId;
          this.threadOwners.set(maybeThreadId, session.id);
        }
      }

      if (parsed.method === "thread/resume" && "result" in response) {
        const resumed = response.result as { found: boolean; threadId?: string };
        if (resumed.found && resumed.threadId) {
          if (session.currentThreadId && session.currentThreadId !== resumed.threadId) {
            this.threadOwners.delete(session.currentThreadId);
          }
          session.currentThreadId = resumed.threadId;
          this.threadOwners.set(resumed.threadId, session.id);
        }
      }

      if (parsed.method === "mode/set" && "result" in response) {
        const mode = (response.result as { mode?: "default" | "plan" | "execute" }).mode;
        if (mode) {
          session.mode = mode;
        }
      }

      this.send(ws, { type: "rpc_response", response });
      return;
    }

    if (parsed.type === "server_request_response") {
      const session = this.sessions.get(ws.data.sessionId);
      if (!session) {
        return;
      }

      const pending = session.pendingServerRequests.get(parsed.id);
      if (!pending) {
        return;
      }

      clearTimeout(pending.timeoutId);
      session.pendingServerRequests.delete(parsed.id);

      const safe = DiligentServerRequestResponseSchema.safeParse(parsed.response);
      if (!safe.success) {
        pending.resolve({
          method: DILIGENT_SERVER_REQUEST_METHODS.APPROVAL_REQUEST,
          result: { decision: "reject" },
        });
        return;
      }

      pending.resolve(safe.data);
    }
  }

  async requestFromClient(sessionId: string, request: DiligentServerRequest): Promise<DiligentServerRequestResponse> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return toSafeFallback(request);
    }

    const requestId = ++this.serverRequestSeq;
    const payload: WsServerMessage = {
      type: "server_request",
      id: requestId,
      request,
    };

    this.send(session.ws, payload);

    return new Promise<DiligentServerRequestResponse>((resolve) => {
      const timeoutId = setTimeout(
        () => {
          session.pendingServerRequests.delete(requestId);
          resolve(toSafeFallback(request));
        },
        5 * 60 * 1000,
      );

      session.pendingServerRequests.set(requestId, {
        resolve,
        timeoutId,
        request,
      });
    });
  }

  private withSessionDefaults(method: string, params: unknown, session: RpcSession): unknown {
    if (!params || typeof params !== "object") {
      return params;
    }

    const objectParams = params as Record<string, unknown>;

    if (method === "thread/start") {
      return {
        ...objectParams,
        cwd: typeof objectParams.cwd === "string" ? objectParams.cwd : session.cwd,
        mode: typeof objectParams.mode === "string" ? objectParams.mode : session.mode,
      };
    }

    if (
      method === "turn/start" ||
      method === "turn/interrupt" ||
      method === "turn/steer" ||
      method === "mode/set" ||
      method === "thread/read" ||
      method === "knowledge/list"
    ) {
      return {
        ...objectParams,
        threadId:
          typeof objectParams.threadId === "string" && objectParams.threadId.length > 0
            ? objectParams.threadId
            : session.currentThreadId,
      };
    }

    return objectParams;
  }

  private routeNotification(notification: DiligentServerNotification): void {
    const params = notification.params as { threadId?: string };
    const threadId = params.threadId;

    if (!threadId) {
      this.broadcast({ type: "server_notification", notification });
      return;
    }

    const ownerSessionId = this.threadOwners.get(threadId);
    if (!ownerSessionId) {
      this.broadcast({ type: "server_notification", notification });
      return;
    }

    const session = this.sessions.get(ownerSessionId);
    if (!session) {
      return;
    }

    this.send(session.ws, { type: "server_notification", notification });
  }

  private broadcast(message: WsServerMessage): void {
    for (const session of this.sessions.values()) {
      this.send(session.ws, message);
    }
  }

  private findSessionByThreadId(threadId: string): RpcSession | null {
    const sessionId = this.threadOwners.get(threadId);
    if (!sessionId) return null;
    return this.sessions.get(sessionId) ?? null;
  }

  private send(ws: ServerWebSocket<RpcWsData>, message: WsServerMessage): void {
    ws.send(JSON.stringify(message));
  }
}

export function parseRpcResponse(raw: unknown): { ok: boolean; error?: string } {
  const parsed = JSONRPCResponseSchema.safeParse(raw);
  if (parsed.success) return { ok: true };

  const errorParsed = JSONRPCErrorResponseSchema.safeParse(raw);
  if (errorParsed.success) return { ok: false, error: errorParsed.data.error.message };

  return { ok: false, error: "invalid response" };
}
