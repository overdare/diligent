import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { call } from "../../../../src/tools/studiorpc/rpc";
import { StudioRpcError } from "../../../../src/tools/studiorpc/rpc";
import { PerformanceService } from "../../../../src/tools/studiorpc/tools/performance-service";
import { PerformanceStore } from "../../../../src/tools/studiorpc/tools/performance-store";
import { captureParameters } from "../../../../src/tools/studiorpc/tools/performance-tools";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

test("strict capture inputs keep budgets out and require outcome reasons", () => {
  expect(captureParameters.safeParse({ case: "combat", budget: 16 }).success).toBe(false);
  expect(captureParameters.safeParse({ action: "stop", jobId: "x", outcome: "failed" }).success).toBe(false);
  expect(captureParameters.safeParse({ case: "join", seconds: 61 }).success).toBe(false);
  expect(captureParameters.parse({ case: "idle" }).action).toBe("start");
});

test("a bounded job survives a lost start reply, saves raw frames, and reopens without Studio", async () => {
  const directory = await mkdtemp(join(tmpdir(), "performance-"));
  directories.push(directory);
  const keys: string[] = [];
  let ended = false;
  const rpc = (async (method: string, params?: Record<string, unknown>) => {
    if (method === "performance.capabilities")
      return {
        resolvedTarget: { pid: 7, startTimeUtc: "2026-11-01T00:00:00Z", hostName: "remote" },
        metrics: { frame_ms: { status: "ok" } },
        conditions: {},
      };
    if (method === "performance.capture.start") {
      keys.push(params!.clientCaptureId as string);
      if (keys.length === 1) throw new Error("lost reply");
      return { nativeJobId: "native-1", state: "capturing" };
    }
    if (method === "performance.capture.stop") {
      ended = true;
      return { state: "completed" };
    }
    if (method === "performance.capture.status")
      return { state: ended ? "completed" : "capturing", frameCount: ended ? 1 : 0 };
    if (method === "performance.report.read" && params!.section === "summary")
      return {
        state: "completed",
        quality: { frameCount: 1 },
        conditions: {},
        latestObserved: {},
        manualScopes: { status: "ok", labels: ["AI.Step"], sampleCount: 2 },
      };
    if (method === "performance.report.read" && params!.section === "lua_scopes")
      return {
        records: [1, 3].map((elapsed_ms) => ({
          labelId: 0,
          frameId: "9",
          beginMonotonicNs: "1",
          endMonotonicNs: "2",
          elapsed_ms,
        })),
        nextOffset: null,
      };
    if (method === "performance.report.read")
      return {
        offset: 0,
        records: [
          {
            frameId: "9",
            beginMonotonicNs: "1",
            endMonotonicNs: "2",
            frame_ms: 20,
            lua_machine_ms: null,
            slate_gt_ms: null,
            validity: {},
          },
        ],
        nextOffset: null,
      };
    throw new Error(`Unexpected method ${method}`);
  }) as typeof call;
  const service = new PerformanceService(directory, rpc, { autoPoll: false });
  const started = await service.start({ case: "idle", seconds: 2 });
  const jobId = started.jobId as string;
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  await service.stop({ action: "stop", jobId, outcome: "completed" });
  const report = await service.report(jobId);
  expect(report.scenarioOutcome).toBe("completed");
  expect((report.summaries as Record<string, { p50: number }>).frame_ms!.p50).toBe(20);
  expect(Object.keys(report.artifacts as object)).toContain("frames");
  expect((report.luaScopes as { label: string; p50: number }[])[0]).toMatchObject({ label: "AI.Step", p50: 1 });
  expect((report.quality as Record<string, unknown>).manualScopes).toMatchObject({
    labelCount: 1,
    downloadedSamples: 2,
  });
  expect((report.quality as Record<string, { labels?: unknown }>).manualScopes!.labels).toBeUndefined();
  expect(await readFile((report.artifacts as Record<string, string>).luaScopes!, "utf8")).toContain('"AI.Step"');
  const offline = new PerformanceService(
    directory,
    (async () => {
      throw new Error("Studio closed");
    }) as typeof call,
    { autoPoll: false },
  );
  expect((await offline.report(jobId)).state).toBe("completed");
});

test("a restarted sidecar refuses to reattach a pending job to another process", async () => {
  const directory = await mkdtemp(join(tmpdir(), "performance-"));
  directories.push(directory);
  const rpc = (async (method: string) =>
    method === "performance.capabilities"
      ? {
          resolvedTarget: { pid: 7, startTimeUtc: "2026-11-01T00:00:00Z", hostName: "remote" },
          metrics: { frame_ms: { status: "ok" } },
          conditions: {},
        }
      : { nativeJobId: "native-1", state: "capturing" }) as typeof call;
  const first = new PerformanceService(directory, rpc, { autoPoll: false });
  const jobId = (await first.start({ case: "idle" })).jobId as string;
  const restarted = new PerformanceService(
    directory,
    (async () => ({ resolvedTarget: { pid: 8, startTimeUtc: "2026-11-02T00:00:00Z" } })) as typeof call,
    { autoPoll: false },
  );
  const report = await restarted.report(jobId);
  expect(report.state).toBe("failed");
  expect(report.stopReason).toContain("TARGET_STALE");
  expect((report.summaries as Record<string, { p50: null }>).frame_ms!.p50).toBeNull();
});

