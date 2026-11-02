import { expect, test } from "bun:test";
import { inspectProcesses, startProcessSampler } from "../../../../src/tools/studiorpc/tools/performance-process";

test.skipIf(process.platform !== "win32")(
  "Windows worker samples an existing process and detects a wrong creation identity",
  async () => {
    const [identity] = await inspectProcesses([process.pid]);
    expect(identity?.pid).toBe(process.pid);
    const sampler = await startProcessSampler([identity!], 2);
    try {
      await Bun.sleep(2400);
      expect(sampler.samples.some((sample) => sample.status === "ok" && sample.residentBytes! > 0)).toBe(true);
      expect(sampler.samples.some((sample) => sample.usedCores != null && sample.intervalSeconds! > 0)).toBe(true);
      expect(sampler.samples.every((sample) => sample.cpuPct === null)).toBe(true);
    } finally {
      sampler.stop();
    }
    const stale = await startProcessSampler([{ ...identity!, startTimeUtc: "2000-01-01T00:00:00Z" }], 1);
    try {
      await Bun.sleep(150);
      expect(stale.samples[0]?.status).toBe("target_stale");
    } finally {
      stale.stop();
    }
  },
  30000,
);
