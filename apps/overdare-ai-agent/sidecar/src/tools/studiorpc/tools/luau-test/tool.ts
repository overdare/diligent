// @summary Defines studiorpc_luau_test: frktest framework setup, test module maintenance and owned PIE test runs.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { call } from "../../rpc";
import type { Tool, ToolContext, ToolResult } from "../../types";
import type { WriteLock } from "../../write-lock";
import {
  ensureFrameworkCode,
  FRAMEWORK_FOLDER,
  installTestCode,
  removeFrameworkCode,
  removeTestCode,
  runnerStateCode,
  sourceHash,
  TEST_CONTEXTS,
  TEST_CONTRACT,
  TESTS_FOLDER,
  TESTS_SERVICE,
  type TestContext,
  updateTestCode,
} from "./framework";
import { type ContextReport, type OwnedSessionResult, runOwnedTestSession } from "./session";

export const LUAU_TEST_TOOL_NAME = "studiorpc_luau_test";
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_INLINE_FAILURES = 20;

type Rpc = typeof call;

export interface LuauTestToolOptions {
  callRpc: Rpc;
  cwd: string;
  writeLock?: WriteLock;
  /** Captures the request's rollback baseline; returns a warning when capture was skipped. */
  beforeMutation?: (ctx: ToolContext) => Promise<string | undefined>;
  /** Test seam for the PIE report poll interval. */
  pollIntervalMs?: number;
}

const nameSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,47}$/, "Use a short lowercase test module name");
const sourceSchema = z
  .string()
  .min(1)
  .refine(
    (source) => !source.includes("\0") && Buffer.byteLength(source, "utf8") <= 128 * 1024,
    "Luau source must be at most 128 KiB without NUL",
  );
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const luauTestParams = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("describe") }).strict(),
  z.object({ operation: z.literal("setup") }).strict(),
  z.object({ operation: z.literal("uninstall") }).strict(),
  z.object({ operation: z.literal("list") }).strict(),
  z.object({ operation: z.literal("read"), name: nameSchema }).strict(),
  z
    .object({
      operation: z.literal("install"),
      name: nameSchema,
      context: z
        .enum(["server", "client"])
        .describe("server: ServerStorage test run by a Script; client: ReplicatedStorage test run by a LocalScript."),
      source: sourceSchema,
    })
    .strict(),
  z
    .object({ operation: z.literal("update"), name: nameSchema, source: sourceSchema, expectedSourceHash: hashSchema })
    .strict(),
  z.object({ operation: z.literal("remove"), name: nameSchema, expectedSourceHash: hashSchema }).strict(),
  z
    .object({
      operation: z.literal("run"),
      names: z.array(nameSchema).min(1).max(64).optional().describe("Test modules to run; omit to run every test."),
      timeoutMs: z
        .number()
        .int()
        .min(5_000)
        .max(180_000)
        .optional()
        .describe(`Wait for runner reports after PIE starts; default ${DEFAULT_TIMEOUT_MS} ms.`),
    })
    .strict(),
]);

interface BrowseNode {
  Name?: string;
  ActorGuid?: string;
  InstanceType?: string;
  LuaChildren?: BrowseNode[];
}

export interface InstalledTest {
  name: string;
  context: TestContext;
  guid: string;
}

export async function listTests(rpc: Rpc): Promise<{ frameworkInstalled: boolean; tests: InstalledTest[] }> {
  const tree = (await rpc("level.browse", {})) as { level?: BrowseNode[] } | BrowseNode[];
  const roots = Array.isArray(tree) ? tree : (tree.level ?? []);
  const service = (name: string) => roots.find((node) => node.Name === name);
  const tests: InstalledTest[] = [];
  for (const context of TEST_CONTEXTS) {
    const folder = service(TESTS_SERVICE[context])?.LuaChildren?.find((node) => node.Name === TESTS_FOLDER);
    for (const child of folder?.LuaChildren ?? []) {
      if (child.InstanceType !== "ModuleScript" || !child.Name || !child.ActorGuid) continue;
      tests.push({ name: child.Name, context, guid: child.ActorGuid });
    }
  }
  const frameworkInstalled = Boolean(
    service("ReplicatedStorage")?.LuaChildren?.some((node) => node.Name === FRAMEWORK_FOLDER),
  );
  return { frameworkInstalled, tests: tests.sort((a, b) => a.name.localeCompare(b.name)) };
}

