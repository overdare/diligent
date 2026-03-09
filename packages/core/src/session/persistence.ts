// @summary Session file persistence with JSONL format, immediate writing, and session listing
import { unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { buildSessionContext } from "./context-builder";
import type {
  CollabSessionMeta,
  SessionEntry,
  SessionHeader,
  SessionInfo,
  SessionInfoEntry,
  SessionMessageEntry,
} from "./types";
import { generateSessionId, SESSION_VERSION } from "./types";

/**
 * Write a session header to a new JSONL file.
 */
export async function createSessionFile(
  sessionsDir: string,
  cwd: string,
  parentSession?: string,
  collabMeta?: CollabSessionMeta,
  sessionId?: string,
): Promise<{ path: string; header: SessionHeader }> {
  const id = sessionId ?? generateSessionId();
  const header: SessionHeader = {
    type: "session",
    version: SESSION_VERSION,
    id,
    timestamp: new Date().toISOString(),
    cwd,
    parentSession,
    nickname: collabMeta?.nickname,
    description: collabMeta?.description,
  };
  const path = join(sessionsDir, `${id}.jsonl`);
  await Bun.write(path, `${JSON.stringify(header)}\n`);
  return { path, header };
}

/**
 * Append a single entry to a session file.
 * Append-only: never modifies existing lines.
 */
export async function appendEntry(sessionPath: string, entry: SessionEntry): Promise<void> {
  const file = Bun.file(sessionPath);
  const existing = await file.text();
  await Bun.write(sessionPath, `${existing}${JSON.stringify(entry)}\n`);
}

/**
 * Read all lines from a session file.
 * Validates header version.
 */
export async function readSessionFile(path: string): Promise<{ header: SessionHeader; entries: SessionEntry[] }> {
  const text = await Bun.file(path).text();
  const lines = text.trim().split("\n").filter(Boolean);

  if (lines.length === 0) {
    throw new Error(`Empty session file: ${path}`);
  }

  const header = JSON.parse(lines[0]) as SessionHeader;
  if (header.type !== "session") {
    throw new Error(`Invalid session header in: ${path}`);
  }
  if (header.version > SESSION_VERSION) {
    throw new Error(
      `Session file version ${header.version} is newer than supported version ${SESSION_VERSION}. ` +
        "Please update diligent.",
    );
  }

  const entries = lines.slice(1).map((line) => JSON.parse(line) as SessionEntry);
  return { header, entries };
}

/**
 * List all sessions in a directory.
 * Returns SessionInfo sorted by modified date (most recent first).
 */
export async function listSessions(sessionsDir: string): Promise<SessionInfo[]> {
  const glob = new Bun.Glob("*.jsonl");
  const sessions: SessionInfo[] = [];

  for await (const file of glob.scan(sessionsDir)) {
    try {
      const path = join(sessionsDir, file);
      const { header, entries } = await readSessionFile(path);

      const messageEntries = entries.filter((e): e is SessionMessageEntry => e.type === "message");
      const firstUserEntry = messageEntries.find((e) => e.message.role === "user");
      const lastEntry = entries[entries.length - 1];
      const nameEntry = entries.findLast((e): e is SessionInfoEntry => e.type === "session_info" && !!e.name);

      let firstUserMessage: string | undefined;
      if (firstUserEntry && firstUserEntry.message.role === "user") {
        const content = firstUserEntry.message.content;
        if (typeof content === "string") {
          firstUserMessage = content.slice(0, 100);
        } else {
          const text = content
            .filter((block): block is { type: "text"; text: string } => block.type === "text")
            .map((block) => block.text.trim())
            .filter(Boolean)
            .join(" ")
            .slice(0, 100);
          const imageCount = content.filter((block) => block.type === "local_image").length;
          firstUserMessage = text || (imageCount > 0 ? `[image${imageCount > 1 ? "s" : ""}]` : undefined);
        }
      }

      sessions.push({
        id: header.id,
        path,
        cwd: header.cwd,
        name: nameEntry?.name,
        created: new Date(header.timestamp),
        modified: lastEntry ? new Date(lastEntry.timestamp) : new Date(header.timestamp),
        messageCount: messageEntries.length,
        firstUserMessage,
        parentSession: header.parentSession,
      });
    } catch {
      // Skip corrupted session files
    }
  }

  return sessions.sort((a, b) => {
    const modifiedDelta = b.modified.getTime() - a.modified.getTime();
    if (modifiedDelta !== 0) return modifiedDelta;
    return b.id.localeCompare(a.id);
  });
}

/** Hydrated child session for ThreadReadResponse */
export interface ChildSessionData {
  sessionId: string;
  nickname?: string;
  description?: string;
  messages: import("../types").Message[];
  created: string; // ISO 8601
}

/**
 * Find and read all child sessions belonging to a parent session.
 * Returns child session data sorted by creation time (oldest first).
 */
export async function readChildSessions(sessionsDir: string, parentSessionId: string): Promise<ChildSessionData[]> {
  const glob = new Bun.Glob("*.jsonl");
  const children: ChildSessionData[] = [];

  for await (const file of glob.scan(sessionsDir)) {
    try {
      const path = join(sessionsDir, file);
      const { header, entries } = await readSessionFile(path);

      if (header.parentSession !== parentSessionId) continue;

      const leafId = entries.length > 0 ? entries[entries.length - 1].id : null;
      const context = buildSessionContext(entries, leafId);

      children.push({
        sessionId: header.id,
        nickname: header.nickname,
        description: header.description,
        messages: context.messages,
        created: header.timestamp,
      });
    } catch {
      // Skip corrupted child sessions
    }
  }

  return children.sort((a, b) => a.created.localeCompare(b.created));
}

/**
 * Delete a session file by session ID.
 * Returns true if deleted, false if the file did not exist.
 */
export async function deleteSession(sessionsDir: string, sessionId: string): Promise<boolean> {
  const path = join(sessionsDir, `${sessionId}.jsonl`);
  const exists = await Bun.file(path).exists();
  if (!exists) return false;
  await unlink(path);
  return true;
}

/**
 * Immediate persistence manager.
 * Creates the session file up front and appends every entry directly.
 */
export class SessionWriter {
  private sessionPath: string | null = null;
  private readonly preAssignedId: string;

  constructor(
    private sessionsDir: string,
    private cwd: string,
    existingPath?: string,
    private parentSession?: string,
    private collabMeta?: CollabSessionMeta,
    preAssignedId?: string,
  ) {
    if (existingPath) {
      this.sessionPath = existingPath;
      this.preAssignedId = basename(existingPath).replace(".jsonl", "");
    } else {
      this.preAssignedId = preAssignedId ?? generateSessionId();
    }
  }

  /** Ensure the session file exists on disk. */
  async create(): Promise<string> {
    if (this.sessionPath) return this.sessionPath;

    const { path } = await createSessionFile(
      this.sessionsDir,
      this.cwd,
      this.parentSession,
      this.collabMeta,
      this.preAssignedId,
    );
    this.sessionPath = path;
    return path;
  }

  /** Append an entry to disk immediately. */
  async write(entry: SessionEntry): Promise<void> {
    const path = await this.create();
    await appendEntry(path, entry);
  }

  /** Session ID — always available. */
  get id(): string {
    return this.preAssignedId;
  }

  get path(): string | null {
    return this.sessionPath;
  }
}
