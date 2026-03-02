// @summary RPC helpers for provider authentication (list, set, remove, OAuth)
import type { OAuthStartResult, OAuthStatusResult, ProviderAuthStatus } from "../../shared/ws-protocol";
import type { WebRpcClient } from "./rpc-client";

export async function fetchProviderStatus(rpc: WebRpcClient): Promise<ProviderAuthStatus[]> {
  const result = (await rpc.requestRaw("auth/list", {})) as { providers: ProviderAuthStatus[] };
  return result.providers;
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

export async function getOAuthStatus(rpc: WebRpcClient): Promise<OAuthStatusResult> {
  return (await rpc.requestRaw("auth/oauth/status", {})) as OAuthStatusResult;
}