async function readTest(rpc: Rpc, name: string) {
  const { tests } = await listTests(rpc);
  const matches = tests.filter((test) => test.name === name);
  if (matches.length > 1) throw new Error(`Test ${name} exists in both server and client folders; remove one`);
  const test = matches[0];
  if (!test) return undefined;
  const reply = (await rpc("instance.read", { ActorGuid: test.guid, Depth: 0 })) as {
    instance?: { Source?: unknown; Name?: unknown };
  };
  const source = reply.instance?.Source;
  if (typeof source !== "string" || reply.instance?.Name !== name)
    throw new Error("Test source readback did not match its module");
  return { ...test, source, sourceHash: sourceHash(source) };
}

async function validate(rpc: Rpc, guids: string[]): Promise<{ output: string; valid: boolean }> {
  const reply = await rpc("lua.validate", { mode: "strict", targetGuids: guids }, { timeoutMs: 120_000 });
  const output =
    typeof reply === "string"
      ? reply
      : reply && typeof reply === "object" && "output" in reply && typeof reply.output === "string"
        ? reply.output
        : JSON.stringify(reply);
  const match = /SUMMARY\s+scripts=\d+\s+errors=(\d+)/.exec(output);
  return { output, valid: Boolean(match && Number(match[1]) === 0) };
}

function errorResult(output: string, metadata: Record<string, unknown> = {}): ToolResult {
  return { output, metadata: { ...metadata, error: true } };
}

/** Injects or refreshes the managed framework and saves only when something changed. */
export async function ensureFramework(rpc: Rpc): Promise<{ changed: boolean }> {
  const reply = (await rpc(
    "execute.luau",
    { target: "Editor", code: ensureFrameworkCode() },
    { timeoutMs: 30_000 },
  )) as {
    changed?: unknown;
  };
  const changed = reply?.changed === true;
  if (changed) await rpc("level.save.file", {}, { timeoutMs: 15_000 });
  return { changed };
}

export async function removeFramework(rpc: Rpc): Promise<{ removed: number }> {
  const reply = (await rpc(
    "execute.luau",
    { target: "Editor", code: removeFrameworkCode() },
    { timeoutMs: 30_000 },
  )) as {
    removed?: unknown;
  };
  const removed = typeof reply?.removed === "number" ? reply.removed : 0;
  if (removed > 0) await rpc("level.save.file", {}, { timeoutMs: 15_000 });
  return { removed };
}

type RunOutcome = "passed" | "failed" | "error" | "timeout";

export function summarizeRun(runId: string, requested: Record<TestContext, string[]>, session: OwnedSessionResult) {
  const contexts = TEST_CONTEXTS.filter((context) => requested[context].length > 0);
  const counts = { ran: 0, passed: 0, failed: 0, skipped: 0 };
  const failures: Array<Record<string, unknown>> = [];
  const loadErrors: Array<Record<string, unknown>> = [];
  const runErrors: string[] = [];
  const missingModules: string[] = [];
  for (const context of contexts) {
    const report: ContextReport | undefined = session.reports[context];
    if (!report) continue;
    for (const key of Object.keys(counts) as Array<keyof typeof counts>) counts[key] += report.counts?.[key] ?? 0;
    for (const result of report.results ?? []) {
      if (result.status === "fail")
        failures.push({ context, suite: result.suite, name: result.name, failures: result.failures });
    }
    for (const error of report.loadErrors ?? []) loadErrors.push({ context, ...error });
    if (report.runError) runErrors.push(`${context}: ${report.runError}`);
    for (const name of requested[context]) if (!report.modules?.includes(name)) missingModules.push(name);
  }
  const missingReports = contexts.filter((context) => !session.reports[context]);
  const outcome: RunOutcome =
    session.error || runErrors.length > 0
      ? "error"
      : missingReports.length > 0
        ? session.timedOut
          ? "timeout"
          : "error"
        : counts.failed > 0 || loadErrors.length > 0 || missingModules.length > 0
          ? "failed"
          : "passed";
  return {
    runId,
    outcome,
    counts,
    ...(missingReports.length > 0 ? { missingReports } : {}),
    ...(missingModules.length > 0 ? { missingModules } : {}),
    ...(session.error ? { error: session.error } : {}),
    ...(runErrors.length > 0 ? { runErrors } : {}),
    loadErrors,
    failures: failures.slice(0, MAX_INLINE_FAILURES),
    ...(failures.length > MAX_INLINE_FAILURES ? { omittedFailures: failures.length - MAX_INLINE_FAILURES } : {}),
    cleanup: session.cleanup,
  };
}

