// @summary Regression coverage for bounded JSONL pages, active branches, images, and legacy filenames
import { afterEach, describe, expect, test } from "bun:test";
import { appendFile, mkdtemp, rename, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendEntry,
  createSessionFile,
  type SessionMessageEntry,
  SessionPersistence,
} from "@diligent/runtime/session";
import { findSessionPath, readSessionHistoryPage, readSessionPreview } from "../../src/session/history";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "diligent-history-pages-"));
  directories.push(dir);
  return { dir, ...(await createSessionFile(dir, "/project")) };
}
function user(id: string, parentId: string | null, content = id): SessionMessageEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: "2024-01-01T00:00:00.000Z",
    message: { role: "user", content, timestamp: 1704067200000 },
  };
}

describe("session history pages", () => {
  test("follows the selected branch across UTF-8 chunk boundaries and pins the first page snapshot", async () => {
    const { path } = await fixture();
    const wide = "한글🙂".repeat(12000);
    for (const entry of [
      user("root", null, wide),
      user("abandoned", "root"),
      user("chosen", "root"),
      user("leaf", "chosen"),
    ])
      await appendEntry(path, entry);
    const first = await readSessionHistoryPage(path, { limit: 1 });
    expect(first.entries.map((entry) => entry.id)).toEqual(["leaf"]);
    await appendEntry(path, user("concurrent-append", "leaf"));
    const second = await readSessionHistoryPage(path, { limit: 1, cursor: first.nextCursor });
    expect(second.entries.map((entry) => entry.id)).toEqual(["chosen"]);
    const third = await readSessionHistoryPage(path, { limit: 1, cursor: second.nextCursor });
    expect(third.entries).toEqual([user("root", null, wide)]);
    expect(third.nextCursor).toBeUndefined();
  });

  test("stops at an atomic oversized record instead of reading all older messages", async () => {
    const { path } = await fixture();
    await appendEntry(path, user("oldest", null));
    await appendEntry(path, user("large", "oldest", "x".repeat(1100000)));
    await appendEntry(path, user("newest", "large"));
    const page = await readSessionHistoryPage(path);
    expect(page.entries.map((entry) => entry.id)).toEqual(["large", "newest"]);
    const older = await readSessionHistoryPage(path, { cursor: page.nextCursor });
    expect(older.entries.map((entry) => entry.id)).toEqual(["oldest"]);
    expect(older.nextCursor).toBeUndefined();
  });

  test("counts expanded image blobs against the page budget", async () => {
    const { path } = await fixture();
    const data = Buffer.alloc(900000, 1).toString("base64");
    await appendEntry(path, user("older", null));
    const image: SessionMessageEntry = {
      type: "message",
      id: "image",
      parentId: "older",
      timestamp: "2024-01-01T00:00:00.000Z",
      message: {
        role: "tool_result",
        toolCallId: "capture",
        toolName: "screenshot",
        output: "capture",
        isError: false,
        timestamp: 1704067200000,
        outputImages: [{ type: "image", source: { type: "base64", mediaType: "image/png", data } }],
      },
    };
    await appendEntry(path, image);
    const page = await readSessionHistoryPage(path);
    expect(page.entries).toEqual([image]);
    const older = await readSessionHistoryPage(path, { cursor: page.nextCursor });
    expect(older.entries.map((entry) => entry.id)).toEqual(["older"]);
  });

  test("does not silently apply a cursor to a different session or replaced file", async () => {
    const first = await fixture();
    await appendEntry(first.path, user("root", null));
    await appendEntry(first.path, user("leaf", "root"));
    const page = await readSessionHistoryPage(first.path, { limit: 1 });
    const other = await fixture();
    await expect(readSessionHistoryPage(other.path, { cursor: page.nextCursor })).rejects.toThrow(
      "changed while paging",
    );
    const replacement = `${first.path}.replacement`;
    await Bun.write(replacement, await Bun.file(first.path).text());
    await rename(replacement, first.path);
    await expect(readSessionHistoryPage(first.path, { cursor: page.nextCursor })).rejects.toThrow(
      "changed while paging",
    );
  });

  test("keeps a completed tail readable while the next append is incomplete", async () => {
    const { path } = await fixture();
    await appendEntry(path, user("root", null));
    await appendFile(path, '{"type":"message","id":"unfinished');
    const page = await readSessionHistoryPage(path);
    expect(page.entries.map((entry) => entry.id)).toEqual(["root"]);
    expect(page.nextCursor).toBeUndefined();
  });

  test("finds and resumes an older export by header ID when its filename differs", async () => {
    const { dir, path, header } = await fixture();
    await appendEntry(path, user("saved", null));
    const legacyPath = join(dir, "imported-conversation.jsonl");
    await rename(path, legacyPath);
    expect(await findSessionPath(dir, header.id)).toBe(legacyPath);
    const persistence = new SessionPersistence({ cwd: "/project", sessionsDir: dir });
    expect(await persistence.resume({ sessionId: header.id })).toEqual([user("saved", null)]);
    expect(await findSessionPath(dir, "../outside")).toBeUndefined();
  });

  test("previews readable headers without treating uncounted history as an empty session", async () => {
    const { path } = await fixture();
    expect((await readSessionPreview(path)).messageCount).toBe(0);
    await appendEntry(path, user("first", null, "Saved conversation"));
    await appendFile(path, "unreadable trailing content".repeat(100000));
    const modified = new Date("2025-04-03T12:00:00.000Z");
    await utimes(path, modified, modified);
    const preview = await readSessionPreview(path);
    expect(preview).toMatchObject({ firstUserMessage: "Saved conversation", modified });
    expect(preview.messageCount).toBeUndefined();
  });
});
