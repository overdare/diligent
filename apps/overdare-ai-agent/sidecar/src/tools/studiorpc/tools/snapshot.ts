// @summary Rollback snapshot helpers: capture/restore .ovdrjm level snapshots with metadata.

import { randomUUID } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  type Stats,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { resolvePaths } from "@diligent/runtime";
import { resolveOvdrjmPathFromUmap } from "./ovdrjm-utils";

export type SnapshotKind = "turn" | "manual" | "pre-rollback";
export type SnapshotSummaryStatus = "pending" | "ready" | "failed" | "unavailable";

/** Metadata stored in the `{id}.json` sidecar next to each snapshot. */
export interface SnapshotMeta {
  id: string;
  sessionId: string;
  index: number;
  createdAt: string;
  label?: string;
  kind: SnapshotKind;
  /** Session transcript the labeled request came from; enables read-time context lookup. */
  transcriptPath?: string;
  /** Exact ID of the user message that initiated this request. */
  userMessageId?: string;
  stateSummary?: string;
  summaryStatus?: SnapshotSummaryStatus;
}

/** A snapshot on disk: sidecar metadata plus the path to the .ovdrjm copy. */
export interface SnapshotEntry extends SnapshotMeta {
  path: string;
}

export interface CaptureOptions {
  label?: string;
  kind?: SnapshotKind;
  transcriptPath?: string;
  userMessageId?: string;
  summaryStatus?: SnapshotSummaryStatus;
}

/**
 * Directory holding rollback snapshots, under the project's storage-namespace
 * dir (`.overdare/snapshots` in prod, `.diligent/snapshots` by default). Uses
 * resolvePaths so the namespace and dot-prefix follow the project convention.
 */
export function snapshotsDir(cwd: string): string {
  return join(resolvePaths(cwd).root, "snapshots");
}

/**
 * Next request index for a session, derived by scanning published maps and
 * metadata sidecars. Filesystem is the source of truth so the counter survives
 * agent restarts, including a crash after metadata publication but before the
 * map commit.
 * Snapshots are named `{sessionId}_{index}.ovdrjm`.
 */
export function nextRequestIndex(snapshotsDir: string, sessionId: string): number {
  let entries: string[];
  try {
    entries = readdirSync(snapshotsDir);
  } catch {
    return 0; // dir does not exist yet
  }
  const prefix = `${sessionId}_`;
  let max = -1;
  for (const name of entries) {
    if (!name.startsWith(prefix)) continue;
    const extension = name.endsWith(".ovdrjm") ? ".ovdrjm" : name.endsWith(".json") ? ".json" : undefined;
    if (!extension) continue;
    const index = Number(name.slice(prefix.length, -extension.length));
    if (Number.isInteger(index) && index > max) max = index;
  }
  return max + 1;
}

function copySnapshotFile(sourcePath: string, targetPath: string): void {
  const source = openSync(sourcePath, "r");
  try {
    const target = openSync(targetPath, "wx", 0o600);
    try {
      const buffer = Buffer.allocUnsafe(64 * 1024);
      while (true) {
        const count = readSync(source, buffer, 0, buffer.length, null);
        if (count === 0) break;
        let offset = 0;
        while (offset < count) {
          const written = writeSync(target, buffer, offset, count - offset);
          if (written === 0) throw new Error("Failed to write snapshot file.");
          offset += written;
        }
      }
    } finally {
      closeSync(target);
    }
  } finally {
    closeSync(source);
  }
}

/**
 * Copy the project's current .ovdrjm into the snapshots dir as
 * `{sessionId}_{index}.ovdrjm` and write a `{sessionId}_{index}.json` metadata
 * sidecar (label, kind, createdAt). Raw byte copy preserves the original
 * UTF-16/UTF-8 encoding. Caller must ensure the level was saved to file first.
 * Returns the snapshot path.
 */
export function captureSnapshot(cwd: string, sessionId: string, index: number, options: CaptureOptions = {}): string {
  const { ovdrjmPath } = resolveOvdrjmPathFromUmap(cwd);
  const dir = snapshotsDir(cwd);
  mkdirSync(dir, { recursive: true });
  const id = `${sessionId}_${index}`;
  const dest = join(dir, `${id}.ovdrjm`);
  const metadataPath = join(dir, `${id}.json`);
  if (existsSync(dest) || existsSync(metadataPath)) {
    throw new Error(`Snapshot "${id}" already exists.`);
  }
  const meta: SnapshotMeta = {
    id,
    sessionId,
    index,
    createdAt: new Date().toISOString(),
    ...(options.label !== undefined ? { label: options.label } : {}),
    ...(options.transcriptPath !== undefined ? { transcriptPath: options.transcriptPath } : {}),
    ...(options.userMessageId !== undefined ? { userMessageId: options.userMessageId } : {}),
    ...(options.summaryStatus !== undefined ? { summaryStatus: options.summaryStatus } : {}),
    kind: options.kind ?? "turn",
  };
  const nonce = randomUUID();
  const snapshotTempPath = join(dir, `.${id}.${nonce}.snapshot-tmp`);
  const metadataTempPath = join(dir, `.${id}.${nonce}.metadata-tmp`);
  let metadataPublished = false;
  try {
    copySnapshotFile(ovdrjmPath, snapshotTempPath);
    writeFileSync(metadataTempPath, JSON.stringify(meta), { flag: "wx", mode: 0o600 });
    // The map rename is the visibility/commit point: listSnapshots ignores the
    // metadata sidecar until the matching .ovdrjm exists.
    renameSync(metadataTempPath, metadataPath);
    metadataPublished = true;
    renameSync(snapshotTempPath, dest);
    return dest;
  } catch (error) {
    rmSync(snapshotTempPath, { force: true });
    rmSync(metadataTempPath, { force: true });
    if (metadataPublished) rmSync(metadataPath, { force: true });
    throw error;
  }
}

