// @summary Shared WebSocket message envelopes for Web CLI JSON-RPC multiplexing
import type {
  DiligentServerNotification,
  DiligentServerRequest,
  DiligentServerRequestResponse,
  JSONRPCNotification,
  JSONRPCResponse,
  Mode,
  ModelInfo,
} from "@diligent/protocol";
export type { ModelInfo } from "@diligent/protocol";

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

export type ConnectedMessage = {
  type: "connected";
  cwd: string;
  mode: Mode;
  serverVersion: string;
  currentModel: string | undefined;
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

export type OAuthStartResult = {
  authUrl: string;
};

export function toJsonRpcNotification(notification: DiligentServerNotification): JSONRPCNotification {
  return {
    method: notification.method,
    params: notification.params,
  };
}
