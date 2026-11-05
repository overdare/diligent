// @summary Tests the Luau test tool's owned PIE run lifecycle, result verdicts and framework toggle effects.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyLuauTestFrameworkToggle, createLuauTestTool } from "../../../../../src/tools/studiorpc/tools/luau-test";
import { sourceHash } from "../../../../../src/tools/studiorpc/tools/luau-test/framework";
import { reportFromObservation, runOwnedTestSession } from "../../../../../src/tools/studiorpc/tools/luau-test/session";
import { summarizeRun } from "../../../../../src/tools/studiorpc/tools/luau-test/tool";
import { createWriteLock } from "../../../../../src/tools/studiorpc/write-lock";

const context = {
  toolCallId: "call",
  signal: new AbortController().signal,
  abort() {},
  approve: async () => "once" as const,
};

const tree = {
  level: [
    {
      Name: "ServerStorage",
      ActorGuid: "ss",
      LuaChildren: [
        {
          Name: "DiligentTests",
          ActorGuid: "server-tests",
          InstanceType: "Folder",
          LuaChildren: [{ Name: "math_spec", ActorGuid: "math", InstanceType: "ModuleScript" }],
        },
      ],
    },
    {
      Name: "ReplicatedStorage",
      ActorGuid: "rs",
      LuaChildren: [
        { Name: "DiligentTestFramework", ActorGuid: "framework", InstanceType: "Folder" },
        {
          Name: "DiligentTests",
          ActorGuid: "client-tests",
          InstanceType: "Folder",
          LuaChildren: [{ Name: "client_spec", ActorGuid: "client", InstanceType: "ModuleScript" }],
        },
      ],
    },
  ],
};

const observedResult = (name: string, report: Record<string, unknown>) => ({
  instances: {
    status: "ok",
    data: { instances: [{ name, Value: { Type: "String", String: JSON.stringify(report) } }] },
  },
  outcome: "ok",
});

/** Minimal Studio: one owned PIE session whose runners publish reports for the armed run id. */
function fakeStudio(options: {
  validation?: string;
  playFails?: boolean;
  serverReport?: (runId: string) => Record<string, unknown>;
  clientReport?: (runId: string) => Record<string, unknown>;
  sources?: Record<string, string>;
}) {
  const calls: Array<{ method: string; params: unknown }> = [];
  let running = false;
  let runId = "";
  const callRpc = (async (method: string, params: unknown) => {
    calls.push({ method, params });
    const code = (params as { code?: string })?.code ?? "";
    switch (method) {
      case "game.pie.status":
        return running
          ? { running: true, pieSessionId: "owned", clients: [{ clientId: "c1", injectable: true }] }
          : { running: false, clients: [] };
      case "level.browse":
        return tree;
      case "instance.read": {
        const guid = (params as { ActorGuid: string }).ActorGuid;
        const name = guid === "math" ? "math_spec" : "client_spec";
        return { instance: { Name: name, Source: options.sources?.[name] ?? "return function(t) end" } };
      }
      case "execute.luau": {
        const armed = /\\"runId\\":\\"([^"\\]+)\\"/.exec(code);
        if (armed) runId = armed[1]!;
        if (code.includes("local changed=false")) return { changed: false };
        return { ok: true };
      }
      case "lua.validate":
        return { output: options.validation ?? "LUA_VALIDATE v1\nSUMMARY scripts=2 errors=0 warnings=0" };
      case "game.play":
        if (options.playFails) throw new Error("Studio refused to start PIE");
        running = true;
        return { success: true };
      case "game.observe": {
        const world = (params as { instances: { world: string } }).instances.world;
        return world === "authority"
          ? observedResult("DiligentTestResult_server", options.serverReport?.(runId) ?? {})
          : observedResult("DiligentTestResult_client", options.clientReport?.(runId) ?? {});
      }
      case "game.stop":
        running = false;
        return { success: true };
      case "level.save.file":
        return {};
      default:
        throw new Error(`Unexpected Studio call ${method}`);
    }
  }) as never;
  return { callRpc, calls };
}

const passed = (contextName: string, module: string) => (runId: string) => ({
  context: contextName,
  runId,
  done: true,
  modules: [module],
  counts: { ran: 1, passed: 1, failed: 0, skipped: 0 },
  results: [{ suite: module, name: "works", status: "pass", failures: [] }],
  loadErrors: [],
});

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function tempCwd() {
  const dir = await mkdtemp(join(tmpdir(), "luau-test-"));
  tempDirs.push(dir);
  return dir;
}

