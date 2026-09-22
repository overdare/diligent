// @summary Goal-owned registries remain reachable until descendant cleanup finishes

import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleModeSet, type ThreadRuntime } from "../../src/app-server/thread-handlers";
import { handleTurnStart } from "../../src/app-server/turn-handlers";
import { GoalController } from "../../src/goals/controller";
import { openGoalStore } from "../../src/goals/store";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function goalWithChild(): Promise<{
  controller: GoalController;
  scope: NonNullable<Awaited<ReturnType<GoalController["beginRun"]>>>;
}> {
  const dir = await mkdtemp(join(tmpdir(), "diligent-goal-rebuild-"));
  dirs.push(dir);
  const controller = await GoalController.open(await openGoalStore(dir, "thread"), "thread", {
    changed: async () => {},
    wake: () => {},
  });
  await controller.change(
    { action: "set", objective: "Finish the work" },
    { idle: true, enabled: true, mode: "default" },
  );
  const scope = (await controller.beginRun())!;
  scope.childStarted("child");
  return { controller, scope };
}

test("plan mode pauses the goal without orphaning a live child registry", async () => {
  const { controller, scope } = await goalWithChild();
  const agent = { id: "goal-agent" };
  const runtime = {
    id: "thread",
    mode: "default",
    agent,
    goal: controller,
    manager: { appendModeChange: () => {} },
  } as unknown as ThreadRuntime;

  await expect(handleModeSet({ resolveThreadRuntime: async () => runtime } as never, "thread", "plan")).rejects.toThrow(
    "goal-owned work",
  );

  expect(runtime.mode).toBe("default");
  expect(runtime.agent).toBe(agent);
  expect(controller.read().goal).toMatchObject({ status: "paused", reason: "plan_mode" });
  expect(scope.signal.aborted).toBe(true);
});

test("a per-turn model change does not replace the agent while a goal-owned child is cleaning up", async () => {
  const { controller } = await goalWithChild();
  const agent = { id: "goal-agent" };
  const runtime = {
    id: "thread",
    cwd: "/tmp/project",
    mode: "default",
    effort: "medium",
    model: { provider: "anthropic", modelId: "claude-sonnet-5" },
    agent,
    goal: controller,
    manager: {
      getCurrentModel: () => ({ provider: "anthropic", modelId: "claude-sonnet-5" }),
      appendModelChange: () => {},
      subscribe: () => () => {},
      run: async () => {},
    },
    abortController: null,
    currentTurnId: null,
    isRunning: false,
  } as unknown as ThreadRuntime;

  await expect(
    handleTurnStart(
      {
        resolveThreadRuntime: async () => runtime,
        ensureGoal: async () => controller,
        emit: async () => {},
        consumeTurn: async (_runtime: ThreadRuntime, run: Promise<void>) => {
          await run.catch(() => {});
          return undefined;
        },
        getUserId: () => undefined,
        getPluginHooks: async () => ({ onUserPromptSubmit: [] }),
        getSkillNames: () => [],
      } as never,
      {
        threadId: "thread",
        message: "Use the other model",
        model: { provider: "openai", modelId: "gpt-5.5" },
      },
      undefined,
      new Map(),
    ),
  ).rejects.toThrow("goal-owned work");

  expect(runtime.agent).toBe(agent);
  expect(runtime.model).toEqual({ provider: "anthropic", modelId: "claude-sonnet-5" });
});
