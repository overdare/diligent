// @summary Shared WebSocket message envelopes for Web CLI JSON-RPC multiplexing
import type {
  DiligentServerNotification,
  DiligentServerRequest,
  DiligentServerRequestResponse,
  JSONRPCNotification,
  JSONRPCResponse,
  Mode,
} from "@diligent/protocol";

export type RpcRequestMessage = {
  type: "rpc_request";
  id: string | number;
  method: string;
  params?: unknown;
};

export type RpcNotifyMessage = {
  type: "rpc_notify";
  method: string;
  params?: unknown;
};

export type RpcResponseMessage = {
  type: "rpc_response";
  response: JSONRPCResponse;
};

export type ServerNotificationMessage = {
  type: "server_notification";
  notification: DiligentServerNotification;
};

export type ServerRequestMessage = {
  type: "server_request";
  id: number;
  request: DiligentServerRequest;
};

export type ServerRequestResponseMessage = {
  type: "server_request_response";
  id: number;
  response: DiligentServerRequestResponse;
};

export type ModelInfo = {
  id: string;
  provider: string;
  contextWindow: number;
  maxOutputTokens: number;
  inputCostPer1M?: number;
  outputCostPer1M?: number;
  supportsThinking?: boolean;
};

export type ConnectedMessage = {
  type: "connected";
  cwd: string;
  mode: Mode;
  serverVersion: string;
  currentModel: string;
  availableModels: ModelInfo[];
};

export type WsClientMessage = RpcRequestMessage | RpcNotifyMessage | ServerRequestResponseMessage;

export type WsServerMessage =
  | ConnectedMessage
  | RpcResponseMessage
  | ServerNotificationMessage
  | ServerRequestMessage
  | {
      type: "error";
      message: string;
    };

export type ProviderAuthStatus = {
  provider: "anthropic" | "openai" | "gemini";
  configured: boolean;
  maskedKey?: string;
  oauthConnected?: boolean;
};

export type OAuthStartResult = {
  authUrl: string;
};

export type OAuthStatusResult = {
  status: "pending" | "completed" | "expired" | "idle";
  error?: string;
};

export function toJsonRpcNotification(notification: DiligentServerNotification): JSONRPCNotification {
  return {
    method: notification.method,
    params: notification.params,
  };
}
