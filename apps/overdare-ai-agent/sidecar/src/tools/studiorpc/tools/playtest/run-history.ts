// @summary Detects the same harness failing the same way across consecutive saved playtest runs.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PlaytestResult } from "./runtime-types";

export const REPEATED_FAILURE_THRESHOLD = 3;
const MAX_SCANNED_RUNS = 24;
const RUN_DIRECTORY_PATTERN = /^(\d+)-[0-9a-f]{8}$/;
const FAILED_OUTCOMES: Record<string, true> = {
  failure: true,
  stuck: true,
  error: true,
  timeout: true,
  session_changed: true,
};

export interface RepeatedFailure {
  /** Consecutive runs of this harness, including the current one, that share `signature`. */
  count: number;
  signature: string;
  /** True when every counted run used the current harness source hash. */
  sameSourceHash: boolean;
  /** Run directory names, newest first; the current run is first. */
  runIds: string[];
  guidance: string;
}

interface RunFacts {
  outcome: string;
  reason: string;
  sourceHash?: string;
}

/**
 * Normalizes measured values (durations, distances, large ids) so the same failure in different
 * runs compares equal, while small step numbers such as "step 3" stay distinct.
 */
export function failureSignature(run: RunFacts): string | undefined {
  if (!FAILED_OUTCOMES[run.outcome]) return undefined;
  const reason = run.reason
    .replace(/\d+(?:\.\d+)?\s*(ms|cm|s)\b/g, "#$1")
    .replace(/\b\d+\.\d+\b/g, "#")
    .replace(/\b\d{3,}\b/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  return `${run.outcome}: ${reason}`;
}

async function readRun(directory: string): Promise<(RunFacts & { harnessName?: string }) | undefined> {
  try {
    const summary = JSON.parse(await readFile(join(directory, "summary.json"), "utf8")) as Record<string, unknown>;
    if (typeof summary.outcome !== "string" || typeof summary.reason !== "string") return undefined;
    return {
      outcome: summary.outcome,
      reason: summary.reason,
      ...(typeof summary.sourceHash === "string" ? { sourceHash: summary.sourceHash } : {}),
      ...(typeof summary.harnessName === "string" ? { harnessName: summary.harnessName } : {}),
    };
  } catch {
    return undefined;
  }
}

export async function findRepeatedFailure(options: {
  playtestsDirectory: string;
  currentRunId: string;
  harnessName: string;
  sourceHash: string;
  result: Pick<PlaytestResult, "outcome" | "reason">;
  threshold?: number;
}): Promise<RepeatedFailure | undefined> {
  const threshold = options.threshold ?? REPEATED_FAILURE_THRESHOLD;
  const signature = failureSignature(options.result);
  if (!signature) return undefined;
  let names: string[];
  try {
    names = await readdir(options.playtestsDirectory);
  } catch {
    return undefined;
  }
  const previous = names
    .filter((name) => name !== options.currentRunId && RUN_DIRECTORY_PATTERN.test(name))
    .sort((left, right) => Number(right.split("-")[0]) - Number(left.split("-")[0]))
    .slice(0, MAX_SCANNED_RUNS);
  const runIds = [options.currentRunId];
  let sameSourceHash = true;
  for (const name of previous) {
    const run = await readRun(join(options.playtestsDirectory, name));
    if (!run || run.harnessName !== options.harnessName) continue;
    if (failureSignature(run) !== signature) break;
    runIds.push(name);
    if (run.sourceHash !== options.sourceHash) sameSourceHash = false;
  }
  if (runIds.length < threshold) return undefined;
  const unchanged = sameSourceHash ? " with an unchanged harness source" : "";
  return {
    count: runIds.length,
    signature,
    sameSourceHash,
    runIds,
    guidance: `${options.harnessName} ended with the same failure in ${runIds.length} consecutive runs${unchanged}. Do not rerun the full episode on the same hypothesis: locate the responsible boundary with a narrow probe (one action, a short episode or a read-only observation), change the hypothesis, or report the blocker with these run ids.`,
  };
}
