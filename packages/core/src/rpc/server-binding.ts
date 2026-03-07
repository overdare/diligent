// @summary Transport-neutral binding between DiligentAppServer and a JSON-RPC peer

import {
  DILIGENT_SERVER_REQUEST_METHODS,
  type DiligentServerRequestResponse,
  DiligentServerRequestResponseSchema,
  type RequestId,
} from "@diligent/protocol";
import type { DiligentAppServer } from "../app-server/server";
import type { RpcPeer } from "./channel";
import { isRpcNotification, isRpcRequest, isRpcResponse } from "./channel";

export function bindAppServer(server: DiligentAppServer, peer: RpcPeer): () => void {
  const pendingServerRequests = new Map<
    RequestId,
    { method: string; resolve: (response: DiligentServerRequestResponse) => void }
  >();
  let closed = false;

  server.setNotificationListener(async (notification) => {
    if (closed) return;
    await peer.send(notification);
  });

  server.setServerRequestHandler(async (request) => {
    if (closed) {
      throw new Error("RPC peer is closed");
    }

    const id = crypto.randomUUID();
    return await new Promise<DiligentServerRequestResponse>((resolve, reject) => {
      pendingServerRequests.set(id, { method: request.method, resolve });
      Promise.resolve(peer.send({ id, method: request.method, params: request.params })).catch((error) => {
        pendingServerRequests.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  });

  peer.onMessage(async (message) => {
    if (closed) return;

    if (isRpcRequest(message)) {
      const response = await server.handleRequest(message);
      await peer.send(response);
      return;
    }

    if (isRpcNotification(message)) {
      await server.handleNotification(message);
      return;
    }

    if (isRpcResponse(message)) {
      const pending = pendingServerRequests.get(message.id);
      if (!pending) {
        return;
      }
      pendingServerRequests.delete(message.id);

      if ("error" in message) {
        pending.resolve(fallbackServerRequestResponse(pending.method));
        return;
      }

      const parsed = DiligentServerRequestResponseSchema.safeParse({ method: pending.method, result: message.result });
      if (!parsed.success) {
        pending.resolve(fallbackServerRequestResponse(pending.method));
        return;
      }

      pending.resolve(parsed.data);
    }
  });

  peer.onClose?.(() => {
    closed = true;
    for (const [id, pending] of pendingServerRequests) {
      pending.resolve(fallbackServerRequestResponse(pending.method));
      pendingServerRequests.delete(id);
    }
    server.setNotificationListener(null);
    server.setServerRequestHandler(null);
  });

  return () => {
    closed = true;
    for (const [id, pending] of pendingServerRequests) {
      pending.resolve(fallbackServerRequestResponse(pending.method));
      pendingServerRequests.delete(id);
    }
    server.setNotificationListener(null);
    server.setServerRequestHandler(null);
  };
}

function fallbackServerRequestResponse(method: string): DiligentServerRequestResponse {
  const parsed = DiligentServerRequestResponseSchema.safeParse(
    method === DILIGENT_SERVER_REQUEST_METHODS.APPROVAL_REQUEST
      ? { method, result: { decision: "reject" } }
      : { method, result: { answers: {} } },
  );

  if (parsed.success) {
    return parsed.data;
  }

  throw new Error(`Unable to build fallback response for ${method}`);
}
