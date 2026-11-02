// @summary Samples explicitly verified local Windows processes with one bounded OS worker per capture.

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { ProcessIdentity, ProcessSample } from "./performance-types";

export function processInterval(previous: ProcessSample | undefined, current: ProcessSample): ProcessSample {
  const result = {
    ...current,
    intervalSeconds: null as number | null,
    usedCores: null as number | null,
    cpuPct: null,
    effectiveCpuCapacity: null,
  };
  if (!previous || current.status !== "ok" || previous.status !== "ok") return result;
  if (current.pid !== previous.pid || Date.parse(current.startTimeUtc) !== Date.parse(previous.startTimeUtc))
    return { ...result, status: "target_stale" };
  const seconds = (current.monotonicMs - previous.monotonicMs) / 1000;
  const cpu = current.cpuSeconds != null && previous.cpuSeconds != null ? current.cpuSeconds - previous.cpuSeconds : -1;
  if (seconds > 0 && cpu >= 0) {
    result.intervalSeconds = seconds;
    result.usedCores = cpu / seconds;
  }
  return result;
}

export function verifyServer(identity: ProcessIdentity, identities: ProcessIdentity[], studioPid?: number): boolean {
  if (!/(?:^|\s)-(?:server|dedicatedserver)(?=\s|$)/i.test(identity.commandLine ?? "")) return false;
  if (studioPid === undefined) return true;
  let ancestor = identity.parentPid;
  const visited = new Set<number>([identity.pid]);
  while (ancestor && !visited.has(ancestor)) {
    if (ancestor === studioPid) return true;
    visited.add(ancestor);
    ancestor = identities.find((item) => item.pid === ancestor)?.parentPid;
  }
  return false;
}

// Inputs travel over stdin as JSON, never as PowerShell code. CIM is queried
// once for identity/ancestry. The loop reads .NET Process counters only.
const workerScript = `
$ErrorActionPreference = 'Stop'
$cfg = [Console]::ReadLine() | ConvertFrom-Json
try {
  $all = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate | ForEach-Object { @{pid=[int]$_.ProcessId;parentPid=[int]$_.ParentProcessId;startTimeUtc=if($_.CreationDate){$_.CreationDate.ToUniversalTime().ToString('o')}else{''}} })
  [Console]::WriteLine((@{kind='identities';records=$all} | ConvertTo-Json -Compress -Depth 5))
  $clock = [Diagnostics.Stopwatch]::StartNew()
  do {
    foreach ($target in $cfg.targets) {
      $record = @{pid=[int]$target.pid;startTimeUtc=$target.startTimeUtc;observedAtUtc=[DateTime]::UtcNow.ToString('o');monotonicMs=$clock.Elapsed.TotalMilliseconds;cpuSeconds=$null;residentBytes=$null;privateBytes=$null;status='unavailable'}
      try {
        $proc = [Diagnostics.Process]::GetProcessById([int]$target.pid)
        try {
          $actual = $proc.StartTime.ToUniversalTime()
          if ([Math]::Abs(($actual - [DateTime]::Parse($target.startTimeUtc).ToUniversalTime()).TotalMilliseconds) -ge 1) { $record.status='target_stale' }
          else { $proc.Refresh(); $record.cpuSeconds=$proc.TotalProcessorTime.TotalSeconds; $record.residentBytes=$proc.WorkingSet64; $record.privateBytes=$proc.PrivateMemorySize64; $record.status='ok' }
        } finally { $proc.Dispose() }
      } catch { $record.status='unavailable' }
      [Console]::WriteLine((@{kind='sample';record=$record} | ConvertTo-Json -Compress -Depth 4))
    }
    [Threading.Thread]::Sleep(1000)
  } while ($clock.Elapsed.TotalSeconds -le $cfg.seconds)
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
`;

export interface ProcessSampler {
  identities: ProcessIdentity[];
  samples: ProcessSample[];
  setTargets(targets: ProcessIdentity[]): void;
  stop(): void;
  failure?: string;
}

export async function startProcessSampler(targets: ProcessIdentity[], seconds: number): Promise<ProcessSampler> {
  if (process.platform !== "win32") throw new Error("OS process sampling requires Windows");
  const child = spawn(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(workerScript, "utf16le").toString("base64"),
    ],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  let selected = targets;
  const sampler: ProcessSampler = {
    identities: [],
    samples: [],
    setTargets: (value) => {
      selected = value;
    },
    stop: () => {
      child.kill();
    },
  };
  let stderr = "";
  child.stderr.on("data", (data: Buffer) => {
    stderr = (stderr + data.toString()).slice(-2000);
  });
  const lines = createInterface({ input: child.stdout });
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Process identity lookup timed out"));
    }, 10_000);
    child.on("error", (error) => {
      clearTimeout(timer);
      sampler.failure = error.message;
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code) sampler.failure = stderr || `OS worker exited (${code})`;
      reject(new Error(sampler.failure ?? "OS worker exited before identity lookup"));
    });
    lines.on("line", (line) => {
      try {
        const message = JSON.parse(line);
        if (message.kind === "identities") {
          sampler.identities = message.records;
          clearTimeout(timer);
          resolve();
        } else if (message.kind === "sample" && sampler.samples.length < 400) {
          const sample = message.record as ProcessSample;
          const target = selected.find((item) => item.pid === sample.pid);
          if (!target) return;
          const previous = sampler.samples.findLast((item) => item.pid === sample.pid);
          sampler.samples.push(processInterval(previous, { ...sample, role: target.role }));
        }
      } catch {
        sampler.failure = "Invalid process worker output";
      }
    });
  });
  child.stdin.end(`${JSON.stringify({ targets, seconds })}\n`);
  await ready;
  return sampler;
}

// Resolve requested identities before starting the sampling worker. This small
// one-shot query is not a periodic collector and never executes caller text.
export async function inspectProcesses(pids: number[]): Promise<ProcessIdentity[]> {
  if (process.platform !== "win32") throw new Error("OS process sampling requires Windows");
  const script =
    "$ids = [Console]::ReadLine() | ConvertFrom-Json; $rows = @(Get-CimInstance Win32_Process | Where-Object { $ids -contains [int]$_.ProcessId } | ForEach-Object { @{pid=[int]$_.ProcessId;parentPid=[int]$_.ParentProcessId;commandLine=$_.CommandLine;startTimeUtc=$_.CreationDate.ToUniversalTime().ToString('o')} }); [Console]::WriteLine((ConvertTo-Json -InputObject $rows -Compress))";
  const child = spawn(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    { windowsHide: true },
  );
  child.stdin.end(`${JSON.stringify(pids)}\n`);
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Process identity lookup timed out"));
    }, 10_000);
    child.stdout.on("data", (data: Buffer) => {
      output += data.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      try {
        if (code) throw new Error("Process identity lookup failed");
        resolve(JSON.parse(output));
      } catch (error) {
        reject(error);
      }
    });
  });
}
