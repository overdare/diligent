// @summary Reads completed capture artifacts only; no Studio connection, recovery, sampling or writes.
import { open } from "node:fs/promises";
import { z } from "zod";
import { compareReports, summarizeLuaScopes, summarizeProcesses } from "../../tools/studiorpc/tools/performance-report";
import { PerformanceStore } from "../../tools/studiorpc/tools/performance-store";
import { isTerminal } from "../../tools/studiorpc/tools/performance-types";
import {
  PerformanceFrameSchema,
  PerformanceLuaScopeSchema,
  PerformanceProcessSampleSchema,
  type PerformanceReadParams,
  PerformanceReadParamsSchema,
  PerformanceViewSchema,
} from "../shared/performance-protocol";

const MAX_BYTES = 8 * 1024 * 1024;
async function boundedRead(path: string): Promise<string> {
  const file = await open(path, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error("Invalid or oversized capture artifact");
    const buffer = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > stat.size) throw new Error("Capture artifact changed while reading");
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length));
  } finally {
    await file.close();
  }
}

// The store quotes every data field. Parse quoted commas/newlines and doubled quotes without lossy coercion.
function csv(text: string, required: string[]): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false,
    closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        closed = true;
      } else field += c;
    } else if (c === '"' && !field && !closed) quoted = true;
    else if (c === "," || c === "\n") {
      row.push(field);
      field = "";
      closed = false;
      if (c === "\n") {
        if (row.some(Boolean)) rows.push(row);
        row = [];
      }
    } else if (c !== "\r") {
      if (closed || c === '"') throw new Error("Malformed capture artifact CSV");
      field += c;
    }
  }
  if (quoted) throw new Error("Truncated capture artifact CSV");
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const headers = rows.shift();
  if (!headers?.length || new Set(headers).size !== headers.length || required.some((key) => !headers.includes(key)))
    throw new Error("Invalid capture artifact header");
  return rows.map((values) => {
    if (values.length !== headers.length) throw new Error("Truncated capture artifact row");
    return Object.fromEntries(headers.map((name, i) => [name, values[i]!]));
  });
}

function number(value: string | undefined) {
  return value === "" || value === undefined ? null : Number(value);
}
async function load(cwd: string, jobId: string) {
  const paths = new PerformanceStore(cwd).paths(jobId);
  try {
    const manifest = JSON.parse(await boundedRead(paths.manifest));
    if (!isTerminal(manifest.state)) throw new Error("Capture artifacts are not ready; finish capture first");
    const [reportText, framesText, luaText, processText] = await Promise.all([
      boundedRead(paths.summary),
      boundedRead(paths.frames),
      boundedRead(paths.luaScopes),
      boundedRead(paths.process),
    ]);
    const report = JSON.parse(reportText);
    if (
      manifest.schemaVersion !== 1 ||
      report.schemaVersion !== 1 ||
      manifest.jobId !== jobId ||
      report.jobId !== jobId
    )
      throw new Error("Unsupported capture artifact version or identity");
    const frames = z
      .array(PerformanceFrameSchema)
      .max(10000)
      .parse(
        csv(framesText, [
          "frameId",
          "beginMonotonicNs",
          "endMonotonicNs",
          "frame_ms",
          "lua_machine_ms",
          "slate_gt_ms",
          "validity",
        ]).map((row) => ({
          ...row,
          frame_ms: number(row.frame_ms),
          lua_machine_ms: number(row.lua_machine_ms),
          slate_gt_ms: number(row.slate_gt_ms),
          validity: JSON.parse(row.validity || "{}"),
        })),
      );
    const luaScopes = z
      .array(PerformanceLuaScopeSchema)
      .max(8192)
      .parse(
        csv(luaText, ["labelId", "frameId", "beginMonotonicNs", "endMonotonicNs", "elapsed_ms"]).map((row) => ({
          ...row,
          labelId: number(row.labelId),
          elapsed_ms: number(row.elapsed_ms),
        })),
      );
    const processSamples = z
      .array(PerformanceProcessSampleSchema)
      .max(2000)
      .parse(
        csv(processText, [
          "pid",
          "startTimeUtc",
          "monotonicMs",
          "cpuSeconds",
          "residentBytes",
          "privateBytes",
          "status",
        ]).map((row) => ({
          ...row,
          pid: number(row.pid),
          monotonicMs: number(row.monotonicMs),
          cpuSeconds: number(row.cpuSeconds),
          usedCores: number(row.usedCores),
          intervalSeconds: number(row.intervalSeconds),
          residentBytes: number(row.residentBytes),
          privateBytes: number(row.privateBytes),
        })),
      );
    for (const record of [...frames, ...luaScopes]) {
      if (BigInt(record.endMonotonicNs) < BigInt(record.beginMonotonicNs))
        throw new Error("Invalid capture artifact clock");
    }
    const manualScopes =
      manifest.manualScopes === undefined
        ? undefined
        : z
            .object({
              status: z.string(),
              labels: z.array(z.string()).max(32),
            })
            .passthrough()
            .parse(manifest.manualScopes);
    if (luaScopes.some((scope) => !manualScopes || scope.labelId >= manualScopes.labels.length))
      throw new Error("Missing capture artifact label metadata");
    return {
      report,
      frames,
      luaScopes,
      processSamples,
      manualScopes,
      luaSummaries: summarizeLuaScopes(luaScopes, manualScopes),
      processes: summarizeProcesses(processSamples),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new Error("Capture artifacts are not ready or unavailable on this computer");
    throw new Error(`Cannot read capture artifact: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function readPerformanceView(cwd: string, raw: PerformanceReadParams) {
  const params = PerformanceReadParamsSchema.parse(raw);
  const view = await load(cwd, params.jobId);
  const baseline = params.baseline ? await load(cwd, params.baseline) : undefined;
  return PerformanceViewSchema.parse({
    schemaVersion: 1,
    ...view,
    ...(baseline
      ? { baselineReport: baseline.report, comparison: compareReports(view.report, baseline.report, params.baseline!) }
      : {}),
    ...(baseline
      ? {
          baselineLuaSummaries: baseline.luaSummaries,
          luaComparison: compareReports(
            { ...view.report, summaries: Object.fromEntries(view.luaSummaries.map((s) => [s.label, s])) },
            { ...baseline.report, summaries: Object.fromEntries(baseline.luaSummaries.map((s) => [s.label, s])) },
            params.baseline!,
          ),
        }
      : {}),
  });
}
