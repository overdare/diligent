// @summary Creates a real Bun WebSocket server wrapping DiligentAppServer for transport-level e2e tests

import type { JSONRPCMessage } from "@diligent/protocol";
import { JSONRPCMessageSchema } from "@diligent/protocol";
import type { DiligentAppServer, RpcPeer } from "@diligent/runtime";

interface WsData {
  connectionId: string;
}

export interface WsTestServer {
  url: string;
  stop: () => void;
}

/**
 * Wraps a DiligentAppServer in a real Bun WebSocket server on a random OS-assigned port.
 * Used for transport-level e2e tests that need to exercise actual WebSocket serialization.
 */
export function createWsTestServer(appServer: DiligentAppServer): WsTestServer {
  const peerReceivers = new Map<string, (raw: string | Buffer) => void>();
  let nextId = 1;

  const server = Bun.serve<WsData>({
    port: 0, // OS assigns a free port
    fetch(req, bunServer) {
      const url = new URL(req.url);
      if (url.pathname === "/rpc") {
        const connectionId = `ws-test-${nextId++}`;
        const upgraded = bunServer.upgrade(req, { data: { connectionId } });
        if (upgraded) return undefined as unknown as Response;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }
      return new Response("Not found", { status: 404 });
    },
    websocket: {
      open(ws) {
        const { peer, receive } = createWsPeer(ws);
        peerReceivers.set(ws.data.connectionId, receive);
        appServer.connect(ws.data.connectionId, peer);
      },
      message(ws, raw) {
        peerReceivers.get(ws.data.connectionId)?.(raw);
      },
      close(ws) {
        peerReceivers.delete(ws.data.connectionId);
        appServer.disconnect(ws.data.connectionId);
      },
    },
  });

  return {
    url: `ws://localhost:${server.port}/rpc`,
    stop: () => server.stop(),
  };
}

function createWsPeer(ws: import("bun").ServerWebSocket<WsData>): {
  peer: RpcPeer;
  receive: (raw: string | Buffer) => void;
} {
  const listeners: Array<(msg: JSONRPCMessage) => void | Promise<void>> = [];

  const peer: RpcPeer = {
    send(message: JSONRPCMessage): void {
      ws.send(JSON.stringify(message));
    },
    onMessage(listener: (msg: JSONRPCMessage) => void | Promise<void>): void {
      listeners.push(listener);
    },
  };

  const receive = (raw: string | Buffer): void => {
    let parsed: JSONRPCMessage;
    try {
      parsed = JSONRPCMessageSchema.parse(JSON.parse(typeof raw === "string" ? raw : raw.toString()));
    } catch {
      ws.send(JSON.stringify({ id: "unknown", error: { code: -32700, message: "Malformed JSON" } }));
      return;
    }
    for (const listener of listeners) {
      void listener(parsed);
    }
  };

  return { peer, receive };
}
