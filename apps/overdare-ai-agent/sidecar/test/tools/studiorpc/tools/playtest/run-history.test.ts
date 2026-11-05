// @summary Consecutive same-harness failures are detected across saved runs; other harnesses and changed failures break the streak.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { failureSignature, findRepeatedFailure } from "../../../../../src/tools/studiorpc/tools/playtest/run-history";

let directory: string;
let clock = 1_790_000_000_000;

async function saveRun(summary: Record<string, unknown>): Promise<string> {
  clock += 1_000;
  const runId = `${clock}-${Math.random().toString(16).slice(2, 10).padEnd(8, "0")}`;
  await mkdir(join(directory, runId), { recursive: true });
  await writeFile(join(directory, runId, "summary.json"), JSON.stringify(summary));
  return runId;
}

function nextRunId(): string {
  clock += 1_000;
  return `${clock}-abcdef01`;
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "playtest-history-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("repeated playtest failure guard", () => {
  test("flags the third consecutive identical failure even when measured values differ", async () => {
    await saveRun({
      harnessName: "rf-f18",
      sourceHash: "a",
      outcome: "stuck",
      reason: "No meaningful progress for 18024ms (limit 18000ms)",
    });
    await saveRun({ harnessName: "other", sourceHash: "z", outcome: "success", reason: "done" });
    await saveRun({
      harnessName: "rf-f18",
      sourceHash: "b",
      outcome: "stuck",
      reason: "No meaningful progress for 18019ms (limit 18000ms)",
    });
    const currentRunId = nextRunId();
    const repeated = await findRepeatedFailure({
      playtestsDirectory: directory,
      currentRunId,
      harnessName: "rf-f18",
      sourceHash: "b",
      result: { outcome: "stuck", reason: "No meaningful progress for 18053ms (limit 18000ms)" },
    });
    expect(repeated?.count).toBe(3);
    expect(repeated?.runIds[0]).toBe(currentRunId);
    expect(repeated?.sameSourceHash).toBe(false);
    expect(repeated?.guidance).toContain("narrow probe");
  });

  test("a different failure step or an intervening success breaks the streak", async () => {
    await saveRun({ harnessName: "rf-f18", sourceHash: "a", outcome: "failure", reason: "F18 mismatch step 3" });
    await saveRun({ harnessName: "rf-f18", sourceHash: "a", outcome: "failure", reason: "F18 mismatch step 4" });
    await saveRun({ harnessName: "rf-f18", sourceHash: "a", outcome: "failure", reason: "F18 mismatch step 3" });
    const stepChanged = await findRepeatedFailure({
      playtestsDirectory: directory,
      currentRunId: nextRunId(),
      harnessName: "rf-f18",
      sourceHash: "a",
      result: { outcome: "failure", reason: "F18 mismatch step 3" },
    });
    expect(stepChanged).toBeUndefined();

    await saveRun({ harnessName: "rf-f18", sourceHash: "a", outcome: "failure", reason: "F18 mismatch step 3" });
    const unchanged = await findRepeatedFailure({
      playtestsDirectory: directory,
      currentRunId: nextRunId(),
      harnessName: "rf-f18",
      sourceHash: "a",
      result: { outcome: "failure", reason: "F18 mismatch step 3" },
    });
    expect(unchanged).toMatchObject({ count: 3, sameSourceHash: true });

    await saveRun({ harnessName: "rf-f18", sourceHash: "a", outcome: "success", reason: "carried" });
    const afterSuccess = await findRepeatedFailure({
      playtestsDirectory: directory,
      currentRunId: nextRunId(),
      harnessName: "rf-f18",
      sourceHash: "a",
      result: { outcome: "failure", reason: "F18 mismatch step 3" },
    });
    expect(afterSuccess).toBeUndefined();
  });

  test("successful outcomes never produce a failure signature", () => {
    expect(failureSignature({ outcome: "success", reason: "done" })).toBeUndefined();
    expect(failureSignature({ outcome: "cancelled", reason: "Playtest cancelled by caller" })).toBeUndefined();
  });
});
