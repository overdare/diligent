// @summary Read a file over the shared protocol without changing conversation lifecycle
import { DILIGENT_CLIENT_NOTIFICATION_METHODS, DILIGENT_VERSION, type FileReadResponse } from "@diligent/protocol";
import { resolveWebSocketUrl, WebRpcClient } from "./rpc-client";

export async function loadFilePreview(path: string, threadId?: string): Promise<FileReadResponse> {
  const rpc = new WebRpcClient(resolveWebSocketUrl(window.location, import.meta.env.VITE_RPC_URL));
  try {
    await rpc.connect();
    await rpc.initialize({ clientName: "diligent-file-preview", clientVersion: DILIGENT_VERSION, protocolVersion: 1 });
    rpc.notify(DILIGENT_CLIENT_NOTIFICATION_METHODS.INITIALIZED, { ready: true });
    return await rpc.request("file/read", { path, threadId });
  } finally {
    rpc.disconnect();
  }
}
