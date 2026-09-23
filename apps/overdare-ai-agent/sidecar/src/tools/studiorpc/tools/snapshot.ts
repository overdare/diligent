// @summary Rollback snapshot helpers: capture/restore .ovdrjm level snapshots with metadata.

import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
 * Next request index for a session, derived by scanning the snapshots dir.
 * Filesystem is the source of truth so the counter survives agent restarts.
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
    if (!name.startsWith(prefix) || !name.endsWith(".ovdrjm")) continue;
    const index = Number(name.slice(prefix.length, -".ovdrjm".length));
    if (Number.isInteger(index) && index > max) max = index;
  }
  return max + 1;
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
  copyFileSync(ovdrjmPath, dest);
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
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(meta));
  return dest;
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
    const parsed = parseSnapshotName(name);
    if (!parsed) continue;
    const path = join(dir, name);
    const mtimeMs = statSync(path).mtimeMs;
    const id = name.slice(0, -".ovdrjm".length);
    let meta: SnapshotMeta | undefined;
    try {
      meta = JSON.parse(readFileSync(join(dir, `${id}.json`), "utf-8")) as SnapshotMeta;
    } catch {
      // legacy snapshot without metadata sidecar
    }
    entries.push({
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
            // A stopped process cannot finish its background task. Expose expired
            // pending work as failed without turning a read into a filesystem write.
            summaryStatus:
              meta.summaryStatus === "pending" && Date.now() - Date.parse(meta.createdAt) > 60_000
                ? "failed"
                : meta.summaryStatus,
          }
        : {}),
      kind: meta?.kind ?? "turn",
      mtimeMs,
    });
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

/** Snapshot with the given id. Throws when it does not exist. */
export function findSnapshotById(cwd: string, id: string): SnapshotEntry {
  const entry = listSnapshots(cwd).find((candidate) => candidate.id === id);
  if (!entry) {
    throw new Error(`Snapshot "${id}" not found. Use studiorpc_snapshot_list to see available snapshots.`);
  }
  return entry;
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
