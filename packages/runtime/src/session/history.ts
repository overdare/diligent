// @summary Read-only session previews and cursor pages from JSONL without loading complete transcripts
import { type FileHandle, open } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { UserMessage } from "@diligent/core/message-contract";
import type { ModelRef, ProviderName } from "@diligent/core/provider-contract";
import { ProviderNameSchema } from "@diligent/protocol";
import { z } from "zod";
import { normalizeLegacyModelRef } from "../model/legacy-model-ref";
import { materializeEntryImages } from "./image-sidecar";
import { isSafeSessionId, SESSION_VERSION, type SessionEntry, type SessionHeader, type SessionInfo } from "./types";

const READ_BYTES = 64 * 1024;
const PAGE_BYTES = 1024 * 1024;
const HistoryCursorSchema = z
  .object({
    version: z.literal(1),
    threadId: z.string(),
    created: z.string(),
    end: z.number().int().nonnegative(),
    before: z.number().int().nonnegative(),
    parentId: z.string().nullable().optional(),
    ino: z.number().nonnegative(),
  })
  .strict();

export function parseSessionHeader(line: string | undefined, path: string): SessionHeader {
  if (!line) throw new Error(`Empty session file: ${path}`);
  const header = JSON.parse(line) as SessionHeader;
  if (header.type !== "session") throw new Error(`Invalid session header in: ${path}`);
  if (header.version > SESSION_VERSION) {
    throw new Error(
      `Session file version ${header.version} is newer than supported version ${SESSION_VERSION}. Please update diligent.`,
    );
  }
  return header;
}

async function readHeader(file: FileHandle, path: string) {
  const fragments: Buffer[] = [];
  let offset = 0;
  for (;;) {
    const buffer = Buffer.allocUnsafe(READ_BYTES);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
    const head = buffer.subarray(0, bytesRead);
    const newline = head.indexOf(10);
    if (newline >= 0 || bytesRead < buffer.length) {
      fragments.push(head.subarray(0, newline < 0 ? bytesRead : newline));
      return {
        header: parseSessionHeader(Buffer.concat(fragments).toString("utf8").trim(), path),
        dataOffset: offset + (newline < 0 ? bytesRead : newline + 1),
        preview: newline < 0 ? Buffer.alloc(0) : head.subarray(newline + 1),
        previewEndsAtEof: bytesRead < buffer.length,
      };
    }
    fragments.push(head);
    offset += bytesRead;
  }
}

export async function readSessionHeader(path: string): Promise<SessionHeader> {
  const file = await open(path, "r");
  try {
    return (await readHeader(file, path)).header;
  } finally {
    await file.close();
  }
}

/** The offset always points before the next unread line, so cursors never hold transcript data. */
class ReverseLines {
  private buffer = Buffer.alloc(0);
  private start: number;
  private cursor = 0;

  constructor(
    private readonly file: FileHandle,
    end: number,
    private readonly floor: number,
  ) {
    this.start = end;
  }

  get offset(): number {
    return this.start + this.cursor;
  }

  async previous(): Promise<{ text: string; bytes: number } | undefined> {
    const pieces: Buffer[] = [];
    let length = 0;
    for (;;) {
      if (this.cursor === 0) {
        if (this.start <= this.floor) {
          if (length === 0) return;
          return { text: Buffer.concat(pieces.reverse(), length).toString("utf8").trim(), bytes: length };
        }
        const end = this.start;
        this.start = Math.max(this.floor, end - READ_BYTES);
        this.buffer = Buffer.allocUnsafe(end - this.start);
        const { bytesRead } = await this.file.read(this.buffer, 0, this.buffer.length, this.start);
        if (bytesRead !== this.buffer.length)
          throw new Error("Session changed while reading history. Reload the conversation.");
        this.cursor = bytesRead;
      }
      const newline = this.buffer.lastIndexOf(10, this.cursor - 1);
      const piece = this.buffer.subarray(newline + 1, this.cursor);
      pieces.push(piece);
      length += piece.length;
      this.cursor = newline < 0 ? 0 : newline;
      if (newline >= 0) {
        return { text: Buffer.concat(pieces.reverse(), length).toString("utf8").trim(), bytes: length };
      }
    }
  }
}