/** Parse `{sessionId}_{index}` from a snapshot filename; sessionId may itself contain underscores. */
function parseSnapshotName(name: string): { sessionId: string; index: number } | undefined {
  const stem = name.slice(0, -".ovdrjm".length);
  const sep = stem.lastIndexOf("_");
  if (sep <= 0) return undefined;
  const index = Number(stem.slice(sep + 1));
  if (!Number.isInteger(index)) return undefined;
  return { sessionId: stem.slice(0, sep), index };
}

/** Loads one committed map's metadata; identity always comes from its filename. */
function readSnapshotEntry(dir: string, id: string): (SnapshotEntry & { mtimeMs: number }) | undefined {
  // IDs are single filenames on both Unix and Windows, never paths or streams.
  if (id.includes("/") || id.includes("\\") || id.includes(":") || id.includes("\0")) return undefined;
  const parsed = parseSnapshotName(`${id}.ovdrjm`);
  if (!parsed) return undefined;
  const path = join(dir, `${id}.ovdrjm`);
  let mapStat: Stats;
  try {
    mapStat = statSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  if (!mapStat.isFile()) return undefined;
  const mtimeMs = mapStat.mtimeMs;
  let meta: SnapshotMeta | undefined;
  try {
    meta = JSON.parse(readFileSync(join(dir, `${id}.json`), "utf-8")) as SnapshotMeta;
  } catch {
    // Preserve legacy fallback for missing, unreadable, or malformed metadata.
  }
  return {
    id,
    path,
    sessionId: parsed.sessionId,
    index: parsed.index,
    createdAt: meta?.createdAt ?? new Date(mtimeMs).toISOString(),
    ...(meta?.label !== undefined ? { label: meta.label } : {}),
    ...(meta?.transcriptPath !== undefined ? { transcriptPath: meta.transcriptPath } : {}),
    ...(meta?.userMessageId !== undefined ? { userMessageId: meta.userMessageId } : {}),
    ...(meta?.stateSummary !== undefined ? { stateSummary: meta.stateSummary } : {}),
    ...(meta?.summaryStatus !== undefined
      ? {
          // Interrupted background work must not remain pending indefinitely.
          summaryStatus:
            meta.summaryStatus === "pending" && Date.now() - Date.parse(meta.createdAt) > 60_000
              ? "failed"
              : meta.summaryStatus,
        }
      : {}),
    kind: meta?.kind ?? "turn",
    mtimeMs,
  };
}

/**
 * All snapshots in the project, newest first (by file mtime). Snapshots
 * predating the metadata sidecar are listed with kind "turn", no label, and an
 * mtime-derived createdAt so old projects keep working.
 */
export function listSnapshots(cwd: string): SnapshotEntry[] {
  const dir = snapshotsDir(cwd);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const entries: Array<SnapshotEntry & { mtimeMs: number }> = [];
  for (const name of names) {
    if (!name.endsWith(".ovdrjm")) continue;
    const entry = readSnapshotEntry(dir, name.slice(0, -".ovdrjm".length));
    if (entry) entries.push(entry);
  }
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return entries.map(({ mtimeMs: _mtimeMs, ...entry }) => entry);
}

/**
 * Most recent automatic baseline. Manual and pre-rollback checkpoints remain
 * reachable by explicit ID and do not replace the default target, so a
 * parameterless rollback stays idempotent (calling it twice restores the same
 * baseline instead of undoing itself); they remain reachable via
 * findSnapshotById. Throws if no snapshot exists.
 */
export function findLatestSnapshot(cwd: string): SnapshotEntry {
  const latest = listSnapshots(cwd).find((entry) => entry.kind === "turn");
  if (!latest) {
    throw new Error("No rollback snapshot found. Nothing to roll back.");
  }
  return latest;
}

/** Reads only the requested snapshot's map stat and metadata, without listing the directory. */
export function findSnapshotById(cwd: string, id: string): SnapshotEntry {
  const entry = readSnapshotEntry(snapshotsDir(cwd), id);
  if (!entry) {
    throw new Error(`Snapshot "${id}" not found. Use studiorpc_snapshot_list to see available snapshots.`);
  }
  const { mtimeMs: _mtimeMs, ...snapshot } = entry;
  return snapshot;
}

/** Overwrite the project's current ovdrjm with the snapshot bytes. */
export function restoreSnapshot(cwd: string, snapshotPath: string): void {
  const { ovdrjmPath } = resolveOvdrjmPathFromUmap(cwd);
  copyFileSync(snapshotPath, ovdrjmPath);
}

// ponytail: fixed cap; make configurable only if a real project needs it.
export const MAX_SNAPSHOTS_PER_SESSION = 20;

/**
 * Delete the oldest automatic/safety snapshots beyond `keep` for one session.
 * Manual checkpoints are retained. Ordered by index, so
 * it is a more reliable age signal than mtime.
 */
export function pruneSnapshots(cwd: string, sessionId: string, keep = MAX_SNAPSHOTS_PER_SESSION): void {
  const dir = snapshotsDir(cwd);
  const sessionEntries = listSnapshots(cwd)
    .filter((entry) => entry.sessionId === sessionId && entry.kind !== "manual")
    .sort((a, b) => b.index - a.index);
  for (const entry of sessionEntries.slice(keep)) {
    rmSync(entry.path, { force: true });
    rmSync(join(dir, `${entry.id}.json`), { force: true });
  }
}

/** Labels store the full prompt (up to 2000 chars); keep human-facing output compact. */
export function truncateLabel(label: string): string {
  return label.length > 120 ? `${label.slice(0, 120)}…` : label;
}