function parse(output: string | undefined) {
  return JSON.parse(output ?? "{}") as Record<string, unknown>;
}

describe("studiorpc_luau_test run", () => {
  test("arms runners, collects both contexts from one owned session, then stops it and restores the editor", async () => {
    const studio = fakeStudio({
      serverReport: (runId) => ({
        ...passed("server", "math_spec")(runId),
        counts: { ran: 2, passed: 1, failed: 1, skipped: 0 },
        results: [
          { suite: "math_spec > math", name: "adds", status: "pass", failures: [] },
          {
            suite: "math_spec > math",
            name: "fails",
            status: "fail",
            failures: [{ kind: "check", message: "2 == 3" }],
          },
        ],
      }),
      clientReport: passed("client", "client_spec"),
    });
    const cwd = await tempCwd();
    const tool = createLuauTestTool({ callRpc: studio.callRpc, cwd, writeLock: createWriteLock(), pollIntervalMs: 0 });

    const result = await tool.execute({ operation: "run" } as never, context);
    const output = parse(result.output);

    expect(output.outcome).toBe("failed");
    expect(output.counts).toEqual({ ran: 3, passed: 2, failed: 1, skipped: 0 });
    expect(output.failures).toEqual([
      {
        context: "server",
        suite: "math_spec > math",
        name: "fails",
        failures: [{ kind: "check", message: "2 == 3" }],
      },
    ]);
    expect(output.cleanup).toMatchObject({ stopped: true, pieSessionId: "owned" });
    const methods = studio.calls.map((call) => call.method);
    const play = methods.indexOf("game.play");
    const stop = methods.indexOf("game.stop");
    const executes = studio.calls.flatMap((call, index) => (call.method === "execute.luau" ? [index] : []));
    expect(executes.some((index) => index < play)).toBe(true);
    // The last editor command runs after the owned session stopped and clears the request.
    const restore = executes.at(-1)!;
    expect(restore).toBeGreaterThan(stop);
    expect((studio.calls[restore]!.params as { code: string }).code).toContain('request.Value=""');
    const report = await stat(output.reportPath as string);
    expect(report.mode & 0o777).toBe(0o600);
  });

  test("restores the runners when PIE cannot start and reports the run as an error", async () => {
    const studio = fakeStudio({ playFails: true });
    const tool = createLuauTestTool({ callRpc: studio.callRpc, cwd: await tempCwd(), pollIntervalMs: 0 });

    const result = await tool.execute({ operation: "run", names: ["math_spec"] } as never, context);

    expect(result.metadata?.error).toBe(true);
    expect(parse(result.output)).toMatchObject({ outcome: "error", error: "Studio refused to start PIE" });
    const last = studio.calls.filter((call) => call.method === "execute.luau").at(-1);
    expect((last!.params as { code: string }).code).toContain('request.Value=""');
    expect(studio.calls.some((call) => call.method === "game.stop")).toBe(false);
  });

  test("reports a timeout when a selected context never publishes its report, and still stops the session", async () => {
    const studio = fakeStudio({ serverReport: passed("server", "math_spec") });
    const runId = "run-timeout";
    const session = await runOwnedTestSession({
      callRpc: studio.callRpc,
      runId,
      contexts: ["server", "client"],
      timeoutMs: 0,
      signal: new AbortController().signal,
      pollIntervalMs: 0,
    });

    expect(summarizeRun(runId, { server: ["math_spec"], client: ["client_spec"] }, session)).toMatchObject({
      outcome: "timeout",
      missingReports: ["server", "client"],
    });
    expect(session.cleanup.stopped).toBe(true);
  });

  test("a module that never loaded fails the run even when every executed case passed", async () => {
    const studio = fakeStudio({
      serverReport: (runId) => ({
        ...passed("server", "math_spec")(runId),
        loadErrors: [{ module: "math_spec", message: "test module must return function(t)" }],
      }),
    });
    const tool = createLuauTestTool({ callRpc: studio.callRpc, cwd: await tempCwd(), pollIntervalMs: 0 });

    const output = parse((await tool.execute({ operation: "run", names: ["math_spec"] } as never, context)).output);

    expect(output.outcome).toBe("failed");
    expect(output.loadErrors).toEqual([
      { context: "server", module: "math_spec", message: "test module must return function(t)" },
    ]);
  });

  test("strict validation errors block PIE and come back as an error result", async () => {
    const studio = fakeStudio({
      validation: "E type 3:1-3:30 1000 Type 'number'\nSUMMARY scripts=1 errors=1 warnings=0",
    });
    const tool = createLuauTestTool({ callRpc: studio.callRpc, cwd: await tempCwd(), pollIntervalMs: 0 });

    const result = await tool.execute({ operation: "run", names: ["math_spec"] } as never, context);

    expect(result.metadata?.error).toBe(true);
    expect(result.output).toContain("1000 Type 'number'");
    expect(studio.calls.some((call) => call.method === "game.play")).toBe(false);
  });

  test("unknown test names are rejected before any editor change", async () => {
    const studio = fakeStudio({});
    const tool = createLuauTestTool({ callRpc: studio.callRpc, cwd: await tempCwd(), pollIntervalMs: 0 });

    const result = await tool.execute({ operation: "run", names: ["missing_spec"] } as never, context);

    expect(result.metadata?.error).toBe(true);
    expect(studio.calls.some((call) => call.method === "game.play")).toBe(false);
  });
});