test.each([
  "completed",
  "partial",
  "capturing",
] as const)("recovery preserves raw artifacts when a %s manifest has no summary", async (state) => {
  const directory = await mkdtemp(join(tmpdir(), "performance-"));
  directories.push(directory);
  const rpc = (async (method: string) =>
    method === "performance.capabilities"
      ? {
          resolvedTarget: { pid: 7, startTimeUtc: "2026-11-01T00:00:00Z", hostName: "remote" },
          metrics: { frame_ms: { status: "ok" } },
          conditions: {},
        }
      : { nativeJobId: "native-1", state: "capturing" }) as typeof call;
  const first = new PerformanceService(directory, rpc, { autoPoll: false });
  const jobId = (await first.start({ case: "interrupted-write" })).jobId as string;
  const store = new PerformanceStore(directory);
  const manifest = { ...(await store.readManifest(jobId)), state };
  await store.writeManifest(manifest);
  const paths = store.paths(jobId);
  const raw = "frameId,frame_ms\n123,27\n";
  for (const path of [paths.frames, paths.process, paths.luaScopes]) await writeFile(path, raw);
  const restarted = new PerformanceService(
    directory,
    (async () => {
      throw new Error("must not call Studio");
    }) as typeof call,
    { autoPoll: false },
  );
  for (let attempt = 0; attempt < 2; attempt++) {
    await expect(restarted.report(jobId)).rejects.toMatchObject({
      code: -32070,
      data: { reason: "ARTIFACT_INCOMPLETE", jobId, artifacts: paths },
    });
  }
  await expect(restarted.stop({ action: "stop", jobId, outcome: "completed" })).rejects.toMatchObject({
    data: { reason: "ARTIFACT_INCOMPLETE" },
  });
  for (const path of [paths.frames, paths.process, paths.luaScopes]) expect(await readFile(path, "utf8")).toBe(raw);
  expect((await store.readManifest(jobId)).state).toBe(state);
  expect(await store.readReport(jobId)).toBeUndefined();
});

test("an OS-only server reports resources without manufacturing engine metrics", async () => {
  const directory = await mkdtemp(join(tmpdir(), "performance-"));
  directories.push(directory);
  const previousHost = process.env.STUDIO_HOST;
  process.env.STUDIO_HOST = "127.0.0.1";
  let stopped = false;
  const identity = { pid: 7, startTimeUtc: "2026-11-01T00:00:00Z", commandLine: "Sandbox.exe map -server" };
  try {
    const service = new PerformanceService(
      directory,
      (async () => {
        throw new Error("OS-only capture must not call Studio");
      }) as typeof call,
      {
        autoPoll: false,
        inspect: async () => [identity],
        sample: async () => ({
          identities: [identity],
          samples: [
            { ...identity, monotonicMs: 100, cpuSeconds: 1, residentBytes: 50, privateBytes: 40, status: "ok" },
          ],
          setTargets() {},
          stop() {
            stopped = true;
          },
        }),
      },
    );
    const started = await service.start({ case: "server", target: { ...identity, role: "dedicated_server" } });
    const jobId = started.jobId as string;
    await service.stop({ action: "stop", jobId, outcome: "failed", reason: "Scenario did not finish" });
    const report = await service.report(jobId);
    expect(report.state).toBe("completed");
    expect(report.scenarioOutcome).toBe("failed");
    expect(report.processes as unknown[]).toHaveLength(1);
    expect((report.summaries as Record<string, { p50: null; status: string }>).frame_ms).toMatchObject({
      p50: null,
      status: "unsupported",
    });
    expect(stopped).toBe(true);
  } finally {
    if (previousHost === undefined) delete process.env.STUDIO_HOST;
    else process.env.STUDIO_HOST = previousHost;
  }
});

test("old Studio binaries fail capability discovery without enabling a profiler fallback", async () => {
  const directory = await mkdtemp(join(tmpdir(), "performance-"));
  directories.push(directory);
  const calls: string[] = [];
  const service = new PerformanceService(
    directory,
    (async (method: string) => {
      calls.push(method);
      throw new StudioRpcError("Missing method", -32601, {});
    }) as typeof call,
    { autoPoll: false },
  );
  await expect(service.start({ case: "idle" })).rejects.toMatchObject({
    code: -32070,
    data: { reason: "UNSUPPORTED_BUILD" },
  });
  expect(calls).toEqual(["performance.capabilities"]);
});