async function runTests(
  options: LuauTestToolOptions,
  ctx: ToolContext,
  rpc: Rpc,
  names: string[] | undefined,
  timeoutMs: number,
): Promise<ToolResult> {
  const { tests } = await listTests(rpc);
  const unknown = (names ?? []).filter((name) => !tests.some((test) => test.name === name));
  if (unknown.length > 0)
    return errorResult(`Unknown test module(s): ${unknown.join(", ")}. Use list to see installed tests.`, { unknown });
  const selected = names ? tests.filter((test) => names.includes(test.name)) : tests;
  if (selected.length === 0) return errorResult("No Luau tests are installed; install a test module first.");
  const checked = await validate(
    rpc,
    selected.map((test) => test.guid),
  );
  if (!checked.valid)
    return errorResult(`Test validation failed; fix the modules before running.\n${checked.output}`, { valid: false });

  const requested: Record<TestContext, string[]> = { server: [], client: [] };
  for (const test of selected) requested[test.context].push(test.name);
  const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const restoreRpc: Rpc = (method, args, callOptions) =>
    options.callRpc(method, args, { ...callOptions, signal: AbortSignal.timeout(10_000) });
  let restoreError: string | undefined;
  let session: OwnedSessionResult;
  await rpc(
    "execute.luau",
    { target: "Editor", code: runnerStateCode({ runId, tests: requested }) },
    { timeoutMs: 15_000 },
  );
  try {
    ctx.onUpdate?.(`Running ${selected.length} Luau test module(s) in a fresh PIE session...`);
    session = await runOwnedTestSession({
      callRpc: options.callRpc,
      runId,
      contexts: TEST_CONTEXTS.filter((context) => requested[context].length > 0),
      timeoutMs,
      signal: ctx.signal,
      pollIntervalMs: options.pollIntervalMs,
    });
  } finally {
    // Disable runners and clear the request even after failure or cancellation so the Editor world is unchanged.
    try {
      await restoreRpc("execute.luau", { target: "Editor", code: runnerStateCode(undefined) }, { timeoutMs: 10_000 });
    } catch (error) {
      restoreError = error instanceof Error ? error.message : String(error);
    }
  }
  const summary = summarizeRun(runId, requested, session);
  const directory = join(options.cwd, ".overdare", "luau-tests");
  await mkdir(directory, { recursive: true });
  const reportPath = join(directory, `${runId}.json`);
  await writeFile(reportPath, JSON.stringify({ ...summary, requested, reports: session.reports }, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  const output = { ...summary, reportPath, ...(restoreError ? { restoreError } : {}) };
  return {
    output: JSON.stringify(output, null, 2),
    metadata: { ...output, ...(summary.outcome === "error" || restoreError ? { error: true } : {}) },
  };
}

const description = `Write and run Luau unit/integration tests inside Studio with the vendored frktest library. describe returns the test API and layout. setup injects or refreshes the managed framework (also done automatically by install/update/run); uninstall removes the framework and runners but keeps test modules. list/read inspect test modules; install creates a server (ServerStorage) or client (ReplicatedStorage) test ModuleScript; update/remove require the current sourceHash. run validates the selected tests in strict mode, starts a fresh owned PIE session, runs server tests in a Script and client tests in a LocalScript, collects results and stops the same session. Use it for module logic and authoritative state checks; use studiorpc_game_playtest for real input gameplay. Edits save the project and are refused during PIE. Never change gameplay code to make a test pass.`;

export function createLuauTestTool(options: LuauTestToolOptions): Tool {
  return {
    name: LUAU_TEST_TOOL_NAME,
    description,
    parameters: luauTestParams,
    async execute(args, ctx) {
      const parsed = luauTestParams.parse(args);
      if (parsed.operation === "describe") return { output: TEST_CONTRACT, metadata: { frameworkVersion: 1 } };
      const rpc: Rpc = (method, params, callOptions) =>
        options.callRpc(method, params, { ...callOptions, signal: ctx.signal });
      if (parsed.operation === "list") {
        const listed = await listTests(rpc);
        return { output: JSON.stringify(listed, null, 2), metadata: listed };
      }
      if (parsed.operation === "read") {
        const test = await readTest(rpc, parsed.name);
        const result = test ? { found: true, ...test } : { found: false, name: parsed.name };
        return { output: JSON.stringify(result, null, 2), metadata: result };
      }

      const status = (await rpc("game.pie.status", {}, { timeoutMs: 5_000 })) as { running?: unknown };
      if (status?.running === true) return errorResult("Stop PIE before changing or running Luau tests.");
      const existing = "name" in parsed ? await readTest(rpc, parsed.name) : undefined;
      if (parsed.operation === "install" && existing)
        return errorResult("Test already exists; read it and update using its sourceHash.");
      if (
        (parsed.operation === "update" || parsed.operation === "remove") &&
        existing?.sourceHash !== parsed.expectedSourceHash
      )
        return errorResult("Test source hash changed or the test is missing; read the current source first.");

      const label =
        parsed.operation === "run"
          ? `Run Luau tests in a fresh PIE session (${parsed.names?.join(", ") ?? "all tests"}), then stop it`
          : parsed.operation === "setup" || parsed.operation === "uninstall"
            ? `${parsed.operation} the managed Luau test framework and save the project`
            : `${parsed.operation} Luau test ${parsed.name} and save the project`;
      const approval = await ctx.approve({
        permission: "execute",
        toolName: LUAU_TEST_TOOL_NAME,
        description: label,
        details: { operation: parsed.operation, ...("name" in parsed ? { name: parsed.name } : {}) },
      });
      if (approval === "reject") return { output: "[Rejected by user]", metadata: { error: true } };

      // Snapshot capture takes the same write lock, so it must finish before the lock is held.
      const warning = await options.beforeMutation?.(ctx);
      ctx.signal.throwIfAborted();
      const release = await options.writeLock?.acquire();
      try {
        const prefix = warning ? `${warning}\n` : "";
        if (parsed.operation === "uninstall") {
          const result = await removeFramework(rpc);
          return { output: `${prefix}${JSON.stringify(result)}`, metadata: result };
        }
        const framework = await ensureFramework(rpc);
        if (parsed.operation === "setup")
          return { output: `${prefix}${JSON.stringify(framework)}`, metadata: framework };
        if (parsed.operation === "run") {
          const result = await runTests(options, ctx, rpc, parsed.names, parsed.timeoutMs ?? DEFAULT_TIMEOUT_MS);
          return { ...result, output: `${prefix}${result.output}` };
        }

        const code =
          parsed.operation === "install"
            ? installTestCode(parsed.name, parsed.context, parsed.source)
            : parsed.operation === "update"
              ? updateTestCode(parsed.name, existing!.context, existing!.source, parsed.source)
              : removeTestCode(parsed.name, existing!.context, existing!.source);
        await rpc("execute.luau", { target: "Editor", code }, { timeoutMs: 15_000 });
        try {
          await rpc("level.save.file", {}, { timeoutMs: 15_000 });
        } catch (error) {
          return errorResult(
            `${prefix}Test edit succeeded but saving failed. Inspect/save the existing edit; do not replay it. ${String(error)}`,
          );
        }
        if (parsed.operation === "remove") {
          const removed = { removed: true, name: parsed.name };
          return { output: `${prefix}${JSON.stringify(removed)}`, metadata: removed };
        }
        const installed = await readTest(rpc, parsed.name);
        if (!installed || installed.sourceHash !== sourceHash(parsed.source))
          return errorResult(`${prefix}Test edit succeeded but source readback did not match; inspect the module.`);
        const checked = await validate(rpc, [installed.guid]);
        const result = {
          name: installed.name,
          context: installed.context,
          guid: installed.guid,
          sourceHash: installed.sourceHash,
          valid: checked.valid,
        };
        return {
          output: `${prefix}${JSON.stringify(result, null, 2)}\n\n${checked.output}`,
          metadata: { ...result, ...(checked.valid ? {} : { error: true }) },
        };
      } finally {
        release?.();
      }
    },
  };
}