export function normalizePersistedModelRefs(entries: SessionEntry[]): SessionEntry[] {
  const normalized = entries.map((entry) => {
    if (entry.type !== "model_change") return entry;
    const provider = ProviderNameSchema.safeParse(entry.provider);
    const ref = normalizeLegacyModelRef(entry.modelId, provider.success ? provider.data : undefined);
    return { ...entry, provider: ref.provider, modelId: ref.modelId };
  });
  const byId = new Map(normalized.map((entry) => [entry.id, entry]));
  const modelByEntryId = new Map<string, ModelRef | undefined>();
  // Walk iteratively: long pre-compaction histories must not overflow the JS stack.
  for (const entry of normalized) {
    if (modelByEntryId.has(entry.id)) continue;
    const ancestors: SessionEntry[] = [];
    let current: SessionEntry | undefined = entry;
    while (current && !modelByEntryId.has(current.id)) {
      modelByEntryId.set(current.id, undefined);
      ancestors.push(current);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    let model = current ? modelByEntryId.get(current.id) : undefined;
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const ancestor = ancestors[i];
      if (ancestor.type === "model_change") model = { provider: ancestor.provider, modelId: ancestor.modelId };
      modelByEntryId.set(ancestor.id, model);
    }
  }
  return normalized.map((entry) => {
    if (entry.type !== "message" || entry.message.role !== "assistant") return entry;
    const rawModel = (entry.message as unknown as { model: unknown }).model;
    const ancestor = entry.parentId ? modelByEntryId.get(entry.parentId) : undefined;
    return {
      ...entry,
      message: {
        ...entry.message,
        model: normalizeLegacyModelRef(rawModel, ancestor?.provider as ProviderName | undefined),
      },
    };
  });
}

export function firstUserPreview(content: UserMessage["content"]): string | undefined {
  if (typeof content === "string") return content.slice(0, 100);
  const text = content
    .filter((block) => block.type === "text")
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 100);
  const imageCount = content.filter((block) => block.type === "local_image").length;
  return text || (imageCount > 1 ? "[images]" : imageCount === 1 ? "[image]" : undefined);
}

export type SessionPreview = Omit<SessionInfo, "messageCount"> & { messageCount?: number };

export async function readSessionPreview(path: string): Promise<SessionPreview> {
  const file = await open(path, "r");
  try {
    const stat = await file.stat();
    const { header, dataOffset, preview, previewEndsAtEof } = await readHeader(file, path);
    let firstUserMessage: string | undefined;
    let name: string | undefined;
    const lines = preview.toString("utf8").split("\n");
    if (!previewEndsAtEof) lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as SessionEntry;
        if (entry.type === "session_info" && entry.name) name = entry.name;
        if (entry.type === "message" && entry.visibility !== "internal" && entry.message.role === "user") {
          firstUserMessage = firstUserPreview(entry.message.content);
          break;
        }
      } catch {
        // A truncated preview is not evidence that the whole session is unreadable.
      }
    }
    return {
      id: header.id,
      path,
      cwd: header.cwd,
      name,
      created: new Date(header.timestamp),
      modified: stat.mtime,
      messageCount: stat.size <= dataOffset ? 0 : undefined,
      firstUserMessage,
      parentSession: header.parentSession,
    };
  } finally {
    await file.close();
  }
}

