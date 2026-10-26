// @summary Builds deterministic selected-run evidence reports without Studio calls or inferred acceptance.
import { createHash } from "node:crypto";
import { mkdir, open, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { summarizeChecks } from "./checks";

export const reportRunIdsSchema = z
  .array(
    z
      .string()
      .max(64)
      .regex(/^\d+-[0-9a-f]{8}$/),
  )
  .min(1)
  .max(50)
  .refine((ids) => new Set(ids).size === ids.length, "Select each run ID only once");
const count = z.number().int().nonnegative().safe();
const counts = z.object({ total: count, passed: count, failed: count, pending: count });
const checkStatus = z.enum(["pending", "pass", "fail"]);
const verificationSchema = z
  .object({
    status: z.enum(["not_declared", "passed", "failed", "incomplete"]),
    requirement: counts,
    auxiliary: counts,
    checks: z.array(
      z.object({
        id: z.string().min(1),
        basis: z.enum(["requirement", "auxiliary"]),
        description: z.string().optional(),
        status: checkStatus,
        everFailed: z.boolean(),
        detail: z.record(z.string(), z.unknown()).optional(),
        transitions: z.array(z.object({ status: checkStatus, atMs: z.number().finite(), revision: count })),
      }),
    ),
  })
  .superRefine((value, ctx) => {
    const expected = summarizeChecks(value.checks);
    const validCounts = (["requirement", "auxiliary"] as const).every((basis) =>
      (["total", "passed", "failed", "pending"] as const).every((key) => value[basis][key] === expected[basis][key]),
    );
    if (
      !validCounts ||
      value.status !== expected.status ||
      new Set(value.checks.map((check) => check.id)).size !== value.checks.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Saved verification counts/verdict/identities are inconsistent with their checks",
      });
    }
  });
const recordSchema = z.object({
  schemaVersion: z.literal(1).optional(),
  runId: z.string(),
  harnessName: z.string(),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  mode: z.enum(["autonomous", "verification"]),
  outcome: z.enum([
    "success",
    "failure",
    "timeout",
    "stuck",
    "cancelled",
    "input_cancelled",
    "session_changed",
    "error",
  ]),
  reason: z.string(),
  terminal: z.object({ outcome: z.enum(["success", "failure"]), reason: z.string().optional() }).optional(),
  verification: verificationSchema,
  decisionEvidence: z.object({
    status: z.enum([
      "not_applicable",
      "not_exercised",
      "selected_not_dispatched",
      "dispatched_unverified",
      "effects_observed",
    ]),
    modelRequests: count,
    modelChoices: count,
    modelDispatches: count,
    modelEffectsConfirmed: count,
    automaticDispatches: count,
    scenarioDispatches: count,
  }),
  stats: z.object({ elapsedMs: z.number().finite().nonnegative() }).passthrough(),
  cleanup: z.object({
    ownedSession: z.boolean(),
    sessionId: z.string().optional(),
    statusChecked: z.boolean(),
    stopAttempted: z.boolean(),
    stopped: z.boolean(),
    reason: z.string(),
  }),
  driver: z
    .object({
      guid: z.string(),
      originalEnabled: z.boolean(),
      temporarilyEnabled: z.boolean(),
      restoration: z.enum(["not_needed", "restored", "failed"]),
      error: z.string().optional(),
    })
    .optional(),
});

