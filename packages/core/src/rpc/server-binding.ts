// @summary Transport-neutral binding between DiligentAppServer and a JSON-RPC peer

import type { DiligentAppServer } from "../app-server/server";
import type { RpcPeer } from "./channel";

export function bindAppServer(server: DiligentAppServer, peer: RpcPeer): () => void {
  const id = crypto.randomUUID();
  return server.connect(id, peer);
}