export async function findSessionPath(sessionsDir: string, sessionId: string): Promise<string | undefined> {
  if (!isSafeSessionId(sessionId)) return;
  const canonicalName = `${sessionId}.jsonl`;
  const canonical = join(sessionsDir, canonicalName);
  try {
    if ((await readSessionHeader(canonical)).id === sessionId) return canonical;
  } catch {
    /* Look for older exports whose filename differs from their header ID. */
  }
  try {
    for await (const name of new Bun.Glob("*.jsonl").scan(sessionsDir)) {
      if (name === canonicalName) continue;
      const path = join(sessionsDir, name);
      try {
        if ((await readSessionHeader(path)).id === sessionId) return path;
      } catch {
        /* Keep looking through readable headers. */
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function findMostRecentSession(sessionsDir: string): Promise<string | undefined> {
  const names = await Array.fromAsync(new Bun.Glob("*.jsonl").scan(sessionsDir));
  const remaining = names.values();
  let latest: SessionPreview | undefined;
  await Promise.all(
    Array.from({ length: Math.min(8, names.length) }, async () => {
      for (const name of remaining) {
        try {
          const preview = await readSessionPreview(join(sessionsDir, name));
          if (preview.parentSession) continue;
          if (
            !latest ||
            preview.modified > latest.modified ||
            (+preview.modified === +latest.modified && preview.id > latest.id)
          )
            latest = preview;
        } catch {
          /* One unreadable session must not hide other sessions. */
        }
      }
    }),
  );
  return latest?.path;
}

export async function readSessionHistoryPage(
  path: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<{
  header: SessionHeader;
  entries: SessionEntry[];
  nextCursor?: string;
}> {
  const file = await open(path, "r");
  try {
    const stat = await file.stat();
    const { header, dataOffset } = await readHeader(file, path);
    let cursor: z.infer<typeof HistoryCursorSchema> | undefined;
    if (options.cursor) {
      try {
        cursor = HistoryCursorSchema.parse(JSON.parse(Buffer.from(options.cursor, "base64url").toString("utf8")));
      } catch {
        throw new Error("Invalid history cursor. Reload the conversation.");
      }
      if (
        cursor.threadId !== header.id ||
        cursor.created !== header.timestamp ||
        cursor.ino !== stat.ino ||
        cursor.end > stat.size ||
        cursor.before > cursor.end ||
        cursor.before < dataOffset
      ) {
        throw new Error("Session changed while paging history. Reload the conversation.");
      }
    }
    const end = cursor?.end ?? stat.size;
    const reader = new ReverseLines(file, cursor?.before ?? end, dataOffset);
    let parentId = cursor?.parentId;
    const entries: SessionEntry[] = [];
    let bytes = 0;
    const limit = Math.max(1, Math.min(100, options.limit ?? 50));
    while (parentId !== null && entries.length < limit && bytes < PAGE_BYTES) {
      const line = await reader.previous();
      if (!line) break;
      bytes += line.bytes;
      if (!line.text) continue;
      let entry: SessionEntry;
      try {
        entry = JSON.parse(line.text) as SessionEntry;
      } catch {
        if (parentId !== undefined) throw new Error("Invalid entry in session history.");
        continue;
      }
      if (parentId !== undefined && entry.id !== parentId) continue;
      const restored = await materializeEntryImages(dirname(path), entry);
      if (
        entry.type === "message" &&
        entry.message.role === "tool_result" &&
        restored.type === "message" &&
        restored.message.role === "tool_result"
      ) {
        const stored = entry.message.outputImages ?? [];
        for (const [index, image] of (restored.message.outputImages ?? []).entries()) {
          bytes += Math.max(0, image.source.data.length - (stored[index]?.source.data.length ?? 0));
        }
      }
      entries.push(restored);
      parentId = entry.parentId ?? null;
    }
    return {
      header,
      entries: normalizePersistedModelRefs(entries.reverse()),
      nextCursor:
        parentId !== null && reader.offset > dataOffset
          ? Buffer.from(
              JSON.stringify({
                version: 1,
                threadId: header.id,
                created: header.timestamp,
                end,
                before: reader.offset,
                parentId,
                ino: stat.ino,
              }),
            ).toString("base64url")
          : undefined,
    };
  } finally {
    await file.close();
  }
}
