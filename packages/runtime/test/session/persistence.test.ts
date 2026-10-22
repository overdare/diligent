// @summary Tests for session file persistence and entry management
import { afterEach, describe, expect, it } from "bun:test";
import { appendFile, mkdir, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { SessionSummary } from "@diligent/protocol";
import type { AppendedEntryInfo, SessionMessageEntry } from "@diligent/runtime/session";
import {
  appendEntry,
  createSessionFile,
  deleteSession,
  generateEntryId,
  listSessions,
  readSessionFile,
  SESSION_VERSION,
  SessionPersistence,
  SessionWriter,
} from "@diligent/runtime/session";

const TEST_ROOT = join(tmpdir(), `diligent-session-test-${Date.now()}`);
let testDir: string;

afterEach(async () => {
  try {
    await rm(TEST_ROOT, { recursive: true, force: true });
  } catch {}
});

async function setupDir(): Promise<string> {
  testDir = join(TEST_ROOT, `run-${Date.now()}`);
  await mkdir(testDir, { recursive: true });
  return testDir;
}

async function listInFreshProcess(directory: string): Promise<SessionSummary[]> {
  const child = Bun.spawn(
    [
      process.execPath,
      "--eval",
      'import { listSessions } from "@diligent/runtime/session"; console.log(JSON.stringify(await listSessions(process.argv[1])));',
      directory,
    ],
    { cwd: resolve(import.meta.dir, "../../../.."), stdout: "pipe", stderr: "pipe" },
  );
  const output = await new Response(child.stdout).text();
  const error = await new Response(child.stderr).text();
  if ((await child.exited) !== 0) throw new Error(error);
  return JSON.parse(output) as SessionSummary[];
}

function makeUserEntry(parentId: string | null = null): SessionMessageEntry {
  return {
    type: "message",
    id: generateEntryId(),
    parentId,
    timestamp: new Date().toISOString(),
    message: { role: "user", content: "hello", timestamp: Date.now() },
  };
}

function makeAssistantEntry(parentId: string): SessionMessageEntry {
  return {
    type: "message",
    id: generateEntryId(),
    parentId,
    timestamp: new Date().toISOString(),
    message: {
      role: "assistant",
      content: [{ type: "text", text: "hi" }],
      model: { provider: "anthropic", modelId: "test" },
      usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
      stopReason: "end_turn",
      timestamp: Date.now(),
    },
  };
}

describe("createSessionFile + readSessionFile", () => {
  it("creates a JSONL file with valid header", async () => {
    const dir = await setupDir();
    const { path, header } = await createSessionFile(dir, "/project");

    expect(path).toContain(".jsonl");
    expect(header.type).toBe("session");
    expect(header.version).toBe(SESSION_VERSION);
    expect(header.cwd).toBe("/project");

    const { header: readHeader, entries } = await readSessionFile(path);
    expect(readHeader).toEqual(header);
    expect(entries).toEqual([]);
  });

  it("parentSession is recorded in header", async () => {
    const dir = await setupDir();
    const { header } = await createSessionFile(dir, "/project", "parent-id");
    expect(header.parentSession).toBe("parent-id");
  });

  it("rejects a traversal id without creating a file outside the sessions directory", async () => {
    const dir = await setupDir();
    const outsidePath = join(TEST_ROOT, "created-outside.jsonl");

    await expect(createSessionFile(dir, "/project", undefined, undefined, "../created-outside")).rejects.toThrow(
      /Invalid session ID/,
    );
    expect(await Bun.file(outsidePath).exists()).toBe(false);
  });
});

describe("appendEntry + readSessionFile", () => {
  it("appends entries and reads them back", async () => {
    const dir = await setupDir();
    const { path } = await createSessionFile(dir, "/project");

    const entry1 = makeUserEntry();
    const entry2 = makeAssistantEntry(entry1.id);

    await appendEntry(path, entry1);
    await appendEntry(path, entry2);

    const { entries } = await readSessionFile(path);
    expect(entries).toHaveLength(2);
    expect(entries[0].id).toBe(entry1.id);
    expect(entries[1].id).toBe(entry2.id);
  });

  it("round-trips typed OpenAI reasoning state", async () => {
    const dir = await setupDir();
    const { path } = await createSessionFile(dir, "/project");
    const user = makeUserEntry();
    const assistant = makeAssistantEntry(user.id);
    if (assistant.message.role !== "assistant") throw new Error("Expected assistant entry");
    assistant.message.content = [
      {
        type: "thinking",
        thinking: "summary",
        providerState: {
          provider: "openai",
          itemId: "rs_1",
          encryptedContent: "opaque-reasoning",
        },
      },
    ];

    await appendEntry(path, user);
    await appendEntry(path, assistant);

    const { entries } = await readSessionFile(path);
    expect(entries[1]).toEqual(assistant);
  });
});

describe("readSessionFile validation", () => {
  it("throws on empty file", async () => {
    const dir = await setupDir();
    const path = join(dir, "empty.jsonl");
    await Bun.write(path, "");

    expect(readSessionFile(path)).rejects.toThrow("Empty session file");
  });

  it("throws on invalid header", async () => {
    const dir = await setupDir();
    const path = join(dir, "bad.jsonl");
    await Bun.write(path, `${JSON.stringify({ type: "not_session" })}\n`);

    expect(readSessionFile(path)).rejects.toThrow("Invalid session header");
  });

  it("throws on future version", async () => {
    const dir = await setupDir();
    const path = join(dir, "future.jsonl");
    await Bun.write(path, `${JSON.stringify({ type: "session", version: 999, id: "x", timestamp: "", cwd: "/" })}\n`);

    expect(readSessionFile(path)).rejects.toThrow("newer than supported");
  });

  it("reads version-9 sessions and accepts appended internal metadata", async () => {
    const dir = await setupDir();
    const path = join(dir, "legacy.jsonl");
    await Bun.write(
      path,
      `${JSON.stringify({ type: "session", version: 9, id: "legacy", timestamp: new Date().toISOString(), cwd: "/" })}\n`,
    );
    const internal = { ...makeUserEntry(), visibility: "internal" as const, source: "test-hook" };
    await appendEntry(path, internal);
    const { header, entries } = await readSessionFile(path);
    expect(header.version).toBe(9);
    expect(entries[0]).toMatchObject({ visibility: "internal", source: "test-hook" });
  });
});

describe("listSessions", () => {
  it("orders by persisted modification time with stable ID tie-breaking", async () => {
    const dir = await setupDir();
    for (const id of ["alpha", "middle", "zulu"]) {
      const { path } = await createSessionFile(dir, "/project", undefined, undefined, id);
      await appendEntry(path, {
        ...makeUserEntry(),
        timestamp: id === "middle" ? "2030-01-03T00:00:00.000Z" : "2030-01-02T00:00:00.000Z",
      });
    }
    expect((await listSessions(dir)).map((session) => session.id)).toEqual(["middle", "zulu", "alpha"]);
  });

  it("extracts first user message preview", async () => {
    const dir = await setupDir();
    const { path } = await createSessionFile(dir, "/project");
    const entry: SessionMessageEntry = {
      type: "message",
      id: generateEntryId(),
      parentId: null,
      timestamp: new Date().toISOString(),
      message: { role: "user", content: "find all TODO comments", timestamp: Date.now() },
    };
    await appendEntry(path, entry);

    const sessions = await listSessions(dir);
    expect(sessions[0].firstUserMessage).toBe("find all TODO comments");
  });

  it("excludes internal entries but keeps legacy reminder entries visible", async () => {
    const dir = await setupDir();
    const { path } = await createSessionFile(dir, "/project");
    const internal = { ...makeUserEntry(), visibility: "internal" as const, source: "plan-reminder" };
    internal.message = { role: "user", content: "internal", timestamp: Date.now() };
    const legacy = makeUserEntry(internal.id);
    legacy.message = {
      role: "user",
      content: "<system-reminder>\nlegacy\n</system-reminder>",
      timestamp: Date.now(),
    };
    const visible = makeUserEntry(legacy.id);
    visible.message = { role: "user", content: "visible", timestamp: Date.now() };
    await appendEntry(path, internal);
    await appendEntry(path, legacy);
    await appendEntry(path, visible);

    const [session] = await listSessions(dir);
    expect(session.messageCount).toBe(2);
    expect(session.firstUserMessage).toBe("<system-reminder>\nlegacy\n</system-reminder>");
  });

  it("reflects external appends, renames, additions, and deletion after listing", async () => {
    const dir = await setupDir();
    const first = await createSessionFile(dir, "/project");
    await appendEntry(first.path, makeUserEntry());
    expect((await listSessions(dir))[0]).toMatchObject({ id: first.header.id, messageCount: 1 });

    const renamed = {
      type: "session_info",
      id: generateEntryId(),
      parentId: null,
      timestamp: "2030-01-02T00:00:00.000Z",
      name: "Updated outside this process",
    };
    const internal = { ...makeUserEntry(), visibility: "internal", timestamp: "2030-01-03T00:00:00.000Z" };
    await appendFile(first.path, `${JSON.stringify(renamed)}\n${JSON.stringify(internal)}\n`);
    const second = await createSessionFile(dir, "/other-project", first.header.id);

    const sessions = await listSessions(dir);
    expect(sessions.map((session) => session.id)).toEqual([first.header.id, second.header.id]);
    expect(sessions[0]).toMatchObject({
      name: renamed.name,
      messageCount: 1,
      firstUserMessage: "hello",
      modified: new Date(internal.timestamp),
    });
    expect(sessions[1]).toMatchObject({ cwd: "/other-project", parentSession: first.header.id, messageCount: 0 });
    await rm(first.path);
    expect((await listSessions(dir)).map((session) => session.id)).toEqual([second.header.id]);
  });

  it("reflects same-size rewrites rather than serving an old preview", async () => {
    const dir = await setupDir();
    const { path } = await createSessionFile(dir, "/project");
    await appendEntry(path, makeUserEntry());
    expect((await listSessions(dir))[0].firstUserMessage).toBe("hello");
    const before = await stat(path);
    const text = await Bun.file(path).text();
    await writeFile(path, text.replace('"hello"', '"world"'));
    await utimes(path, before.atime, new Date(before.mtimeMs + 1000));
    expect((await stat(path)).size).toBe(before.size);
    expect((await listSessions(dir))[0].firstUserMessage).toBe("world");
  });

  it("detects replacement even when file size and modification time are preserved", async () => {
    const dir = await setupDir();
    const { path } = await createSessionFile(dir, "/project");
    await appendEntry(path, makeUserEntry());
    expect((await listSessions(dir))[0].firstUserMessage).toBe("hello");
    const before = await stat(path);
    const replacement = join(dir, "replacement.tmp");
    await writeFile(replacement, (await Bun.file(path).text()).replace('"hello"', '"world"'));
    await utimes(replacement, before.atime, before.mtime);
    await rename(replacement, path);
    expect((await listSessions(dir))[0].firstUserMessage).toBe("world");
  });

  it("does not share mutable summaries between concurrent callers", async () => {
    const dir = await setupDir();
    const { path, header } = await createSessionFile(dir, "/project");
    await appendEntry(path, makeUserEntry());
    const [left, right] = await Promise.all([listSessions(dir), listSessions(dir)]);
    left[0].cwd = "/modified-by-caller";
    left[0].created.setTime(0);
    left[0].modified.setTime(0);
    const [again] = await listSessions(dir);
    expect(right[0].cwd).toBe("/project");
    expect(right[0].created.toISOString()).toBe(header.timestamp);
    expect(again).toEqual(right[0]);
  });

  it("keeps identical session IDs in different project directories independent", async () => {
    const dir = await setupDir();
    const other = join(dir, "other");
    await mkdir(other);
    for (const [root, text] of [
      [dir, "first"],
      [other, "other"],
    ]) {
      const { path } = await createSessionFile(root, root, undefined, undefined, "shared-id");
      const entry = makeUserEntry();
      entry.message = { role: "user", content: text, timestamp: Date.now() };
      await appendEntry(path, entry);
    }
    const [first, second] = await Promise.all([listSessions(dir), listSessions(other)]);
    expect(first[0]).toMatchObject({ cwd: dir, firstUserMessage: "first", path: join(dir, "shared-id.jsonl") });
    expect(second[0]).toMatchObject({ cwd: other, firstUserMessage: "other", path: join(other, "shared-id.jsonl") });
  });

  it("reconsiders a corrupted file after repair and stops listing it after corruption", async () => {
    const dir = await setupDir();
    const { path, header } = await createSessionFile(dir, "/project");
    const valid = `${JSON.stringify(header)}\n${JSON.stringify(makeUserEntry())}\n`;
    await writeFile(path, `${valid}incomplete-json`);
    expect(await listSessions(dir)).toEqual([]);
    await writeFile(path, valid);
    expect((await listSessions(dir))[0]).toMatchObject({ id: header.id, firstUserMessage: "hello" });
    await writeFile(path, `${JSON.stringify({ ...header, version: SESSION_VERSION + 1 })}\n`);
    expect(await listSessions(dir)).toEqual([]);
  });

  it("revalidates persisted summaries after process restart", async () => {
    const dir = await setupDir();
    const { path, header } = await createSessionFile(dir, "/project");
    const first = makeUserEntry();
    await appendEntry(path, first);
    const original = await listSessions(dir);
    expect(await listInFreshProcess(dir)).toEqual(JSON.parse(JSON.stringify(original)));
    const next = { ...makeUserEntry(first.id), timestamp: "2030-01-01T00:00:00.000Z" };
    await appendFile(path, `${JSON.stringify(next)}\n`);
    expect(await listInFreshProcess(dir)).toMatchObject([
      { id: header.id, messageCount: 2, firstUserMessage: "hello", modified: next.timestamp },
    ]);
    await rm(path);
    expect(await listInFreshProcess(dir)).toEqual([]);
  });

  it("rebuilds a corrupt derived index without losing valid sessions", async () => {
    const dir = await setupDir();
    const { path, header } = await createSessionFile(dir, "/project");
    await appendEntry(path, makeUserEntry());
    await listSessions(dir);
    await writeFile(join(dir, ".summaries.json"), '{"version":');
    expect(await listInFreshProcess(dir)).toMatchObject([
      { id: header.id, firstUserMessage: "hello", messageCount: 1 },
    ]);
  });

  it("lists source records when the derived index cannot be replaced", async () => {
    const dir = await setupDir();
    await mkdir(join(dir, ".summaries.json"));
    const { path, header } = await createSessionFile(dir, "/project");
    await appendEntry(path, makeUserEntry());
    expect(await listSessions(dir)).toMatchObject([{ id: header.id, firstUserMessage: "hello", messageCount: 1 }]);
  });

  it("returns empty array when no sessions", async () => {
    const dir = await setupDir();
    const sessions = await listSessions(dir);
    expect(sessions).toEqual([]);
  });
});

describe("deleteSession", () => {
  it("returns true and removes the file for an existing session", async () => {
    const dir = await setupDir();
    const { header } = await createSessionFile(dir, "/project");

    const result = await deleteSession(dir, header.id);
    expect(result).toBe(true);

    const sessions = await listSessions(dir);
    expect(sessions).toEqual([]);
  });

  it("returns false for a non-existent session", async () => {
    const dir = await setupDir();
    const result = await deleteSession(dir, "nonexistent-id");
    expect(result).toBe(false);
  });

  it("rejects a traversal id without deleting a file outside the sessions directory", async () => {
    const dir = await setupDir();
    const outsidePath = join(TEST_ROOT, "outside.jsonl");
    await writeFile(outsidePath, "protected", "utf8");

    await expect(deleteSession(dir, "../outside")).rejects.toThrow(/Invalid session ID/);
    expect(await Bun.file(outsidePath).text()).toBe("protected");
  });
});

describe("listSessions parentSession", () => {
  it("includes parentSession when set in header", async () => {
    const dir = await setupDir();
    const { path } = await createSessionFile(dir, "/project", "parent-123");
    await appendEntry(path, makeUserEntry());
    const sessions = await listSessions(dir);
    expect(sessions[0].parentSession).toBe("parent-123");
  });

  it("parentSession is undefined for top-level sessions", async () => {
    const dir = await setupDir();
    const { path } = await createSessionFile(dir, "/project");
    await appendEntry(path, makeUserEntry());
    const sessions = await listSessions(dir);
    expect(sessions[0].parentSession).toBeUndefined();
  });
});

describe("SessionWriter", () => {
  it("creates the session file immediately", async () => {
    const dir = await setupDir();
    const writer = new SessionWriter(dir, "/project");

    const path = await writer.create();

    expect(writer.path).toBe(path);
    const { entries } = await readSessionFile(path);
    expect(entries).toEqual([]);
  });

  it("writes entries immediately", async () => {
    const dir = await setupDir();
    const writer = new SessionWriter(dir, "/project");

    const userEntry = makeUserEntry();
    await writer.write(userEntry);
    const assistantEntry = makeAssistantEntry(userEntry.id);
    await writer.write(assistantEntry);

    expect(writer.path).not.toBeNull();
    const { entries } = await readSessionFile(writer.path!);
    expect(entries).toHaveLength(2);
  });

  it("accepts existing path for resumed sessions", async () => {
    const dir = await setupDir();
    const { path } = await createSessionFile(dir, "/project");

    const writer = new SessionWriter(dir, "/project", path);

    const entry = makeUserEntry();
    await writer.write(entry);

    const { entries } = await readSessionFile(path);
    expect(entries).toHaveLength(1);
  });

  it("passes parentSession to session header on create", async () => {
    const dir = await setupDir();
    const writer = new SessionWriter(dir, "/project", undefined, "parent-abc");

    await writer.create();

    const { header } = await readSessionFile(writer.path!);
    expect(header.parentSession).toBe("parent-abc");
  });
});

describe("SessionPersistence explicit resume", () => {
  it("returns not found when the session directory no longer exists", async () => {
    const dir = await setupDir();
    const persistence = new SessionPersistence({ sessionsDir: join(dir, "missing"), cwd: dir });
    expect(await persistence.resume({ sessionId: "missing-session" })).toBeNull();
  });

  it("restores the requested session and its parent independently of newer siblings", async () => {
    const dir = await setupDir();
    const target = await createSessionFile(dir, dir, "parent-id");
    const entry = makeUserEntry();
    await appendEntry(target.path, entry);
    const sibling = await createSessionFile(dir, dir);
    await appendEntry(sibling.path, { ...makeUserEntry(), timestamp: "2030-01-01T00:00:00.000Z" });
    const persistence = new SessionPersistence({ sessionsDir: dir, cwd: dir });
    expect(await persistence.resume({ sessionId: target.header.id })).toEqual([entry]);
    expect(persistence.sessionId).toBe(target.header.id);
    expect(persistence.parentSession).toBe("parent-id");
  });

  it("does not resume a different identity or an invalid target", async () => {
    const dir = await setupDir();
    const target = await createSessionFile(dir, dir);
    const persistence = new SessionPersistence({ sessionsDir: dir, cwd: dir });
    await writeFile(target.path, `${JSON.stringify({ ...target.header, id: "another-session" })}\n`);
    expect(await persistence.resume({ sessionId: target.header.id })).toBeNull();
    await writeFile(target.path, "invalid-json");
    expect(await persistence.resume({ sessionId: target.header.id })).toBeNull();
    await writeFile(target.path, `${JSON.stringify({ ...target.header, version: SESSION_VERSION + 1 })}\n`);
    expect(await persistence.resume({ sessionId: target.header.id })).toBeNull();
  });

  it("does not resolve traversal IDs outside the session directory", async () => {
    const dir = await setupDir();
    const outside = await createSessionFile(TEST_ROOT, "/outside", undefined, undefined, "outside");
    await appendEntry(outside.path, makeUserEntry());
    const persistence = new SessionPersistence({ sessionsDir: dir, cwd: dir });
    expect(await persistence.resume({ sessionId: "../outside" })).toBeNull();
    expect(persistence.sessionPath).toBeNull();
  });
});

describe("SessionPersistence onEntryAppended", () => {
  // Observers dispatch on a setImmediate macrotask (off the write tick), so wait one round.
  const flushImmediate = () => new Promise((resolve) => setImmediate(resolve));

  it.each(["append", "appendMany"] as const)("captures user identity when %s queues an entry", async (method) => {
    const dir = await setupDir();
    const seen: AppendedEntryInfo[] = [];
    let userId: string | undefined = "alice";
    const persistence = new SessionPersistence({
      sessionsDir: dir,
      cwd: dir,
      getUserId: () => userId,
      onEntryAppended: (info) => seen.push(info),
    });
    await persistence.create();
    const user = makeUserEntry();
    if (method === "append") persistence.append(user, () => {});
    else persistence.appendMany([user], () => {});
    userId = "bob";
    if (method === "append") persistence.append(makeAssistantEntry(user.id), () => {});
    else persistence.appendMany([makeAssistantEntry(user.id)], () => {});
    userId = undefined;
    await persistence.waitForWrites();
    await flushImmediate();

    expect(seen.map((info) => info.userId)).toEqual(["alice", "bob"]);
    expect(seen.map((info) => info.seq)).toEqual([1, 2]);
  });

  it("does not lose persisted entries when observer identity resolution throws", async () => {
    const dir = await setupDir();
    const seen: AppendedEntryInfo[] = [];
    const persistence = new SessionPersistence({
      sessionsDir: dir,
      cwd: dir,
      getUserId: () => {
        throw new Error("identity unavailable");
      },
      onEntryAppended: (info) => seen.push(info),
    });
    await persistence.create();
    persistence.append(makeUserEntry(), () => {});
    persistence.appendMany([makeUserEntry()], () => {});
    await persistence.waitForWrites();
    await flushImmediate();

    expect((await readSessionFile(persistence.sessionPath!)).entries).toHaveLength(2);
    expect(seen.map((info) => info.userId)).toEqual([undefined, undefined]);
  });

  it("fires once per append with a monotonic seq", async () => {
    const dir = await setupDir();
    const seen: AppendedEntryInfo[] = [];
    const persistence = new SessionPersistence({
      sessionsDir: dir,
      cwd: dir,
      onEntryAppended: (info) => seen.push(info),
    });
    await persistence.create();

    const user = makeUserEntry();
    persistence.append(user, () => {});
    persistence.append(makeAssistantEntry(user.id), () => {});
    await persistence.waitForWrites();
    await flushImmediate();

    expect(seen.map((s) => s.seq)).toEqual([1, 2]);
    expect(seen[0].entry.id).toBe(user.id);
    expect(seen[0].sessionId).toBe(persistence.sessionId);
    expect(seen[0].sessionPath).toBe(persistence.sessionPath);
  });

  it("seeds seq from existing entries on resume so it never collides", async () => {
    const dir = await setupDir();
    const first = new SessionPersistence({ sessionsDir: dir, cwd: dir });
    await first.create();
    const user = makeUserEntry();
    first.append(user, () => {});
    first.append(makeAssistantEntry(user.id), () => {});
    await first.waitForWrites();
    const sessionId = first.sessionId;

    const seen: AppendedEntryInfo[] = [];
    const resumed = new SessionPersistence({
      sessionsDir: dir,
      cwd: dir,
      onEntryAppended: (info) => seen.push(info),
    });
    await resumed.resume({ sessionId });
    resumed.append(makeUserEntry(), () => {});
    await resumed.waitForWrites();
    await flushImmediate();

    // Two entries already on disk → next append is seq 3, not 1.
    expect(seen.map((s) => s.seq)).toEqual([3]);
  });

  it("does not break the write path when the observer throws", async () => {
    const dir = await setupDir();
    const persistence = new SessionPersistence({
      sessionsDir: dir,
      cwd: dir,
      onEntryAppended: () => {
        throw new Error("observer boom");
      },
    });
    await persistence.create();

    let writeError: unknown;
    persistence.append(makeUserEntry(), (err) => {
      writeError = err;
    });
    await persistence.waitForWrites();
    await flushImmediate();

    expect(writeError).toBeUndefined();
    const { entries } = await readSessionFile(persistence.sessionPath!);
    expect(entries).toHaveLength(1);
  });
});
