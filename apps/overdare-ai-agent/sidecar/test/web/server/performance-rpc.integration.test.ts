// @summary Real WebSocket capture reads resolve the selected project without Studio or conversation turns.
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { summarizeFrames } from "../../../src/tools/studiorpc/tools/performance-report";
import { PerformanceStore } from "../../../src/tools/studiorpc/tools/performance-store";
import type { Manifest, PerformanceReport } from "../../../src/tools/studiorpc/tools/performance-types";
import { WebRpcClient } from "../../../src/web/client/lib/rpc-client";
import { createWebServer } from "../../../src/web/server/index";
import { PerformanceViewSchema, WEB_PERFORMANCE_READ_METHOD } from "../../../src/web/shared/performance-protocol";

test("loads saved jobs through the host, rejects unknown threads and never follows a browser-supplied cwd", async () => {
  const root = await mkdtemp(join(tmpdir(), "performance-host-"));
  const project = join(root, "other-project");
  const store = new PerformanceStore(project);
  const jobId = "perf-00000000-0000-0000-0000-000000000001";
  const manifest = {
    schemaVersion: 1,
    jobId,
    state: "completed",
    case: "OS only",
    scenarioOutcome: "unverified",
  } as Manifest;
  const report = {
    ...manifest,
    ...summarizeFrames([], {}),
    summaries: {},
    conditions: {},
    quality: {},
    processes: [],
    missingMetrics: ["frame_ms"],
    latestObserved: {},
    worstFrames: [],
    artifacts: {},
  } as PerformanceReport;
  await store.writeManifest(manifest);
  await store.finish(manifest, [], [], report);
  await Bun.write(join(root, ".diligent", "config.json"), JSON.stringify({ model: null }));
  const { server, stop } = await createWebServer({ cwd: root, port: 0, dev: true });
  const rpc = new WebRpcClient(`ws://127.0.0.1:${server.port}/rpc`);
  try {
    await rpc.connect();
    await rpc.initialize({ clientName: "performance-test", clientVersion: "test", protocolVersion: 1 }, 3000);
    rpc.notify("initialized", { ready: true });
    const thread = await rpc.request("thread/start", { cwd: project }, 3000);
    const result = PerformanceViewSchema.parse(
      await rpc.requestRaw(WEB_PERFORMANCE_READ_METHOD, { jobId, threadId: thread.threadId }),
    );
    expect(result.report.case).toBe("OS only");
    expect(result.frames).toEqual([]);
    const missing = await rpc.requestRaw(WEB_PERFORMANCE_READ_METHOD, { jobId }, 3000).catch((e) => e);
    expect(missing.message).toContain("unavailable");
    const invalid = await rpc.requestRaw(WEB_PERFORMANCE_READ_METHOD, { jobId, cwd: project }, 3000).catch((e) => e);
    expect(invalid.message).toContain("Invalid");
    const unknown = await rpc
      .requestRaw(WEB_PERFORMANCE_READ_METHOD, { jobId, threadId: "unknown-thread" }, 3000)
      .catch((e) => e);
    expect(unknown.message).toContain("Thread not found");
    const history = await rpc.request("thread/read", { threadId: thread.threadId });
    expect(history.items).toEqual([]);
    expect(history.isRunning).toBe(false);
  } finally {
    rpc.disconnect();
    await stop();
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
