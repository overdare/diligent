// @summary Async-local actual/root session identity and bounded persisted ancestry resolution
import { AsyncLocalStorage } from "node:async_hooks";
import { join } from "node:path";
import { isSafeSessionId } from "./types";

export interface SessionExecutionRoot {
  readonly sessionId: string;
  readonly requestId: string;
}

export interface SessionExecutionContext {
  readonly sessionId: string;
  readonly rootSessionId: string;
  readonly resumed: boolean;
  readonly rootRequest: SessionExecutionRoot;
}

const storage = new AsyncLocalStorage<SessionExecutionContext>();
const cleanups = new WeakMap<SessionExecutionContext, Set<() => void>>();
export const getSessionExecutionContext = (): SessionExecutionContext | undefined => storage.getStore();
/** Release run-owned resources even when a session fails before its stop hook. */
export function onSessionExecutionEnd(cleanup: () => void): void {
  const context = storage.getStore();
  const callbacks = context && cleanups.get(context);
  if (!callbacks) throw new Error("No active session execution scope");
  callbacks.add(cleanup);
}
export function runWithSessionExecutionContext<T>(context: SessionExecutionContext, run: () => T): T {
  const scoped = { ...context };
  const callbacks = new Set<() => void>();
  cleanups.set(scoped, callbacks);
  const release = () => {
    cleanups.delete(scoped);
    for (const callback of callbacks) callback();
    callbacks.clear();
  };
  try {
    const result = storage.run(scoped, run);
    if (result instanceof Promise) return result.finally(release) as T;
    release();
    return result;
  } catch (error) {
    release();
    throw error;
  }
}

export async function resolveSessionRoot(sessionId: string, parentSessionId: string | undefined, sessionsDir: string) {
  const seen = new Set([sessionId]);
  let root = sessionId;
  let parent = parentSessionId;
  while (parent) {
    if (!isSafeSessionId(parent) || seen.has(parent) || seen.size >= 64) {
      throw new Error("Invalid or cyclic session ancestry");
    }
    seen.add(parent);
    const bytes = await Bun.file(join(sessionsDir, `${parent}.jsonl`))
      .slice(0, 65_536)
      .arrayBuffer();
    const text = Buffer.from(bytes).toString("utf8");
    const end = text.indexOf("\n");
    if (end < 0) throw new Error("Session ancestry header exceeds the read limit or is incomplete");
    const header = JSON.parse(text.slice(0, end)) as { type?: unknown; id?: unknown; parentSession?: unknown };
    if (
      header.type !== "session" ||
      header.id !== parent ||
      (header.parentSession !== undefined && typeof header.parentSession !== "string")
    ) {
      throw new Error("Invalid session ancestry header");
    }
    root = parent;
    parent = header.parentSession as string | undefined;
  }
  return root;
}
