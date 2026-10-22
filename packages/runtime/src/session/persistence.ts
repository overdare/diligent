// @summary Session file persistence with JSONL format, immediate writing, and session listing
import { appendFile, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { ModelRef, ProviderName } from "@diligent/core/provider-contract";
import { ProviderNameSchema } from "@diligent/protocol";
import { normalizeLegacyModelRef } from "../model/legacy-model-ref";
import { externalizeEntryImages, materializeEntryImages } from "./image-sidecar";
import { getSessionSummaryCache } from "./summary-cache";
import type { AppendedEntryInfo, CollabSessionMeta, SessionEntry, SessionHeader, SessionInfo } from "./types";
import { generateSessionId, isSafeSessionId, SESSION_VERSION } from "./types";

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
  if (!isSafeSessionId(id)) {
    throw new Error(`Invalid session ID: ${id}`);
  }
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
 *
 * Tool-result images are externalized to a sidecar blob directory before the
 * entry is serialized, so the JSONL line stays small (typically <1 KB even
 * for 5 MB image attachments). Without this, image-heavy sessions inflate
 * the file by megabytes per entry and make listSessions O(image bytes).
 */
export async function appendEntry(sessionPath: string, entry: SessionEntry): Promise<void> {
  const sessionsDir = dirname(sessionPath);
  const externalized = await externalizeEntryImages(sessionsDir, entry);
  await appendFile(sessionPath, `${JSON.stringify(externalized)}\n`, "utf8");
}

function parseSessionHeader(line: string | undefined, path: string): SessionHeader {
  if (!line) throw new Error(`Empty session file: ${path}`);
  const header = JSON.parse(line) as SessionHeader;
  if (header.type !== "session") throw new Error(`Invalid session header in: ${path}`);
  if (header.version > SESSION_VERSION) {
    throw new Error(
      `Session file version ${header.version} is newer than supported version ${SESSION_VERSION}. ` +
        "Please update diligent.",
    );
  }
  return header;
}

/**
 * Read all lines from a session file.
 * Validates header version.
 *
 * Pass `{ materializeImages: false }` when only persisted entries are needed,
 * without reading image sidecar blobs.
 */
export async function readSessionFile(
  path: string,
  options?: { materializeImages?: boolean },
): Promise<{ header: SessionHeader; entries: SessionEntry[] }> {
  const text = await Bun.file(path).text();
  const lines = text.trim().split("\n").filter(Boolean);

  const header = parseSessionHeader(lines[0], path);

  const rawEntries = normalizePersistedModelRefs(lines.slice(1).map((line) => JSON.parse(line) as SessionEntry));
  if (options?.materializeImages === false) {
    return { header, entries: rawEntries };
  }
  const sessionsDir = dirname(path);
  const entries = await Promise.all(rawEntries.map((entry) => materializeEntryImages(sessionsDir, entry)));
  return { header, entries };
}

function normalizePersistedModelRefs(entries: SessionEntry[]): SessionEntry[] {
  const normalized = entries.map((entry) => {
    if (entry.type !== "model_change") return entry;
    const provider = ProviderNameSchema.safeParse(entry.provider);
    const ref = normalizeLegacyModelRef(entry.modelId, provider.success ? provider.data : undefined);
    return { ...entry, provider: ref.provider, modelId: ref.modelId };
  });
  const byId = new Map(normalized.map((entry) => [entry.id, entry]));
  const modelByEntryId = new Map<string, ModelRef | undefined>();
  const nearestModel = (entry: SessionEntry): ModelRef | undefined => {
    if (modelByEntryId.has(entry.id)) return modelByEntryId.get(entry.id);
    const current = entry.type === "model_change" ? { provider: entry.provider, modelId: entry.modelId } : undefined;
    const parent = entry.parentId ? byId.get(entry.parentId) : undefined;
    const inherited = parent ? nearestModel(parent) : undefined;
    const result = current ?? inherited;
    modelByEntryId.set(entry.id, result);
    return result;
  };
  return normalized.map((entry) => {
    if (entry.type !== "message" || entry.message.role !== "assistant") return entry;
    const rawModel = (entry.message as unknown as { model: unknown }).model;
    const parent = entry.parentId ? byId.get(entry.parentId) : undefined;
    const ancestor = parent ? nearestModel(parent) : undefined;
    const ref = normalizeLegacyModelRef(rawModel, ancestor?.provider as ProviderName | undefined);
    return { ...entry, message: { ...entry.message, model: ref } };
  });
}

const SUMMARY_READ_CONCURRENCY = 8;

async function readSessionSummary(path: string): Promise<SessionInfo> {
  const lines = (await Bun.file(path).text()).trim().split("\n").filter(Boolean);
  const header = parseSessionHeader(lines[0], path);
  let modified = header.timestamp;
  let name: string | undefined;
  let messageCount = 0;
  let firstUserMessage: string | undefined;
  let foundUser = false;
  for (let index = 1; index < lines.length; index++) {
    // Listing does not need model migration, parent-chain reconstruction, or blobs.
    const entry = JSON.parse(lines[index]) as SessionEntry;
    modified = entry.timestamp;
    if (entry.type === "session_info" && entry.name) name = entry.name;
    if (entry.type !== "message" || entry.visibility === "internal") continue;
    messageCount++;
    if (foundUser || entry.message.role !== "user") continue;
    foundUser = true;
    const content = entry.message.content;
    if (typeof content === "string") {
      firstUserMessage = content.slice(0, 100);
    } else {
      const text = content
        .filter((block) => block.type === "text")
        .map((block) => block.text.trim())
        .filter(Boolean)
        .join(" ")
        .slice(0, 100);
      const imageCount = content.filter((block) => block.type === "local_image").length;
      firstUserMessage = text || (imageCount > 1 ? "[images]" : imageCount === 1 ? "[image]" : undefined);
    }
  }
  return {
    id: header.id,
    path,
    cwd: header.cwd,
    name,
    created: new Date(header.timestamp),
    modified: new Date(modified),
    messageCount,
    firstUserMessage,
    parentSession: header.parentSession,
  };
}

/**
 * List sessions by persisted modification time, with stable ID tie-breaking.
 * Check file metadata on every call; read only changed files with bounded concurrency.
 */
export async function listSessions(sessionsDir: string): Promise<SessionInfo[]> {
  const directory = resolve(sessionsDir);
  const cache = await getSessionSummaryCache(directory);
  const seen = new Set<string>();
  const sessions: SessionInfo[] = [];
  const addSession = async (file: string): Promise<void> => {
    try {
      const summary = await cache.get(file, readSessionSummary);
      // Callers own their results, including mutable Date instances.
      sessions.push({
        ...summary,
        path: join(sessionsDir, file),
        created: new Date(summary.created.getTime()),
        modified: new Date(summary.modified.getTime()),
      });
    } catch {
      // Keep listing readable sessions when a file is corrupt or disappears.
    }
  };
  for await (const file of new Bun.Glob("*.jsonl").scan(directory)) {
    seen.add(file);
  }
  // Keep workers busy when session sizes differ, rather than waiting for a
  // whole batch behind its largest file.
  const remaining = seen.values();
  await Promise.all(
    Array.from({ length: Math.min(SUMMARY_READ_CONCURRENCY, seen.size) }, async () => {
      for (const file of remaining) await addSession(file);
    }),
  );
  cache.retain(seen);
  await cache.flush();
  return sessions.sort((a, b) => {
    const modifiedDelta = b.modified.getTime() - a.modified.getTime();
    if (modifiedDelta !== 0) return modifiedDelta;
    return b.id.localeCompare(a.id);
  });
}

export interface SessionPersistenceConfig {
  sessionsDir: string;
  cwd: string;
  parentSession?: string;
  collabMeta?: CollabSessionMeta;
  sessionId?: string;
  /** Snapshot identity when a write is queued, not when its observer runs later. */
  getUserId?: () => string | undefined;
  /** Fire-and-forget observer invoked after each entry is durably written. */
  onEntryAppended?: (info: AppendedEntryInfo) => void;
}

export interface SessionReconcileResult {
  changed: boolean;
  reason: "no_session_path" | "memory_newer" | "already_equal" | "updated_from_disk";
  sessionPath: string | null;
  memoryEntries: number;
  diskEntries: number;
  memoryLeafId: string | null;
  diskLeafId: string | null;
  memoryTailEntryIds: string;
  diskTailEntryIds: string;
  memoryTailMessage: string;
  diskTailMessage: string;
}

export class SessionPersistence {
  private parentSessionId: string | undefined;
  private writer: SessionWriter;
  private writeQueue: Promise<void> = Promise.resolve();
  /** Monotonic per-session line counter; seeded from existing entries on resume. */
  private seq = 0;

  constructor(private readonly config: SessionPersistenceConfig) {
    this.parentSessionId = config.parentSession;
    this.writer = this.createWriter(config.sessionId);
  }

  resetForCreate(): void {
    this.parentSessionId = this.config.parentSession;
    this.writeQueue = Promise.resolve();
    this.seq = 0;
    this.writer = this.createWriter(this.config.sessionId ?? this.writer.id);
  }

  async create(): Promise<void> {
    await this.writer.create();
  }

  async resume(options: { sessionId?: string; mostRecent?: boolean }): Promise<SessionEntry[] | null> {
    let sessionPath: string | undefined;

    if (options.sessionId) {
      if (!isSafeSessionId(options.sessionId)) return null;
      sessionPath = join(this.config.sessionsDir, `${options.sessionId}.jsonl`);
    } else if (options.mostRecent) {
      const sessions = await listSessions(this.config.sessionsDir);
      sessionPath = sessions.find((s) => !s.parentSession)?.path;
    }

    if (!sessionPath) return null;

    let data: Awaited<ReturnType<typeof readSessionFile>>;
    try {
      data = await readSessionFile(sessionPath, { materializeImages: false });
    } catch (error) {
      // Explicit lookup reports missing, corrupt, and unsupported files as not found.
      if (options.sessionId) return null;
      throw error;
    }
    const { header } = data;
    if (options.sessionId && header.id !== options.sessionId) return null;
    const sessionsDir = dirname(sessionPath);
    const entries = await Promise.all(data.entries.map((entry) => materializeEntryImages(sessionsDir, entry)));
    this.parentSessionId = header.parentSession;
    this.writeQueue = Promise.resolve();
    // Seed seq from existing lines so resumed sessions keep (session_id, seq) unique.
    this.seq = entries.length;
    this.writer = new SessionWriter(this.config.sessionsDir, this.config.cwd, sessionPath);
    return entries;
  }

  async list(): Promise<SessionInfo[]> {
    return listSessions(this.config.sessionsDir);
  }

  append(entry: SessionEntry, onError: (error: unknown) => void): void {
    const userId = this.captureObserverUserId();
    this.writeQueue = this.writeQueue
      .then(async () => {
        await this.writer.write(entry);
        this.notifyAppended(entry, userId);
      })
      .catch(onError);
  }

  appendMany(entries: SessionEntry[], onError: (error: unknown, entry: SessionEntry) => void): void {
    for (const entry of entries) {
      const userId = this.captureObserverUserId();
      this.writeQueue = this.writeQueue
        .then(async () => {
          await this.writer.write(entry);
          this.notifyAppended(entry, userId);
        })
        .catch((error) => onError(error, entry));
    }
  }

  private captureObserverUserId(): string | undefined {
    try {
      return this.config.getUserId?.();
    } catch {
      // Observability context must never break session persistence.
      return undefined;
    }
  }

  /**
   * Best-effort: notify the per-append observer after a successful write.
   *
   * `seq` is incremented synchronously to preserve append order, but the observer is
   * dispatched on a later macrotask (`setImmediate`) so its work (e.g. masking + network
   * transmission) never runs on the awaited write `.then` tick — `waitForWrites()` (and
   * therefore turn start/end) must never wait on telemetry. Never throws.
   */
  private notifyAppended(entry: SessionEntry, userId: string | undefined): void {
    this.seq += 1;
    const observer = this.config.onEntryAppended;
    if (!observer) return;
    const info = {
      sessionId: this.writer.id,
      sessionPath: this.writer.path,
      cwd: this.config.cwd,
      entry,
      seq: this.seq,
      userId,
    };
    setImmediate(() => {
      try {
        observer(info);
      } catch {
        // Observer is best-effort; never disrupt persistence.
      }
    });
  }

  async waitForWrites(): Promise<void> {
    await this.writeQueue;
  }

  async reconcile(args: {
    committedEntries: SessionEntry[];
    committedLeafId: string | null;
    summarizeTailEntryIds: (entries: SessionEntry[]) => string;
    summarizeLastPersistedMessage: (entries: SessionEntry[]) => string;
  }): Promise<{ result: SessionReconcileResult; entries?: SessionEntry[] }> {
    const sessionPath = this.writer.path;
    const memoryEntries = args.committedEntries.length;
    const memoryLeafId = args.committedLeafId;
    const memoryTailEntryIds = args.summarizeTailEntryIds(args.committedEntries);
    const memoryTailMessage = args.summarizeLastPersistedMessage(args.committedEntries);

    if (!sessionPath) {
      return {
        result: {
          changed: false,
          reason: "no_session_path",
          sessionPath: null,
          memoryEntries,
          diskEntries: 0,
          memoryLeafId,
          diskLeafId: null,
          memoryTailEntryIds,
          diskTailEntryIds: "-",
          memoryTailMessage,
          diskTailMessage: "-",
        },
      };
    }

    await this.writeQueue.catch(() => {});

    const { entries } = await readSessionFile(sessionPath);
    const diskLeafId = entries.length > 0 ? entries[entries.length - 1].id : null;
    const diskTailEntryIds = args.summarizeTailEntryIds(entries);
    const diskTailMessage = args.summarizeLastPersistedMessage(entries);

    if (entries.length < args.committedEntries.length) {
      return {
        result: {
          changed: false,
          reason: "memory_newer",
          sessionPath,
          memoryEntries,
          diskEntries: entries.length,
          memoryLeafId,
          diskLeafId,
          memoryTailEntryIds,
          diskTailEntryIds,
          memoryTailMessage,
          diskTailMessage,
        },
      };
    }

    if (entries.length === args.committedEntries.length && diskLeafId === args.committedLeafId) {
      return {
        result: {
          changed: false,
          reason: "already_equal",
          sessionPath,
          memoryEntries,
          diskEntries: entries.length,
          memoryLeafId,
          diskLeafId,
          memoryTailEntryIds,
          diskTailEntryIds,
          memoryTailMessage,
          diskTailMessage,
        },
      };
    }

    return {
      result: {
        changed: true,
        reason: "updated_from_disk",
        sessionPath,
        memoryEntries,
        diskEntries: entries.length,
        memoryLeafId,
        diskLeafId,
        memoryTailEntryIds,
        diskTailEntryIds,
        memoryTailMessage,
        diskTailMessage,
      },
      entries,
    };
  }

  get sessionPath(): string | null {
    return this.writer.path;
  }

  get sessionId(): string {
    return this.writer.id;
  }

  get parentSession(): string | undefined {
    return this.parentSessionId;
  }

  private createWriter(sessionId?: string): SessionWriter {
    return new SessionWriter(
      this.config.sessionsDir,
      this.config.cwd,
      undefined,
      this.config.parentSession,
      this.config.collabMeta,
      sessionId,
    );
  }
}

/**
 * Delete a session file by session ID.
 * Returns true if deleted, false if the file did not exist.
 */
export async function deleteSession(sessionsDir: string, sessionId: string): Promise<boolean> {
  if (!isSafeSessionId(sessionId)) {
    throw new Error(`Invalid session ID: ${sessionId}`);
  }
  const path = join(sessionsDir, `${sessionId}.jsonl`);
  const exists = await Bun.file(path).exists();
  if (!exists) return false;
  await unlink(join(sessionsDir, "goals", `${sessionId}.jsonl`)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  await unlink(path);
  return true;
}

/**
 * Immediate persistence manager.
 * Creates the session file up front and appends every entry directly.
 */
/**
 * Immediate persistence manager for session files.
 * SessionPersistence builds on top of this lower-level writer.
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
