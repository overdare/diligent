// @summary Tests that session-list scanning waits for in-flight conversation history reads.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HistoryPriority } from "../../src/app-server/history-priority";
import { handleThreadList } from "../../src/app-server/session-handlers";
import type { ThreadHandlersContext } from "../../src/app-server/thread-handlers";
import { appendEntry, createSessionFile } from "../../src/session/persistence";

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("HistoryPriority", () => {
  test("idle waits for every in-flight read, including overlapping ones", async () => {
    const priority = new HistoryPriority();
    const first = Promise.withResolvers<void>();
    const second = Promise.withResolvers<void>();
    const a = priority.run(() => first.promise);
    const b = priority.run(() => second.promise);
    let idle = false;
    const waiting = priority.idle().then(() => {
      idle = true;
    });
    first.resolve();
    await a;
    await Bun.sleep(0);
    expect(idle).toBe(false);
    second.resolve();
    await b;
    await waiting;
    expect(idle).toBe(true);
  });

  test("a failed read still releases waiters", async () => {
    const priority = new HistoryPriority();
    await expect(priority.run(() => Promise.reject(new Error("disk")))).rejects.toThrow("disk");
    await priority.idle();
  });

  test("thread/list reads no session file while a history read is in flight", async () => {
    dir = await mkdtemp(join(tmpdir(), "diligent-history-priority-"));
    const sessions = join(dir, "sessions");
    const saved = await createSessionFile(sessions, dir, undefined, undefined, "s-1");
    await appendEntry(saved.path, {
      type: "message",
      id: "user",
      parentId: null,
      timestamp: "2024-01-01T00:00:00Z",
      message: { role: "user", content: "Saved conversation", timestamp: 1704067200000 },
    });
    const historyPriority = new HistoryPriority();
    const ctx = {
      knownCwds: new Set([dir]),
      resolvePaths: async () => ({ sessions }),
      threadListScans: new Map(),
      historyPriority,
    } as unknown as ThreadHandlersContext;
    const release = Promise.withResolvers<void>();
    const history = historyPriority.run(() => release.promise);
    let listed = false;
    const list = handleThreadList(ctx, 20).then((result) => {
      listed = true;
      return result;
    });
    await Bun.sleep(30);
    expect(listed).toBe(false);
    release.resolve();
    await history;
    expect((await list).data).toMatchObject([{ id: "s-1", firstUserMessage: "Saved conversation" }]);
  });
});
