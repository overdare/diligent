// @summary Transport-neutral JSON-RPC peer interfaces and message classification helpers

import type { JSONRPCMessage, JSONRPCNotification, JSONRPCRequest, JSONRPCResponse } from "@diligent/protocol";

export interface RpcMessageSink {
  send(message: JSONRPCMessage): Promise<void> | void;
}

export interface RpcMessageSource {
  onMessage(listener: (message: JSONRPCMessage) => void | Promise<void>): void;
  onClose?(listener: (error?: Error) => void): void;
}

export interface RpcPeer extends RpcMessageSink, RpcMessageSource {}

export function isRpcResponse(message: JSONRPCMessage): message is JSONRPCResponse {
  return !("method" in message) && ("result" in message || "error" in message);
}

export function isRpcRequest(message: JSONRPCMessage): message is JSONRPCRequest {
  return "method" in message && "id" in message;
}

export function isRpcNotification(message: JSONRPCMessage): message is JSONRPCNotification {
  return "method" in message && !("id" in message);
}
