// @summary Coordinates bounded Studio jobs, local process sampling, recovery, and post-capture artifacts.

import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { resolveStudioHost, resolveStudioPort } from "../config";
import { type call, StudioRpcError } from "../rpc";
import { studioRpcSessionId, withStudioRpcContext } from "../rpc-context";
import { inspectProcesses, type ProcessSampler, startProcessSampler, verifyServer } from "./performance-process";
import { compareReports, summarizeFrames, summarizeLuaScopes, summarizeProcesses } from "./performance-report";
import { PerformanceStore } from "./performance-store";
import {
  type CaptureStart,
  type CaptureStop,
  type FrameRecord,
  isTerminal,
  type LuaScopeMetadata,
  type LuaScopeRecord,
  type Manifest,
  type MetricInfo,
  type PerformanceReport,
  type ProcessIdentity,
} from "./performance-types";

interface Job {
  manifest: Manifest;
  sampler?: ProcessSampler;
  frames: FrameRecord[];
  luaScopes?: LuaScopeRecord[];
  timer?: ReturnType<typeof setInterval>;
  updating?: Promise<void>;
  sessionId: string;
  deadline: number;
  startedMonotonicMs: number;
  recovered?: boolean;
  lastError?: string;
  stopRequested?: boolean;
  lastProgressHostMs?: number;
}

interface Capabilities {
  resolvedTarget: Manifest["resolvedTarget"];
  metrics: Record<string, MetricInfo>;
  conditions: Record<string, unknown>;
}

export interface PerformanceServiceOptions {
  autoPoll?: boolean;
  inspect?: typeof inspectProcesses;
  sample?: typeof startProcessSampler;
}

function sameProcess(a: ProcessIdentity, b: ProcessIdentity) {
  return (
    a.pid === b.pid &&
    Number.isFinite(Date.parse(a.startTimeUtc)) &&
    Date.parse(a.startTimeUtc) === Date.parse(b.startTimeUtc)
  );
}

function performanceError(reason: string, message: string, extra: Record<string, unknown> = {}): never {
  throw new StudioRpcError(`${reason}: ${message}`, -32070, { reason, ...extra });
}

export class PerformanceService {
  private readonly store: PerformanceStore;
  private readonly jobs = new Map<string, Job>();
  private starting = false;

  constructor(
    cwd: string,
    private readonly rpc: typeof call,
    private readonly options: PerformanceServiceOptions = {},
  ) {
    this.store = new PerformanceStore(cwd);
  }

  private invoke(job: Job, method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    // A caller aborts its request, not the finite background capture. The native
    // identity guard additionally protects endpoint reuse after a Studio restart.
    return withStudioRpcContext({ sessionId: job.sessionId, signal: new AbortController().signal }, () =>
      this.rpc(method, params, { ...job.manifest.endpoint, sessionId: job.sessionId, timeoutMs: 3000 }),
    );
  }

  private async save(job: Job) {
    try {
      await this.store.writeManifest(job.manifest);
    } catch (error) {
      performanceError("ARTIFACT_WRITE_FAILED", String(error), { jobId: job.manifest.jobId });
    }
  }