const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const MAX_SUMMARY_BYTES = 4 * 1024 * 1024;
const scopeNotes = [
  "Only the explicitly selected run IDs are included. This is not a complete project or session history.",
  "Game outcome, declared requirement checks and model-decision evidence are separate facts, not a product acceptance verdict.",
  "Harness source hashes identify adapter versions, not game-code/build versions. Full source records, actor evidence and diagnostics remain at summaryPath; raw events remain at tracePath.",
  "Visual/audio quality, unexecuted scenarios and global world preservation require their own evidence. A successful terminal or declared coverage does not establish them.",
  "Earlier selected failures and recovered checks are retained; a later passing run does not erase them.",
];
const markdownCell = (value: string) => value.replace(/[\r\n]/g, " ").replace(/[\\|`*_[\]<>]/g, "\\$&");

export async function createRunReport(cwd: string, name: string, selectedIds: string[], signal: AbortSignal) {
  const ids = reportRunIdsSchema.parse(selectedIds).sort();
  const root = join(cwd, ".overdare", "playtests");
  const runs: Array<
    z.infer<typeof recordSchema> & {
      summaryPath: string;
      summarySha256: string;
      tracePath: string;
      coveragePath: string;
    }
  > = [];
  for (const runId of ids) {
    signal.throwIfAborted();
    const directory = join(root, runId);
    const summaryPath = join(directory, "summary.json");
    // Read-only: the mode never applies, but static analysis treats a mode-less open as possible creation.
    const handle = await open(summaryPath, "r", 0o600);
    let bytes: Buffer;
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > MAX_SUMMARY_BYTES)
        throw new Error(`Run ${runId} summary exceeds the report size limit or is not a file`);
      bytes = await handle.readFile({ signal });
    } finally {
      await handle.close();
    }
    if (bytes.length > MAX_SUMMARY_BYTES) throw new Error(`Run ${runId} summary exceeds the report size limit`);
    const parsed = recordSchema.safeParse(JSON.parse(bytes.toString("utf8")));
    if (!parsed.success) throw new Error(`Run ${runId} has an invalid saved record: ${parsed.error.message}`);
    const record = parsed.data;
    if (record.runId !== runId || record.harnessName !== name)
      throw new Error(`Run ${runId} identity does not match the selected harness/run`);
    const tracePath = join(directory, "trace.jsonl");
    const coveragePath = join(directory, "coverage.json");
    for (const path of [tracePath, coveragePath]) {
      if (!(await stat(path)).isFile()) throw new Error(`Run evidence is not a file: ${path}`);
    }
    runs.push({ summaryPath, summarySha256: sha256(bytes), tracePath, coveragePath, ...record });
  }
  const report = {
    schemaVersion: 1,
    scope: "selected_runs",
    acceptance: "not_assessed",
    harnessName: name,
    selectedRunIds: ids,
    harnessSourceHashes: [...new Set(runs.map((run) => run.sourceHash))].sort(),
    scopeNotes,
    runs,
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const reportId = sha256(json).slice(0, 24);
  const directory = join(root, "reports");
  const jsonPath = join(directory, `${reportId}.json`);
  const markdownPath = join(directory, `${reportId}.md`);
  const lines = [
    `# Playtest evidence: ${name}`,
    "",
    ...scopeNotes.map((note) => `- ${note}`),
    "",
    "| Run | Mode | Game outcome | Requirement verdict | Model-decision evidence | Owned PIE stopped | Driver restoration |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...runs.map(
      (run) =>
        `| ${run.runId} | ${run.mode} | ${run.outcome} | ${run.verification.status} | ${run.decisionEvidence.status} | ${run.cleanup.stopped} | ${run.driver?.restoration ?? "not recorded"} |`,
    ),
  ];
  for (const run of runs) {
    lines.push(
      "",
      `## ${run.runId}`,
      "",
      `- Harness source SHA-256: ${run.sourceHash}`,
      `- Summary SHA-256: ${run.summarySha256}`,
      `- Summary: ${markdownCell(run.summaryPath)}`,
      `- Trace: ${markdownCell(run.tracePath)}`,
      `- Coverage: ${markdownCell(run.coveragePath)}`,
      `- Runtime reason: ${markdownCell(run.reason)}`,
      `- Cleanup: ${markdownCell(run.cleanup.reason)}`,
      ...(run.driver?.error ? [`- Driver restoration error: ${markdownCell(run.driver.error)}`] : []),
      "",
      "| Check | Basis | Final status | Ever failed | Description |",
      "| --- | --- | --- | --- | --- |",
      ...run.verification.checks.map(
        (check) =>
          `| ${markdownCell(check.id)} | ${check.basis} | ${check.status} | ${check.everFailed} | ${markdownCell(check.description ?? "")} |`,
      ),
    );
  }
  signal.throwIfAborted();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await Promise.all([
    writeFile(jsonPath, json, { encoding: "utf8", mode: 0o600, signal }),
    writeFile(markdownPath, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600, signal }),
  ]);
  return {
    jsonPath,
    markdownPath,
    reportId,
    scope: report.scope,
    acceptance: report.acceptance,
    harnessName: name,
    selectedRunIds: ids,
    harnessSourceHashes: report.harnessSourceHashes,
    runCount: runs.length,
    requirementVerdicts: Object.fromEntries(
      ["not_declared", "passed", "failed", "incomplete"].map((status) => [
        status,
        runs.filter((run) => run.verification.status === status).length,
      ]),
    ),
  };
}