describe("studiorpc_luau_test maintenance", () => {
  test("update with a stale source hash changes nothing", async () => {
    const studio = fakeStudio({ sources: { math_spec: "return function(t) end" } });
    const tool = createLuauTestTool({ callRpc: studio.callRpc, cwd: await tempCwd() });

    const result = await tool.execute(
      {
        operation: "update",
        name: "math_spec",
        source: "return function(t) end -- new",
        expectedSourceHash: "0".repeat(64),
      } as never,
      context,
    );

    expect(result.metadata?.error).toBe(true);
    expect(studio.calls.some((call) => call.method === "execute.luau")).toBe(false);
  });

  test("read returns the current source hash used by update", async () => {
    const source = "return function(t) t.test.case('x', function() end) end";
    const studio = fakeStudio({ sources: { client_spec: source } });
    const tool = createLuauTestTool({ callRpc: studio.callRpc, cwd: await tempCwd() });

    const output = parse((await tool.execute({ operation: "read", name: "client_spec" } as never, context)).output);

    expect(output).toMatchObject({ found: true, context: "client", sourceHash: sourceHash(source) });
  });
});

describe("runner report parsing", () => {
  test("ignores reports from another run or a runner that has not finished", () => {
    const report = { runId: "run-2", done: true, counts: { ran: 1, passed: 1, failed: 0, skipped: 0 } };
    const observation = observedResult("DiligentTestResult_server", report);
    expect(reportFromObservation(observation, "server", "run-1")).toBeUndefined();
    expect(
      reportFromObservation(
        observedResult("DiligentTestResult_server", { runId: "run-1", done: false }),
        "server",
        "run-1",
      ),
    ).toBeUndefined();
    expect(reportFromObservation(observation, "server", "run-2")).toMatchObject({ context: "server", runId: "run-2" });
  });
});

describe("Studio testing toggle side effect", () => {
  test("defers while PIE is running and never edits the level", async () => {
    const calls: string[] = [];
    const callRpc = (async (method: string) => {
      calls.push(method);
      return method === "game.pie.status" ? { running: true } : {};
    }) as never;
    await expect(applyLuauTestFrameworkToggle(callRpc, true)).rejects.toThrow("PIE is running");
    expect(calls).toEqual(["game.pie.status"]);
  });

  test("ON injects and saves only when the framework changed; OFF removes the framework, not tests", async () => {
    const codes: string[] = [];
    const saves: number[] = [];
    let changed = true;
    const callRpc = (async (method: string, params: { code?: string }) => {
      if (method === "game.pie.status") return { running: false };
      if (method === "level.save.file") {
        saves.push(codes.length);
        return {};
      }
      codes.push(params.code ?? "");
      return params.code?.includes("local removed=0") ? { removed: 3 } : { changed };
    }) as never;

    await applyLuauTestFrameworkToggle(callRpc, true);
    changed = false;
    await applyLuauTestFrameworkToggle(callRpc, true);
    await applyLuauTestFrameworkToggle(callRpc, false);

    expect(saves).toEqual([1, 3]);
    const removal = codes[2]!;
    expect(removal).toContain("DiligentTestFramework");
    expect(removal).not.toContain("DiligentTests");
  });
});