  async start(request: CaptureStart): Promise<Record<string, unknown>> {
    if (this.starting) performanceError("PERF_BUSY", "Another performance capture is starting");
    const active = [...this.jobs.values()].find((job) => !isTerminal(job.manifest.state) || job.updating);
    if (active) performanceError("PERF_BUSY", "Performance capture already active", { jobId: active.manifest.jobId });
    this.starting = true;
    let job: Job | undefined;
    try {
      const endpoint = { host: resolveStudioHost(), port: resolveStudioPort() };
      const osOnly = request.target && "pid" in request.target;
      if (osOnly && request.serverPids?.length)
        performanceError("TARGET_UNVERIFIED", "serverPids cannot accompany an OS-only target");
      const sessionId = studioRpcSessionId();
      let capability: Capabilities;
      if (osOnly) {
        if (!["localhost", "127.0.0.1", "::1", hostname().toLowerCase()].includes(endpoint.host.toLowerCase()))
          performanceError("TARGET_UNVERIFIED", "OS-only targets must be on the local host");
        capability = {
          resolvedTarget: { ...(request.target as ProcessIdentity), scope: "process" },
          metrics: Object.fromEntries(
            ["frame_ms", "lua_machine_ms", "slate_gt_ms"].map((key) => [
              key,
              { status: "unsupported", scope: "process", reason: "OS-only capture has no engine frame metrics" },
            ]),
          ),
          conditions: { scope: "process" },
        };
      } else {
        try {
          capability = (await this.rpc(
            "performance.capabilities",
            { target: request.target },
            { ...endpoint, timeoutMs: 3000 },
          )) as Capabilities;
        } catch (error) {
          if (error instanceof StudioRpcError && error.code === -32601)
            performanceError("UNSUPPORTED_BUILD", "This Studio has no performance capture methods");
          throw error;
        }
        if (capability.metrics.frame_ms?.status !== "ok")
          performanceError("UNSUPPORTED_BUILD", "This Studio build does not support frame collection");
      }
      const manifest: Manifest = {
        schemaVersion: 1,
        jobId: `perf-${randomUUID()}`,
        clientCaptureId: randomUUID(),
        rpcSessionId: sessionId,
        case: request.case,
        seconds: request.seconds ?? 30,
        state: "starting",
        createdAt: new Date().toISOString(),
        endpoint,
        resolvedTarget: capability.resolvedTarget,
        metrics: capability.metrics,
        conditions: capability.conditions ?? {},
        request,
        scenarioOutcome: "unverified",
      };
      job = {
        manifest,
        frames: [],
        sessionId,
        startedMonotonicMs: performance.now(),
        deadline: performance.now() + (manifest.seconds + 15) * 1000,
      };
      this.jobs.set(manifest.jobId, job);
      await this.save(job); // Persist the idempotency key before sending start.
      const localEndpoint = ["localhost", "127.0.0.1", "::1", hostname().toLowerCase()].includes(
        endpoint.host.toLowerCase(),
      );
      const local =
        osOnly ||
        (localEndpoint &&
          typeof manifest.resolvedTarget.hostName === "string" &&
          manifest.resolvedTarget.hostName.toLowerCase() === hostname().toLowerCase());
      if (!local && request.serverPids?.length)
        performanceError("TARGET_UNVERIFIED", "Associated servers require a verified local Studio host");
      if (local) {
        try {
          const ids = [...new Set([manifest.resolvedTarget.pid, ...(request.serverPids ?? [])])];
          const identities = await (this.options.inspect ?? inspectProcesses)(ids);
          const identity = identities.find((item) => item.pid === manifest.resolvedTarget.pid);
          if (!identity || !sameProcess(identity, manifest.resolvedTarget))
            performanceError("TARGET_STALE", "Process creation identity changed");
          if (osOnly && !verifyServer(identity, identities))
            performanceError("TARGET_UNVERIFIED", "OS-only target has no verified server command-line switch");
          const targets = identities.map((item) => ({
            ...item,
            role:
              item.pid === manifest.resolvedTarget.pid ? (osOnly ? "dedicated_server" : "studio") : "dedicated_server",
          }));
          if (targets.length !== ids.length)
            performanceError("TARGET_UNVERIFIED", "One or more requested server PIDs could not be resolved");
          job.sampler = await (this.options.sample ?? startProcessSampler)(targets, manifest.seconds + 1);
          for (const target of targets) {
            if (
              target.pid !== manifest.resolvedTarget.pid &&
              !verifyServer(target, job.sampler.identities, manifest.resolvedTarget.pid)
            )
              performanceError("TARGET_UNVERIFIED", `Server PID ${target.pid} is not a verified Studio descendant`);
          }
          job.sampler.setTargets(targets);
        } catch (error) {
          job.sampler?.stop();
          if (osOnly || request.serverPids?.length || error instanceof StudioRpcError) throw error;
          manifest.osReason = String(error);
        }
      } else manifest.osReason = "Studio host identity is not verified as local";
      if (osOnly) {
        manifest.state = "capturing";
        manifest.conditions = { ...manifest.conditions, coverage: "os_process_v1" };
      } else {
        await this.startNative(job);
      }
      // Capture duration begins after setup, not during CIM process discovery.
      job.startedMonotonicMs = performance.now();
      job.deadline = performance.now() + (manifest.seconds + 15) * 1000;
      manifest.createdAt = new Date().toISOString();
      await this.save(job);
      this.arm(job);
      return this.progress(job);
    } catch (error) {
      if (job) {
        job.sampler?.stop();
        job.manifest.stopReason = error instanceof Error ? error.message : String(error);
        // A lost start reply can leave a bounded native job running. Keep its
        // idempotency key and report it as pending instead of starting another.
        if (!job.manifest.nativeJobId && job.lastError) {
          await this.save(job);
          this.arm(job);
          return this.progress(job);
        }
        job.manifest.state = "failed";
        await this.finish(job);
      }
      throw error;
    } finally {
      this.starting = false;
    }
  }

