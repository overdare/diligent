// @summary Tests for handleConfigReload — clears cached per-thread agents on reload success

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleConfigReload } from "../../src/app-server/config-handlers";
import type { ThreadRuntime } from "../../src/app-server/thread-handlers";
import { GoalController } from "../../src/goals/controller";
import { openGoalStore } from "../../src/goals/store";

function fakeRuntime(agent: unknown): ThreadRuntime {
  return { agent } as unknown as ThreadRuntime;
}

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function runtimeWithGoalChild(
  agent: unknown,
): Promise<{ runtime: ThreadRuntime; scope: Awaited<ReturnType<GoalController["beginRun"]>> }> {
  const dir = await mkdtemp(join(tmpdir(), "diligent-config-reload-goal-"));
  dirs.push(dir);
  const controller = await GoalController.open(await openGoalStore(dir, "thread"), "thread", {
    changed: async () => {},
    wake: () => {},
  });
  await controller.change(
    { action: "set", objective: "Finish the work" },
    { idle: true, enabled: true, mode: "default" },
  );
  const scope = await controller.beginRun();
  scope!.childStarted("child");
  return { runtime: { agent, goal: controller } as unknown as ThreadRuntime, scope };
}

describe("handleConfigReload", () => {
  test("throws when the host does not support reloadConfig", async () => {
    await expect(handleConfigReload(undefined, new Map())).rejects.toThrow(
      "Config reload is not supported by this app server.",
    );
  });

  test("returns the reloaded skills and clears every thread's cached agent", async () => {
    const threads = new Map<string, ThreadRuntime>([
      ["t1", fakeRuntime({ id: "agent-1" })],
      ["t2", fakeRuntime({ id: "agent-2" })],
    ]);
    const reloadConfig = async () => ({
      skills: [{ name: "write-plan", description: "Create implementation plans" }],
    });

    const result = await handleConfigReload(reloadConfig, threads);

    expect(result).toEqual({ skills: [{ name: "write-plan", description: "Create implementation plans" }] });
    expect(threads.get("t1")?.agent).toBeUndefined();
    expect(threads.get("t2")?.agent).toBeUndefined();
  });

  test("pauses active goals and preserves their registry until owned children settle", async () => {
    const agent = { id: "goal-agent" };
    const { runtime, scope } = await runtimeWithGoalChild(agent);
    let reloads = 0;

    await expect(
      handleConfigReload(
        async () => {
          reloads++;
          return { skills: [] };
        },
        new Map([["thread", runtime]]),
      ),
    ).rejects.toThrow("goal-owned work");

    expect(reloads).toBe(0);
    expect(runtime.agent).toBe(agent);
    expect(runtime.goal?.read().goal).toMatchObject({ status: "paused", reason: "config_reload" });
    expect(scope!.signal.aborted).toBe(true);
  });
});
