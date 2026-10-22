// @summary Rebuildable session-list summaries validated against source file fingerprints
import { rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { SessionSummarySchema } from "@diligent/protocol";
import { z } from "zod";
import { SESSION_VERSION, type SessionInfo } from "./types";

const CACHE_FILE = ".summaries.json";
const FingerprintSchema = z.object({
  size: z.number().nonnegative().finite(),
  mtimeMs: z.number().finite(),
  ctimeMs: z.number().finite(),
  ino: z.number().nonnegative().finite(),
});
type Fingerprint = z.infer<typeof FingerprintSchema>;
const CacheSchema = z.object({
  version: z.literal(1),
  sessionVersion: z.literal(SESSION_VERSION),
  entries: z.array(
    z.object({
      file: z.string().refine((file) => basename(file) === file && !file.includes("\\") && file.endsWith(".jsonl")),
      fingerprint: FingerprintSchema,
      summary: SessionSummarySchema.omit({ path: true }).extend({
        created: z.string().datetime(),
        modified: z.string().datetime(),
      }),
    }),
  ),
});

interface CachedSummary {
  fingerprint: Fingerprint;
  summary: Promise<SessionInfo>;
}

class SessionSummaryCache {
  readonly ready: Promise<void>;
  private entries = new Map<string, CachedSummary>();
  private revision = 0;
  private persistedRevision = 0;
  private writing: Promise<void> | undefined;

  constructor(private readonly directory: string) {
    this.ready = this.load();
  }

  private async load(): Promise<void> {
    try {
      const stored = CacheSchema.parse(await Bun.file(join(this.directory, CACHE_FILE)).json());
      for (const row of stored.entries) {
        this.entries.set(row.file, {
          fingerprint: row.fingerprint,
          summary: Promise.resolve({
            ...row.summary,
            path: join(this.directory, row.file),
            created: new Date(row.summary.created),
            modified: new Date(row.summary.modified),
          }),
        });
      }
    } catch {
      // A missing, incompatible, or damaged derived index is rebuilt from JSONL.
    }
  }

  async get(file: string, read: (path: string) => Promise<SessionInfo>): Promise<SessionInfo> {
    const path = join(this.directory, file);
    const current = await stat(path);
    let cached = this.entries.get(file);
    if (
      !cached ||
      cached.fingerprint.size !== current.size ||
      cached.fingerprint.mtimeMs !== current.mtimeMs ||
      cached.fingerprint.ctimeMs !== current.ctimeMs ||
      cached.fingerprint.ino !== current.ino
    ) {
      // Fingerprint before reading: a concurrent append must invalidate this
      // result, not stamp older contents with the append's newer metadata.
      cached = {
        fingerprint: { size: current.size, mtimeMs: current.mtimeMs, ctimeMs: current.ctimeMs, ino: current.ino },
        summary: read(path),
      };
      this.entries.set(file, cached);
      this.revision++;
    }
    try {
      return await cached.summary;
    } catch (error) {
      // Do not retain transient I/O failures or incomplete appends as cache hits.
      if (this.entries.get(file) === cached) {
        this.entries.delete(file);
        this.revision++;
      }
      throw error;
    }
  }

  retain(files: Set<string>): void {
    for (const file of this.entries.keys()) {
      if (!files.has(file)) {
        this.entries.delete(file);
        this.revision++;
      }
    }
  }

  flush(): Promise<void> {
    if (this.writing) return this.writing;
    if (this.revision === this.persistedRevision) return Promise.resolve();
    const revision = this.revision;
    const snapshot = [...this.entries];
    this.writing = this.write(snapshot)
      .then(() => {
        this.persistedRevision = revision;
      })
      .catch(() => {
        // Cache availability must not prevent listing readable source records.
      })
      .finally(() => {
        this.writing = undefined;
      });
    return this.writing;
  }

  private async write(snapshot: [string, CachedSummary][]): Promise<void> {
    const entries = await Promise.all(
      snapshot.map(async ([file, cached]) => {
        try {
          const info = await cached.summary;
          return {
            file,
            fingerprint: cached.fingerprint,
            summary: {
              ...info,
              path: undefined,
              created: info.created.toISOString(),
              modified: info.modified.toISOString(),
            },
          };
        } catch {
          return undefined;
        }
      }),
    );
    const path = join(this.directory, CACHE_FILE);
    const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await writeFile(
        temporary,
        JSON.stringify({ version: 1, sessionVersion: SESSION_VERSION, entries: entries.filter(Boolean) }),
        {
          encoding: "utf8",
          mode: 0o600,
          flag: "wx",
        },
      );
      await rename(temporary, path);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
}

// Retain only small summaries for a bounded number of active projects.
const caches = new Map<string, SessionSummaryCache>();
const MAX_DIRECTORIES = 8;

export async function getSessionSummaryCache(directory: string): Promise<SessionSummaryCache> {
  let cache = caches.get(directory);
  if (!cache) cache = new SessionSummaryCache(directory);
  caches.delete(directory);
  caches.set(directory, cache);
  if (caches.size > MAX_DIRECTORIES) {
    const oldest = caches.keys().next().value;
    if (oldest !== undefined) caches.delete(oldest);
  }
  await cache.ready;
  return cache;
}