  private async startNative(job: Job) {
    const manifest = job.manifest;
    const params = {
      clientCaptureId: manifest.clientCaptureId,
      seconds: manifest.seconds,
      target: manifest.request.target,
      expectedProcess: { pid: manifest.resolvedTarget.pid, startTimeUtc: manifest.resolvedTarget.startTimeUtc },
    };
    let response: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await this.invoke(job, "performance.capture.start", params);
        job.lastError = undefined;
        break;
      } catch (error) {
        if (error instanceof StudioRpcError) throw error;
        job.lastError = String(error);
      }
    }
    if (!response) throw new Error(job.lastError ?? "Native start failed");
    const started = response as Record<string, unknown>;
    if (typeof started.nativeJobId !== "string") throw new Error("Invalid native capture identity");
    manifest.nativeJobId = started.nativeJobId;
    this.applyStatus(job, started);
    if (isTerminal(manifest.state)) manifest.state = "finalizing";
  }

  private arm(job: Job) {
    if (this.options.autoPoll === false || isTerminal(job.manifest.state) || job.timer) return;
    job.timer = setInterval(() => {
      void this.update(job).catch((error) => {
        job.lastError = String(error);
      });
    }, 2000);
    job.timer.unref();
  }

  private progress(job: Job): Record<string, unknown> {
    const m = job.manifest;
    return {
      schemaVersion: 1,
      jobId: m.jobId,
      state: m.state,
      case: m.case,
      seconds: m.seconds,
      resolvedTarget: m.resolvedTarget,
      elapsedSeconds: m.elapsedSeconds ?? 0,
      frameCount: m.frameCount ?? 0,
      lastProgressAgeMs:
        job.lastProgressHostMs === undefined ? null : Math.max(0, performance.now() - job.lastProgressHostMs),
      metrics: m.metrics,
      missingMetrics: Object.entries(m.metrics)
        .filter(([, info]) => info.status !== "ok")
        .map(([key]) => key),
      osReason: m.osReason,
      lastError: job.lastError,
      retryAfterMs: 2000,
    };
  }

  private applyStatus(job: Job, status: Record<string, unknown>) {
    const m = job.manifest;
    if (typeof status.state === "string") m.state = status.state as Manifest["state"];
    if (typeof status.elapsedSeconds === "number") m.elapsedSeconds = status.elapsedSeconds;
    if (typeof status.frameCount === "number") m.frameCount = status.frameCount;
    if (typeof status.lastProgressAgeMs === "number")
      job.lastProgressHostMs = performance.now() - status.lastProgressAgeMs;
    if (typeof status.stopReason === "string") m.stopReason = status.stopReason;
    if (status.quality) m.quality = status.quality as Record<string, unknown>;
    if (status.latestObserved) m.latestObserved = status.latestObserved as Record<string, unknown>;
    if (status.manualScopes) m.manualScopes = status.manualScopes as LuaScopeMetadata;
    if (status.conditions) m.conditions = status.conditions as Record<string, unknown>;
    if (status.endConditions && JSON.stringify(status.endConditions) !== JSON.stringify(m.conditions))
      m.conditions = { ...m.conditions, changedDuringCapture: status.endConditions, load: "unknown" };
  }

  private update(job: Job): Promise<void> {
    if (job.updating) return job.updating;
    job.updating = this.updateOnce(job).finally(() => {
      job.updating = undefined;
    });
    return job.updating;
  }

  private async updateOnce(job: Job) {
    const m = job.manifest;
    if (isTerminal(m.state)) {
      await this.finish(job);
      return;
    }
    try {
      if (performance.now() > job.deadline) {
        if (m.nativeJobId) {
          try {
            await this.invoke(job, "performance.capture.stop", { nativeJobId: m.nativeJobId });
          } catch {
            /* GT may be stalled. Keep only host-owned data. */
          }
        }
        m.stopReason = "HOST_UNREACHABLE: Capture deadline exceeded";
        m.state = "partial";
        await this.finish(job);
        return;
      }
      if (!m.nativeJobId && !(m.request.target && "pid" in m.request.target)) await this.startNative(job);
      if (m.nativeJobId) {
        if (job.stopRequested) await this.invoke(job, "performance.capture.stop", { nativeJobId: m.nativeJobId });
        this.applyStatus(
          job,
          (await this.invoke(job, "performance.capture.status", { nativeJobId: m.nativeJobId })) as Record<
            string,
            unknown
          >,
        );
        if (isTerminal(m.state)) {
          this.applyStatus(
            job,
            (await this.invoke(job, "performance.report.read", {
              nativeJobId: m.nativeJobId,
              section: "summary",
            })) as Record<string, unknown>,
          );
          let offset: number | null = 0;
          while (offset !== null && job.frames.length < 10000) {
            const page = (await this.invoke(job, "performance.report.read", {
              nativeJobId: m.nativeJobId,
              section: "frames",
              offset,
              limit: 500,
            })) as { records: FrameRecord[]; nextOffset: number | null };
            if (
              !Array.isArray(page.records) ||
              page.records.length > 500 ||
              (page.nextOffset !== null && (!Number.isInteger(page.nextOffset) || page.nextOffset <= offset))
            )
              throw new Error("Invalid native frame page");
            job.frames.push(...page.records);
            offset = page.nextOffset;
          }
          if (m.manualScopes) {
            job.luaScopes = [];
            offset = 0;
            while (offset !== null && job.luaScopes.length < 8192) {
              const page = (await this.invoke(job, "performance.report.read", {
                nativeJobId: m.nativeJobId,
                section: "lua_scopes",
                offset,
                limit: 500,
              })) as { records: LuaScopeRecord[]; nextOffset: number | null };
              if (
                !Array.isArray(page.records) ||
                page.records.length > 500 ||
                (page.nextOffset !== null && (!Number.isInteger(page.nextOffset) || page.nextOffset <= offset))
              )
                throw new Error("Invalid Lua scope page");
              job.luaScopes.push(...page.records.slice(0, 8192 - job.luaScopes.length));
              offset = page.nextOffset;
            }
          }
          await this.finish(job);
          return;
        }
      } else {
        m.elapsedSeconds = (performance.now() - job.startedMonotonicMs) / 1000;
        if (m.elapsedSeconds >= m.seconds || job.stopRequested) {
          m.state = "completed";
          m.stopReason = job.stopRequested ? "requested" : "duration";
          await this.finish(job);
          return;
        }
      }
      job.lastError = undefined;
      await this.save(job);
    } catch (error) {
      job.lastError = String(error);
      if (error instanceof StudioRpcError || isTerminal(m.state)) {
        m.state = "partial";
        m.stopReason = job.lastError;
        await this.finish(job);
      }
    }
  }

  private async finish(job: Job) {
    const m = job.manifest;
    if (job.timer) clearInterval(job.timer);
    job.timer = undefined;
    job.sampler?.stop();
    const osOnly = m.request.target && "pid" in m.request.target;
    if (!osOnly && !job.frames.length) m.state = "failed";
    if (m.scenarioOutcome === "cancelled" && m.state !== "failed") m.state = "cancelled";
    const samples = job.sampler?.samples ?? [];
    if (osOnly && !samples.some((sample) => sample.status === "ok")) m.state = "failed";
    const result = summarizeFrames(job.frames, m.metrics);
    const manualMetadata = m.manualScopes
      ? {
          ...m.manualScopes,
          status: m.manualScopes.sampleCount === (job.luaScopes?.length ?? 0) ? m.manualScopes.status : "partial",
        }
      : undefined;
    const luaScopes = summarizeLuaScopes(job.luaScopes ?? [], manualMetadata).sort((a, b) => b.total_ms - a.total_ms);
    // Full label names live in the manifest/CSV; avoid duplicating all 32 names
    // in the bounded public report alongside its eight invocation summaries.
    const { labels: manualLabels, ...manualQuality } = manualMetadata ?? { labels: [] };
    if (osOnly) {
      for (const metric of Object.values(result.summaries)) {
        metric.status = "unsupported";
        metric.reason = "OS-only capture has no engine frame metrics";
      }
    }
    const report: PerformanceReport = {
      schemaVersion: 1,
      jobId: m.jobId,
      state: m.state,
      case: m.case,
      scenarioOutcome: m.scenarioOutcome,
      resolvedTarget: m.resolvedTarget,
      ...result,
      conditions: m.conditions,
      processes: summarizeProcesses(samples),
      quality: {
        ...m.quality,
        frameCount: job.frames.length,
        osReason: m.osReason,
        processFailure: job.sampler?.failure,
        recoveredAfterRestart: job.recovered === true,
        partialReason: m.stopReason,
        manualScopes: manualMetadata
          ? {
              ...manualQuality,
              labelCount: manualLabels.length,
              downloadedSamples: job.luaScopes?.length ?? 0,
              omittedSummaryLabels: Math.max(0, luaScopes.length - 8),
            }
          : {
              status: "unsupported",
              reason: osOnly
                ? "OS-only capture has no Lua scope events"
                : "Studio has no explicit Lua scope collection",
            },
      },
      missingMetrics: Object.entries(result.summaries)
        .filter(([, info]) => !info.n)
        .map(([key]) => key),
      latestObserved: m.latestObserved ?? {},
      worstFrames: [...job.frames].sort((a, b) => b.frame_ms - a.frame_ms).slice(0, 5),
      artifacts: this.store.paths(m.jobId),
      stopReason: m.stopReason,
      luaScopes: luaScopes.slice(0, 8),
    };
    try {
      await this.store.finish(m, job.frames, samples, report, job.luaScopes);
    } catch (error) {
      m.state = "partial";
      m.stopReason = `ARTIFACT_WRITE_FAILED: ${String(error)}`;
      await this.save(job);
      throw error;
    }
    // Completed raw arrays live in artifacts, not an unbounded sidecar cache.
    this.jobs.delete(m.jobId);
  }

  private async load(jobId: string): Promise<Job> {
    const known = this.jobs.get(jobId);
    if (known) return known;
    let manifest: Manifest;
    try {
      manifest = await this.store.readManifest(jobId);
    } catch {
      performanceError("JOB_NOT_FOUND", "Performance capture not found", { jobId });
    }
    if (isTerminal(manifest.state) || (await this.store.hasRawArtifacts(jobId))) {
      // report()/stop() already looked for a durable summary. Re-finalizing a
      // terminal manifest here would replace retained CSVs with empty arrays.
      performanceError(
        "ARTIFACT_INCOMPLETE",
        "Capture finalization was interrupted; retained artifacts were preserved",
        {
          jobId,
          state: manifest.state,
          artifacts: this.store.paths(jobId),
        },
      );
    }
    const job: Job = {
      manifest,
      frames: [],
      sessionId: manifest.rpcSessionId ?? studioRpcSessionId(),
      startedMonotonicMs: performance.now() - Math.max(0, Date.now() - Date.parse(manifest.createdAt)),
      deadline:
        performance.now() + Math.max(0, (manifest.seconds + 15) * 1000 - (Date.now() - Date.parse(manifest.createdAt))),
      recovered: true,
    };
    this.jobs.set(jobId, job);
    if (!isTerminal(manifest.state)) {
      manifest.osReason =
        "OS observations were interrupted by sidecar restart; earlier in-memory samples are unavailable";
      try {
        const capability = (await this.invoke(job, "performance.capabilities")) as Capabilities;
        if (!sameProcess(capability.resolvedTarget, manifest.resolvedTarget))
          performanceError("TARGET_STALE", "Studio process identity changed");
        if (manifest.request.target && "pid" in manifest.request.target)
          throw new Error("OS-only capture interrupted by sidecar restart");
        await this.update(job);
        this.arm(job);
      } catch (error) {
        manifest.state = "partial";
        manifest.stopReason = String(error);
        await this.finish(job);
      }
    }
    return job;
  }

  async stop(request: CaptureStop): Promise<Record<string, unknown>> {
    const completed = await this.store.readReport(request.jobId);
    if (completed) return { jobId: request.jobId, state: completed.state, stopReason: completed.stopReason };
    const job = await this.load(request.jobId);
    const m = job.manifest;
    m.scenarioOutcome = request.outcome;
    m.scenarioReason = request.reason;
    job.stopRequested = true;
    await this.save(job);
    if (m.nativeJobId && !isTerminal(m.state))
      await this.invoke(job, "performance.capture.stop", { nativeJobId: m.nativeJobId });
    // Raw pagination and report generation run in the background.
    if (this.options.autoPoll !== false) void this.update(job);
    return { jobId: request.jobId, state: m.state, stopReason: "requested" };
  }

  async report(jobId: string, baseline?: string): Promise<Record<string, unknown>> {
    let report = await this.store.readReport(jobId);
    if (!report) {
      const job = await this.load(jobId);
      await this.update(job);
      report = await this.store.readReport(jobId);
      if (!report) return this.progress(job);
    }
    if (!baseline) return { ...report };
    const base = await this.store.readReport(baseline);
    if (!base)
      performanceError("JOB_NOT_FOUND", "Baseline must be a completed capture in this project", { jobId: baseline });
    return { ...report, comparison: compareReports(report, base, baseline) };
  }
}

const services = new Map<string, PerformanceService>();
export function getPerformanceService(cwd: string, rpc: typeof call) {
  const key = `${cwd}\0${resolveStudioHost()}:${resolveStudioPort()}`;
  let service = services.get(key);
  if (!service) {
    service = new PerformanceService(cwd, rpc);
    services.set(key, service);
  }
  return service;
}
