// @summary Reports retain selected failures, version differences and gaps instead of manufacturing acceptance.
import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHarnessTool } from "../../../../../src/tools/studiorpc/tools/playtest/harness-tool";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const ids = ["1700000000000-aaaaaaaa", "1700000000001-bbbbbbbb"];
function record(runId: string, failed: boolean) {
  return {
    runId,
    harnessName: "sample",
    sourceHash: (failed ? "a" : "b").repeat(64),
    mode: "verification",
    outcome: "success",
    reason: "Game terminal was observed",
    terminal: { outcome: "success" },
    verification: {
      status: failed ? "failed" : "passed",
      requirement: { total: 1, passed: failed ? 0 : 1, failed: failed ? 1 : 0, pending: 0 },
      auxiliary: { total: 0, passed: 0, failed: 0, pending: 0 },
      checks: [
        {
          id: "endpoint",
          basis: "requirement",
          status: failed ? "fail" : "pass",
          everFailed: failed,
          detail: { actualEndpoint: failed ? "wrong" : "requested" },
          transitions: [],
        },
      ],
    },
    decisionEvidence: {
      status: "not_applicable",
      modelRequests: 0,
      modelChoices: 0,
      modelDispatches: 0,
      modelEffectsConfirmed: 0,
      automaticDispatches: 0,
      scenarioDispatches: 1,
    },
    stats: { elapsedMs: 1000 },
    cleanup: {
      ownedSession: true,
      statusChecked: true,
      stopAttempted: true,
      stopped: true,
      reason: "Stopped owned session",
    },
  };
}
async function setup() {
  const cwd = await mkdtemp(join(tmpdir(), "playtest-report-"));
  roots.push(cwd);
  for (const [index, runId] of ids.entries()) {
    const directory = join(cwd, ".overdare", "playtests", runId);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "summary.json"), JSON.stringify(record(runId, index === 0)));
    await writeFile(join(directory, "trace.jsonl"), '{"type":"cleanup"}\n');
    await writeFile(join(directory, "coverage.json"), "{}");
  }
  const tool = createHarnessTool({
    cwd,
    callRpc: async () => {
      throw Error("Reports must not call Studio");
    },
  });
  const run = (runIds = ids) =>
    tool.execute(
      { operation: "report", name: "sample", runIds },
      {
        toolCallId: "report",
        signal: new AbortController().signal,
        abort() {},
        approve: async () => "once",
      },
    );
  return { cwd, run };
}

test("selected run reports preserve failures separately from terminal success, versions and acceptance", async () => {
  const { run } = await setup();
  const first = JSON.parse((await run()).output);
  const report = JSON.parse(await readFile(first.jsonPath, "utf8"));
  expect(report.scope).toBe("selected_runs");
  expect(report.acceptance).toBe("not_assessed");
  expect(report.selectedRunIds).toEqual(ids);
  expect(report.harnessSourceHashes).toEqual(["a".repeat(64), "b".repeat(64)]);
  expect(report.runs.map((row: { outcome: string }) => row.outcome)).toEqual(["success", "success"]);
  expect(report.runs.map((row: { verification: { status: string } }) => row.verification.status)).toEqual([
    "failed",
    "passed",
  ]);
  expect(report.runs[0].verification.checks[0].detail.actualEndpoint).toBe("wrong");
  expect(report.runs[0].decisionEvidence.status).toBe("not_applicable");
  expect(report.runs[0].summarySha256).toMatch(/^[a-f0-9]{64}$/);
  const markdown = await readFile(first.markdownPath, "utf8");
  expect(markdown).toContain(ids[0]);
  expect(markdown).toContain(ids[1]);
  const second = JSON.parse((await run([...ids].reverse())).output);
  expect(second.jsonPath).toBe(first.jsonPath);
  expect(await readFile(second.markdownPath, "utf8")).toBe(markdown);
});

test.each(["../outside", "/tmp/private", `${ids[0]}/../../secret`])("rejects unsafe run IDs: %s", async (id) => {
  const { cwd, run } = await setup();
  await expect(run([id])).rejects.toThrow();
  expect(existsSync(join(cwd, ".overdare", "playtests", "reports"))).toBe(false);
});

test("missing, duplicate, mismatched and inconsistent records never publish a partial report", async () => {
  const { cwd, run } = await setup();
  await expect(run([ids[0], ids[0]])).rejects.toThrow();
  await expect(run([ids[0], "1700000000099-cccccccc"])).rejects.toThrow();
  const path = join(cwd, ".overdare", "playtests", ids[1], "summary.json");
  await writeFile(path, JSON.stringify({ ...record(ids[1], false), runId: ids[0] }));
  await expect(run()).rejects.toThrow(/identity/);
  const inconsistent = record(ids[1], true);
  inconsistent.verification.status = "passed";
  await writeFile(path, JSON.stringify(inconsistent));
  await expect(run()).rejects.toThrow(/verification/);
  expect(existsSync(join(cwd, ".overdare", "playtests", "reports"))).toBe(false);
});

test("missing trace evidence is reported rather than silently omitted", async () => {
  const { cwd, run } = await setup();
  await rm(join(cwd, ".overdare", "playtests", ids[0], "trace.jsonl"));
  await expect(run()).rejects.toThrow(/trace/);
  expect(existsSync(join(cwd, ".overdare", "playtests", "reports"))).toBe(false);
});

test("a recovered check and failed driver restoration remain visible beside the final passing verdict", async () => {
  const { cwd, run } = await setup();
  const recovered = record(ids[1], false);
  recovered.verification.checks[0].everFailed = true;
  await writeFile(
    join(cwd, ".overdare", "playtests", ids[1], "summary.json"),
    JSON.stringify({
      ...recovered,
      driver: {
        guid: "driver",
        originalEnabled: false,
        temporarilyEnabled: true,
        restoration: "failed",
        error: "External PIE",
      },
    }),
  );
  const result = JSON.parse((await run([ids[1]])).output);
  const report = JSON.parse(await readFile(result.jsonPath, "utf8"));
  expect(report.acceptance).toBe("not_assessed");
  expect(report.runs[0].verification.status).toBe("passed");
  expect(report.runs[0].verification.checks[0]).toMatchObject({ status: "pass", everFailed: true });
  expect(report.runs[0].driver).toMatchObject({ restoration: "failed", error: "External PIE" });
});
