// @summary Async-local actual/root session identity and bounded persisted ancestry resolution
import { AsyncLocalStorage } from "node:async_hooks";
import { open } from "node:fs/promises";
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
export const getSessionExecutionContext = (): SessionExecutionContext | undefined => storage.getStore();
export const runWithSessionExecutionContext = <T>(context: SessionExecutionContext, run: () => T): T =>
  storage.run(context, run);

export async function resolveSessionRoot(sessionId: string, parentSessionId: string | undefined, sessionsDir: string) {
  const seen = new Set([sessionId]);
  let root = sessionId;
  let parent = parentSessionId;
  while (parent) {
    if (!isSafeSessionId(parent) || seen.has(parent) || seen.size >= 64) {
      throw new Error("Invalid or cyclic session ancestry");
    }
    seen.add(parent);
    const file = await open(join(sessionsDir, `${parent}.jsonl`), "r");
    let header: { type?: unknown; id?: unknown; parentSession?: unknown };
    try {
      const buffer = Buffer.alloc(65_536);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      const text = buffer.subarray(0, bytesRead).toString("utf8");
      const end = text.indexOf("\n");
      if (end < 0) throw new Error("Session ancestry header exceeds the read limit or is incomplete");
      header = JSON.parse(text.slice(0, end));
    } finally {
      await file.close();
    }
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
