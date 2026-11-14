// @summary Public RPC coverage for progressive session discovery and history before runtime restoration
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ThreadHistoryResponse, ThreadListResponse, ThreadReadResponse } from "@diligent/protocol";
import { ensureDiligentDir } from "@diligent/runtime";
import { appendEntry, createSessionFile } from "@diligent/runtime/session";
import { createProtocolClient, type ProtocolTestClient } from "./helpers/protocol-client";
import { createTestServer } from "./helpers/server-factory";

let cwd: string;
let client: ProtocolTestClient | undefined;
afterEach(async () => {
  client?.close();
  client = undefined;
  if (cwd) await rm(cwd, { recursive: true, force: true });
});
async function setup() {
  cwd = await mkdtemp(join(tmpdir(), "diligent-progressive-rpc-"));
  const paths = await ensureDiligentDir(cwd);
  client = createProtocolClient(createTestServer({ cwd }));
  await client.request("initialize", { clientName: "test", clientVersion: "0", protocolVersion: 1 });
  return { paths, rpc: client };
}

describe("progressive session RPC", () => {
  test("continues discovery past a child-only page and exposes legacy filenames", async () => {
    const { paths, rpc } = await setup();
    await createSessionFile(paths.sessions, cwd, "parent", undefined, "z-child");
    const saved = await createSessionFile(paths.sessions, cwd, undefined, undefined, "older-header-id");
    await appendEntry(saved.path, {
      type: "message",
      id: "user",
      parentId: null,
      timestamp: "2024-01-01T00:00:00Z",
      message: { role: "user", content: "Older saved conversation", timestamp: 1704067200000 },
    });
    await rename(saved.path, join(paths.sessions, "a-import.jsonl"));
    const first = (await rpc.request("thread/list", { limit: 1 })) as ThreadListResponse;
    expect(first.data).toEqual([]);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = (await rpc.request("thread/list", { limit: 1, cursor: first.nextCursor })) as ThreadListResponse;
    expect(second.data).toMatchObject([{ id: saved.header.id, firstUserMessage: "Older saved conversation" }]);
    expect(second.data[0].messageCount).toBeUndefined();
    expect(second.nextCursor).toBeUndefined();
    const history = (await rpc.request("thread/history", { threadId: saved.header.id })) as ThreadHistoryResponse;
    expect(history.items).toMatchObject([{ type: "userMessage", message: { content: "Older saved conversation" } }]);
  });

  test("scans the sessions directory once per list pass and still accepts cursors without a snapshot", async () => {
    const { paths, rpc } = await setup();
    for (const id of ["s-1", "s-2", "s-3"]) {
      const saved = await createSessionFile(paths.sessions, cwd, undefined, undefined, id);
      await appendEntry(saved.path, {
        type: "message",
        id: `${id}-user`,
        parentId: null,
        timestamp: "2024-01-01T00:00:00Z",
        message: { role: "user", content: id, timestamp: 1704067200000 },
      });
    }
    const scan = spyOn(Bun.Glob.prototype, "scan");
    try {
      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = (await rpc.request("thread/list", { limit: 1, cursor })) as ThreadListResponse;
        seen.push(...page.data.map((session) => session.id));
        cursor = page.nextCursor;
      } while (cursor);
      expect(seen).toEqual(["s-3", "s-2", "s-1"]);
      expect(scan).toHaveBeenCalledTimes(1);

      const legacyCursor = Buffer.from(JSON.stringify({ version: 1, after: `s-3.jsonl\0${cwd}` })).toString(
        "base64url",
      );
      const resumed = (await rpc.request("thread/list", { limit: 5, cursor: legacyCursor })) as ThreadListResponse;
      expect(resumed.data.map((session) => session.id)).toEqual(["s-2", "s-1"]);
      expect(resumed.nextCursor).toBeUndefined();
    } finally {
      scan.mockRestore();
    }
  });

  test("returns history during restoration without overriding a newer selection or rereading metadata", async () => {
    const { paths, rpc } = await setup();
    const saved = await createSessionFile(paths.sessions, cwd);
    for (const [id, parentId] of [
      ["older", null],
      ["recent", "older"],
    ] as const) {
      await appendEntry(saved.path, {
        type: "message",
        id,
        parentId,
        timestamp: "2024-01-01T00:00:00Z",
        message: { role: "user", content: id, timestamp: 1704067200000 },
      });
    }
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const file = Bun.file;
    let restored = false;
    const delayedFile = ((...args: Parameters<typeof Bun.file>) => {
      const source = file(...args);
      if (String(args[0]) !== saved.path) return source;
      return new Proxy(source, {
        get(target, key) {
          if (key === "text")
            return async () => {
              if (restored) throw new Error("Full history reread after runtime restoration");
              entered.resolve();
              await release.promise;
              return target.text();
            };
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    }) as typeof Bun.file;
    const delayed = spyOn(Bun, "file").mockImplementation(delayedFile);
    const resume = rpc.request("thread/resume", { threadId: saved.header.id });
    try {
      await entered.promise;
      const recent = (await rpc.request("thread/history", {
        threadId: saved.header.id,
        limit: 1,
      })) as ThreadHistoryResponse;
      expect(recent.items).toMatchObject([{ type: "userMessage", message: { content: "recent" } }]);
      const older = (await rpc.request("thread/history", {
        threadId: saved.header.id,
        limit: 1,
        cursor: recent.nextCursor,
      })) as ThreadHistoryResponse;
      expect(older.items).toMatchObject([{ type: "userMessage", message: { content: "older" } }]);
      await rpc.request("thread/start", { cwd });
      release.resolve();
      expect(await resume).toEqual({ found: true, threadId: saved.header.id });
      restored = true;
      const metadata = (await rpc.request("thread/read", {
        threadId: saved.header.id,
        includeItems: false,
      })) as ThreadReadResponse;
      expect(metadata).toMatchObject({ cwd, items: [], entryCount: 2, isRunning: false });
      const selected = (await rpc.request("thread/read", { includeItems: false })) as ThreadReadResponse;
      expect(selected.entryCount).toBe(0);
    } finally {
      release.resolve();
      await resume;
      delayed.mockRestore();
    }
  });

  test("concurrent restores repair an orphaned tool call only once", async () => {
    const { paths, rpc } = await setup();
    const saved = await createSessionFile(paths.sessions, cwd);
    await appendEntry(saved.path, {
      type: "message",
      id: "orphan",
      parentId: null,
      timestamp: "2024-01-01T00:00:00Z",
      message: {
        role: "assistant",
        model: { provider: "anthropic", modelId: "claude-sonnet-5" },
        content: [{ type: "tool_call", id: "orphan-call", name: "read", input: { path: "old.txt" } }],
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
        stopReason: "tool_use",
        timestamp: 1704067200000,
      },
    });
    const snapshot = await Bun.file(saved.path).text();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const file = Bun.file;
    const delayedFile = ((...args: Parameters<typeof Bun.file>) => {
      const source = file(...args);
      if (String(args[0]) !== saved.path) return source;
      return new Proxy(source, {
        get(target, key) {
          if (key === "text")
            return async () => {
              entered.resolve();
              await release.promise;
              return snapshot;
            };
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    }) as typeof Bun.file;
    const delayed = spyOn(Bun, "file").mockImplementation(delayedFile);
    const first = rpc.request("thread/resume", { threadId: saved.header.id });
    try {
      await entered.promise;
      const second = rpc.request("thread/resume", { threadId: saved.header.id });
      release.resolve();
      await Promise.all([first, second]);
    } finally {
      release.resolve();
      await first;
      delayed.mockRestore();
    }
    const persisted = (await Bun.file(saved.path).text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const cancellations = persisted.filter(
      (entry) =>
        entry.type === "message" && entry.message.role === "tool_result" && entry.message.toolCallId === "orphan-call",
    );
    expect(cancellations).toHaveLength(1);
    expect(cancellations[0].message.output).toBe("[Cancelled]");
  });

  test("background resume reconciles a reused idle runtime with the history now visible on disk", async () => {
    const { paths, rpc } = await setup();
    const saved = await createSessionFile(paths.sessions, cwd);
    await appendEntry(saved.path, {
      type: "message",
      id: "first",
      parentId: null,
      timestamp: "2024-01-01T00:00:00Z",
      message: { role: "user", content: "Original history", timestamp: 1704067200000 },
    });
    await rpc.request("thread/resume", { threadId: saved.header.id });
    await appendEntry(saved.path, {
      type: "message",
      id: "external",
      parentId: "first",
      timestamp: "2024-01-01T00:00:01Z",
      message: { role: "user", content: "Added by another process", timestamp: 1704067201000 },
    });
    await appendEntry(saved.path, {
      type: "effort_change",
      id: "effort",
      parentId: "external",
      timestamp: "2024-01-01T00:00:02Z",
      effort: "high",
      changedBy: "command",
    });
    const visible = (await rpc.request("thread/history", { threadId: saved.header.id })) as ThreadHistoryResponse;
    expect(visible.items).toContainEqual(
      expect.objectContaining({
        type: "userMessage",
        message: expect.objectContaining({ content: "Added by another process" }),
      }),
    );
    await rpc.request("thread/resume", { threadId: saved.header.id });
    const prepared = (await rpc.request("thread/read", {
      threadId: saved.header.id,
      includeItems: false,
    })) as ThreadReadResponse;
    expect(prepared).toMatchObject({ entryCount: 3, currentEffort: "high" });
  });

  test("returns an empty history for a new thread that has not persisted a turn yet", async () => {
    const { rpc } = await setup();
    const started = (await rpc.request("thread/start", { cwd })) as { threadId: string };
    const history = (await rpc.request("thread/history", { threadId: started.threadId })) as ThreadHistoryResponse;
    expect(history).toEqual({ cwd, items: [] });
  });
});
