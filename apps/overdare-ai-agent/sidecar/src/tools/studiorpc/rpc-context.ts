// @summary Carries the executing session across nested Studio RPC helpers without sharing mutable turn state.

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { StudioRpcCallOptions } from "./rpc";

const context = new AsyncLocalStorage<Pick<StudioRpcCallOptions, "sessionId" | "signal">>();
// Standalone MCP and background calls have no agent transcript. Give this process
// its own identity rather than borrowing a session from the latest prompt hook.
const processSessionId = `sidecar-${randomUUID()}`;

export function studioRpcSessionId(): string {
  return context.getStore()?.sessionId || processSessionId;
}

export function withStudioRpcContext<T>(
  options: Pick<StudioRpcCallOptions, "sessionId" | "signal">,
  execute: () => T,
): T {
  return context.run(options, execute);
}

export function studioRpcCallOptions(options: StudioRpcCallOptions = {}): StudioRpcCallOptions {
  const current = context.getStore();
  return {
    ...options,
    sessionId: current?.sessionId || options.sessionId || processSessionId,
    signal: options.signal ?? current?.signal,
  };
}
