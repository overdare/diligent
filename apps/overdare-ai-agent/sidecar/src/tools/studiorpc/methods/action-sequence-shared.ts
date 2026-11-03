// @summary Adds offline catalog durations to unknown clips and emits compact readable sequence results.
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

type RecordValue = Record<string, unknown>;
export function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseAnimationCatalog(text: string): Map<string, number> {
  const result = new Map<string, number>();
  for (const entry of text.split(/^##\s+/m)) {
    const id = entry.match(/^\s*-\s*Asset ID:\s*(ovdrassetid:\/\/\d+)\s*$/m)?.[1];
    const duration = entry.match(/^\s*-\s*Duration:\s*(\d+(?:\.\d+)?)\s*s\s*$/m)?.[1];
    if (id && duration && Number(duration) > 0) result.set(id, Number(duration));
  }
  return result;
}

function catalogDirectory(): string {
  const executable = dirname(process.execPath);
  const bootstrap =
    process.env.OVERDARE_BOOTSTRAP_DIR ??
    [join(executable, "bootstrap"), join(executable, "defaults")].find(existsSync) ??
    resolve(import.meta.dir, "../../../../../bootstrap");
  return join(bootstrap, "skills/actionsequence/references/animations");
}

export async function enrichClipDurations<T extends { timeline: RecordValue[]; issues: RecordValue[] }>(
  result: T,
  directory = catalogDirectory(),
): Promise<T> {
  const durations = new Map<string, number>();
  try {
    const files = (await readdir(directory)).filter((file) => file.endsWith(".md"));
    const catalogs = await Promise.all(files.map((file) => readFile(join(directory, file), "utf8")));
    for (const text of catalogs) for (const [id, duration] of parseAnimationCatalog(text)) durations.set(id, duration);
  } catch {
    // An unavailable catalog leaves durations explicitly unknown. Never download to fill them.
    return result;
  }
  const issues = [...result.issues];
  const timeline = result.timeline.map((row) => {
    if (row.kind !== "Animation" || typeof row.clipDurationSeconds === "number") return row;
    const id = isRecord(row.OvdrAssetId) ? row.OvdrAssetId.ovdrAssetId : undefined;
    const duration = typeof id === "string" ? durations.get(id) : undefined;
    if (duration === undefined) return row;
    const remaining = duration - (typeof row.StartOffsetTime === "number" ? row.StartOffsetTime : 0);
    const interval =
      typeof row.StartTime === "number" && typeof row.EndTime === "number" ? row.EndTime - row.StartTime : undefined;
    if (interval !== undefined && Math.abs(remaining - interval) > 1e-5)
      issues.push({
        kind: remaining < interval ? "clipRepeats" : "clipCropped",
        severity: "info",
        trackIndex: row.trackIndex,
        TrackID: row.TrackID,
        startTime: row.StartTime,
        endTime: row.EndTime,
        message:
          remaining < interval
            ? "The remaining clip is shorter than its interval; runtime repeats it."
            : "The track crops the remaining clip.",
        evidence: {
          clipDurationSeconds: duration,
          remainingClipSeconds: remaining,
          intervalSeconds: interval,
          source: "catalog",
        },
      });
    return { ...row, clipDurationSeconds: duration, clipDurationSource: "catalog" };
  });
  return { ...result, timeline, issues };
}

export function formatSequenceResult(result: RecordValue): string {
  const placeholders = new Map<string, unknown[]>();
  const compact = { ...result };
  for (const field of ["timeline", "issues", "warnings"]) {
    if (Array.isArray(compact[field])) {
      const token = `__ACTION_SEQUENCE_${field}__`;
      placeholders.set(token, compact[field] as unknown[]);
      compact[field] = token;
    }
  }
  if (isRecord(compact.preview)) {
    compact.preview = { ...compact.preview };
    for (const field of ["collisions", "poseSamples"]) {
      const preview = compact.preview as RecordValue;
      if (!Array.isArray(preview[field])) continue;
      const token = `__ACTION_SEQUENCE_PREVIEW_${field}__`;
      placeholders.set(token, preview[field] as unknown[]);
      preview[field] = token;
    }
  }
  let text = JSON.stringify(compact, null, 2);
  for (const [token, values] of placeholders) {
    const lines = values.map((value) => `    ${JSON.stringify(value)}`);
    text = text.replace(JSON.stringify(token), () => (lines.length ? `[\n${lines.join(",\n")}\n  ]` : "[]"));
  }
  return text;
}
