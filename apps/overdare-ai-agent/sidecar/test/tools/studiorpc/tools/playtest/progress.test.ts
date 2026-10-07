import { describe, expect, test } from "bun:test";
import type { PlaytestProgress } from "../../../../../src/tools/studiorpc/tools/playtest/frame";
import { createProgressWatchdog } from "../../../../../src/tools/studiorpc/tools/playtest/progress";

describe("playtest progress watchdog", () => {
  test("becomes stuck at the no-progress threshold", () => {
    const watchdog = createProgressWatchdog(10_000, 0);

    expect(watchdog.status(9_999)).toMatchObject({
      stuck: false,
      timeoutMs: 10_000,
      inactiveMs: 9_999,
      deadlineMs: 10_000,
      source: "effects",
    });
    expect(watchdog.status(10_000)).toMatchObject({ stuck: true, inactiveMs: 10_000 });
  });

  test("uses the first telemetry sequence as a baseline and only increasing sequences reset progress", () => {
    const watchdog = createProgressWatchdog(1_000, 0);
    watchdog.observe({ sequence: 4 }, 500);
    expect(watchdog.status(500)).toMatchObject({
      source: "adapter",
      sequence: 4,
      inactiveMs: 500,
      deadlineMs: 1_000,
      stuck: false,
    });

    watchdog.observe({ sequence: 4 }, 700);
    expect(watchdog.status(700).inactiveMs).toBe(700);
    watchdog.observe({ sequence: 5 }, 800);
    expect(watchdog.status(800)).toMatchObject({ sequence: 5, inactiveMs: 0, deadlineMs: 1_800, stuck: false });
    expect(() => watchdog.observe({ sequence: 3 }, 900)).toThrow(/regressed/);
    expect(watchdog.status(900).sequence).toBe(5);
  });

  test("pauses once per sequence, ends early, and cannot renew by changing or re-adding the wait", () => {
    const watchdog = createProgressWatchdog(10_000, 0);
    const loading: PlaytestProgress = { sequence: 2, waiting: { reason: "waiting for server", timeoutMs: 3_000 } };
    watchdog.observe({ sequence: 2 }, 1_000);
    watchdog.observe(loading, 2_000);
    expect(watchdog.status(2_500)).toMatchObject({
      stuck: false,
      inactiveMs: 2_000,
      deadlineMs: 13_000,
      waitingReason: "waiting for server",
    });

    watchdog.observe({ sequence: 2, waiting: { reason: "changed reason", timeoutMs: 8_000 } }, 2_500);
    expect(watchdog.status(2_500)).toMatchObject({ deadlineMs: 13_000, waitingReason: "waiting for server" });
    watchdog.observe({ sequence: 2 }, 3_000);
    const earlyRemoval = watchdog.status(3_000);
    expect(earlyRemoval).toMatchObject({ inactiveMs: 2_000, deadlineMs: 11_000 });
    expect(earlyRemoval).not.toHaveProperty("waitingReason");

    watchdog.observe({ sequence: 2, waiting: { reason: "re-added", timeoutMs: 3_000 } }, 4_000);
    const rejectedRenewal = watchdog.status(4_000);
    expect(rejectedRenewal).toMatchObject({ inactiveMs: 3_000, deadlineMs: 11_000 });
    expect(rejectedRenewal).not.toHaveProperty("waitingReason");
    expect(watchdog.status(11_000)).toMatchObject({ stuck: true, inactiveMs: 10_000 });
  });

  test("automatically resumes after a declared wait expires even if no new metadata arrives", () => {
    const watchdog = createProgressWatchdog(1_000, 0);
    watchdog.observe({ sequence: 0, waiting: { reason: "initialization", timeoutMs: 5_000 } }, 0);

    expect(watchdog.status(4_999)).toMatchObject({
      inactiveMs: 0,
      deadlineMs: 6_000,
      waitingReason: "initialization",
      stuck: false,
    });
    const resumed = watchdog.status(5_000);
    expect(resumed).toMatchObject({ inactiveMs: 0, deadlineMs: 6_000 });
    expect(resumed).not.toHaveProperty("waitingReason");
    expect(watchdog.status(5_999).stuck).toBe(false);
    expect(watchdog.status(6_000).stuck).toBe(true);
  });

  test("effect confirmations reset only the pre-telemetry fallback epoch", () => {
    const watchdog = createProgressWatchdog(1_000, 0);
    watchdog.confirmEffect(400);
    expect(watchdog.status(700)).toMatchObject({ source: "effects", inactiveMs: 300, deadlineMs: 1_400 });

    watchdog.observe({ sequence: 10 }, 800);
    expect(watchdog.status(800)).toMatchObject({ source: "adapter", sequence: 10, inactiveMs: 400 });
    watchdog.confirmEffect(900);
    expect(watchdog.status(1_400)).toMatchObject({
      source: "adapter",
      sequence: 10,
      inactiveMs: 1_000,
      stuck: true,
    });
  });

  test("missing metadata after adoption neither resets sequence nor switches back to effect fallback", () => {
    const watchdog = createProgressWatchdog(1_000, 0);
    watchdog.observe({ sequence: 7 }, 100);
    watchdog.observe(undefined, 500);
    expect(watchdog.status(500)).toMatchObject({ source: "adapter", sequence: 7, inactiveMs: 500, stuck: false });
    watchdog.observe(undefined, 800);
    expect(watchdog.status(1_000)).toMatchObject({ source: "adapter", sequence: 7, inactiveMs: 1_000, stuck: true });
  });

  test("a later sequence can declare a fresh bounded wait", () => {
    const watchdog = createProgressWatchdog(2_000, 0);
    watchdog.observe({ sequence: 1 }, 100);
    watchdog.observe({ sequence: 1, waiting: { reason: "first", timeoutMs: 1_000 } }, 500);
    watchdog.observe({ sequence: 2, waiting: { reason: "second", timeoutMs: 2_000 } }, 900);
    expect(watchdog.status(900)).toMatchObject({
      sequence: 2,
      inactiveMs: 0,
      deadlineMs: 4_900,
      waitingReason: "second",
      stuck: false,
    });
  });
});
