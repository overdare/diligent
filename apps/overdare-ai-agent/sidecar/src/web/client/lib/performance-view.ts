// @summary Loads persisted performance data without starting a conversation or touching a live capture.
import { DILIGENT_CLIENT_NOTIFICATION_METHODS, DILIGENT_VERSION } from "@diligent/protocol";
import {
  type PerformanceReadParams,
  PerformanceViewSchema,
  WEB_PERFORMANCE_READ_METHOD,
} from "../../shared/performance-protocol";
import { resolveWebSocketUrl, WebRpcClient } from "./rpc-client";

export async function loadPerformanceView(params: PerformanceReadParams) {
  const rpc = new WebRpcClient(resolveWebSocketUrl(window.location, import.meta.env.VITE_RPC_URL));
  try {
    await rpc.connect();
    await rpc.initialize({
      clientName: "overdare-performance-viewer",
      clientVersion: DILIGENT_VERSION,
      protocolVersion: 1,
    });
    rpc.notify(DILIGENT_CLIENT_NOTIFICATION_METHODS.INITIALIZED, { ready: true });
    return PerformanceViewSchema.parse(await rpc.requestRaw(WEB_PERFORMANCE_READ_METHOD, params));
  } finally {
    rpc.disconnect();
  }
}

/** Subtract the integer origin before conversion: native clocks may exceed Number.MAX_SAFE_INTEGER. */
export function relativeMilliseconds(value: string, origin: string): number {
  return Number(BigInt(value) - BigInt(origin)) / 1e6;
}
