// @summary RPC helpers for provider authentication (list, set, remove, OAuth start)
import type { ProviderAuthStatus } from "@diligent/protocol";
import type { ModelInfo, OAuthStartResult } from "../../shared/ws-protocol";
import type { WebRpcClient } from "./rpc-client";

export interface AuthListResult {
  providers: ProviderAuthStatus[];
  availableModels: ModelInfo[];
}

export async function fetchProviderStatus(rpc: WebRpcClient): Promise<AuthListResult> {
  return (await rpc.requestRaw("auth/list", {})) as AuthListResult;
}

export async function setProviderKey(rpc: WebRpcClient, provider: string, apiKey: string): Promise<void> {
  await rpc.requestRaw("auth/set", { provider, apiKey });
}

export async function removeProviderKey(rpc: WebRpcClient, provider: string): Promise<void> {
  await rpc.requestRaw("auth/remove", { provider });
}

export async function startOAuthFlow(rpc: WebRpcClient): Promise<OAuthStartResult> {
  return (await rpc.requestRaw("auth/oauth/start", {})) as OAuthStartResult;
}
