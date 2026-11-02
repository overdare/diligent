import { expect, test } from "bun:test";
import { processInterval, verifyServer } from "../../../../src/tools/studiorpc/tools/performance-process";

test("process rates use actual wall time and reject PID reuse and counter resets", () => {
  const first = {
    pid: 7,
    startTimeUtc: "2026-11-01T00:00:00Z",
    monotonicMs: 100,
    cpuSeconds: 2,
    residentBytes: 100,
    privateBytes: 90,
    status: "ok" as const,
  };
  const second = { ...first, monotonicMs: 2100, cpuSeconds: 5 };
  expect(processInterval(first, second).usedCores).toBe(1.5);
  expect(processInterval(first, second).cpuPct).toBeNull();
  expect(processInterval(first, { ...second, startTimeUtc: "2026-11-02T00:00:00Z" }).status).toBe("target_stale");
  expect(processInterval(first, { ...second, cpuSeconds: 1 }).usedCores).toBeNull();
});

test("server identity requires an explicit server switch and the Studio ancestry for associated servers", () => {
  const identities = [
    { pid: 12, parentPid: 11, commandLine: '"Sandbox.exe" map -server', startTimeUtc: "2026-11-01T00:00:00Z" },
    { pid: 11, parentPid: 10, commandLine: "launcher", startTimeUtc: "2026-11-01T00:00:00Z" },
  ];
  expect(verifyServer(identities[0]!, identities, 10)).toBe(true);
  expect(verifyServer({ ...identities[0]!, commandLine: "SandboxServer.exe -client" }, identities, 10)).toBe(false);
  expect(verifyServer(identities[0]!, identities, 99)).toBe(false);
});
