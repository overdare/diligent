// @summary Goal lifecycle, budget, recovery, and stale execution invariants
import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GoalController } from "../../src/goals/controller";
import { openGoalStore } from "../../src/goals/store";
import { createGoalContextHook } from "../../src/goals/tools";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function setup(wake: (delay?: number) => void = () => {}) {
  const dir = await mkdtemp(join(tmpdir(), "goal-controller-"));
  dirs.push(dir);
  const store = await openGoalStore(dir, "session");
  const controller = await GoalController.open(store, "session", { changed: async () => {}, wake });
  return { dir, controller, store };
}
function control(controller: GoalController) {
  const goal = controller.read().goal!;
  return { expectedGoalId: goal.id, expectedRevision: goal.revision };
}
test("pause invalidates in-flight completion and restart never automatically resumes", async () => {
  const { dir, controller } = await setup();
  await controller.change({ action: "set", objective: "Fix the bug" }, { idle: true, enabled: true, mode: "default" });
  const run = await controller.beginRun();
  await controller.pause("user");
  expect(run!.signal.aborted).toBe(true);
  await expect(controller.report(run!.identity, "complete", "Tests pass")).rejects.toThrow("Stale");
  await controller.change({ action: "resume", ...control(controller) }, { idle: true, enabled: true, mode: "default" });
  const restored = await GoalController.open(await openGoalStore(dir, "session"), "session", {
    changed: async () => {},
    wake: () => {},
  });
  expect(restored.read().goal).toMatchObject({ status: "paused", reason: "restart" });
});
test("budget is synchronous, de-duplicated, and late usage cannot charge replacement goals", async () => {
  const { controller } = await setup();
  await controller.change(
    { action: "set", objective: "Fix", tokenBudget: 5 },
    { idle: true, enabled: true, mode: "default" },
  );
  const run = (await controller.beginRun())!;
  const sample = {
    identity: run.identity,
    sessionId: "session",
    coreTurnId: "t",
    inputTokens: 3,
    outputTokens: 2,
    cacheReadTokens: 99,
    cacheWriteTokens: 0,
  };
  controller.recordUsage(sample);
  controller.recordUsage(sample);
  expect(run.signal.aborted).toBe(true);
  await controller.flush();
  expect(controller.read().goal).toMatchObject({ status: "budget_limited", tokensUsed: 5, cacheReadTokens: 99 });
  await controller.change({ action: "clear", ...control(controller) }, { idle: true, enabled: true, mode: "default" });
  await controller.change({ action: "set", objective: "New goal" }, { idle: true, enabled: true, mode: "default" });
  controller.recordUsage({ ...sample, coreTurnId: "late" });
  await controller.flush();
  expect(controller.read().goal?.tokensUsed).toBe(0);
});
test("completion needs evidence and settled descendants; three empty runs block", async () => {
  const { controller } = await setup();
  await controller.change({ action: "set", objective: "Fix" }, { idle: true, enabled: true, mode: "default" });
  const run = (await controller.beginRun())!;
  await expect(controller.report(run.identity, "complete", " ")).rejects.toThrow("evidence");
  run.childStarted("child");
  await expect(controller.report(run.identity, "complete", "Verified")).rejects.toThrow("children");
  run.childFinished("child");
  await controller.settle(run, { status: "completed" }, false);
  for (let i = 0; i < 2; i++) {
    const next = (await controller.beginRun())!;
    await controller.settle(next, { status: "completed" }, false);
  }
  expect(controller.read().goal).toMatchObject({ status: "blocked", reason: "no_progress" });
});
test("only bounded structured transient failures retry; quota needs explicit resume", async () => {
  const { controller } = await setup();
  await controller.change({ action: "set", objective: "Fix" }, { idle: true, enabled: true, mode: "default" });
  for (let i = 0; i < 4; i++) {
    const run = (await controller.beginRun())!;
    await controller.settle(
      run,
      {
        status: "failed",
        error: { name: "ProviderError", message: "offline", providerErrorType: "network", isRetryable: true },
      },
      false,
    );
    expect(controller.read().goal?.status).toBe(i < 3 ? "active" : "blocked");
  }
  await controller.change({ action: "resume", ...control(controller) }, { idle: true, enabled: true, mode: "default" });
  const run = (await controller.beginRun())!;
  await controller.settle(
    run,
    {
      status: "failed",
      error: { name: "ProviderError", message: "quota", providerErrorReason: "usage_limit_reached" },
    },
    false,
  );
  expect(controller.read().goal?.status).toBe("usage_limited");
});

test("descendants defer the next outer run until their completion wakes the coordinator", async () => {
  const { controller } = await setup();
  await controller.change({ action: "set", objective: "Fix" }, { idle: true, enabled: true, mode: "default" });
  const run = (await controller.beginRun())!;
  run.childStarted("child");
  await controller.settle(run, { status: "completed" }, true);
  expect(await controller.beginRun()).toBeNull();
  run.childFinished("child");
  expect(await controller.beginRun()).not.toBeNull();
});

test("persistence failure pauses execution and a later successful snapshot can recover controls", async () => {
  const { controller, store } = await setup();
  await controller.change({ action: "set", objective: "Fix" }, { idle: true, enabled: true, mode: "default" });
  const append = spyOn(store, "append").mockRejectedValueOnce(new Error("Temporary I/O failure"));
  await expect(controller.beginRun()).rejects.toThrow("Temporary I/O failure");
  append.mockRestore();
  const recovered = await controller.snapshot();
  expect(recovered.goal).toMatchObject({ status: "paused", reason: "persistence_error" });
  await controller.change({ action: "resume", ...control(controller) }, { idle: true, enabled: true, mode: "default" });
  expect((await controller.snapshot()).goal?.status).toBe("active");
});

test("queued writes cannot publish active state after a prior persistence failure", async () => {
  const { store } = await setup();
  const statuses: Array<string | undefined> = [];
  const controller = await GoalController.open(store, "session", {
    changed: async ({ goal }) => {
      statuses.push(goal?.status);
    },
    wake: () => {},
  });
  await controller.change({ action: "set", objective: "Fix" }, { idle: true, enabled: true, mode: "default" });
  const run = (await controller.beginRun())!;
  statuses.length = 0;
  let reject!: (error: Error) => void;
  const append = spyOn(store, "append").mockImplementationOnce(
    () =>
      new Promise<void>((_, fail) => {
        reject = fail;
      }),
  );
  const sample = {
    sessionId: "session",
    coreTurnId: "a",
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  run.recordUsage(sample);
  run.recordUsage({ ...sample, coreTurnId: "b" });
  reject(new Error("Temporary I/O failure"));
  await expect(controller.flush()).rejects.toThrow("Temporary I/O failure");
  expect(run.signal.aborted).toBe(true);
  expect(statuses).not.toContain("active");
  append.mockRestore();
  expect((await controller.snapshot()).goal).toMatchObject({
    status: "paused",
    reason: "persistence_error",
    tokensUsed: 4,
  });
  expect(statuses.at(-1)).toBe("paused");
});

test("completed goals require guarded replacement, not edits preserving stale success", async () => {
  const { controller } = await setup();
  const options = { idle: true, enabled: true, mode: "default" };
  await controller.change({ action: "set", objective: "First" }, options);
  const run = (await controller.beginRun())!;
  await controller.report(run.identity, "complete", "Verified first");
  await controller.settle(run, { status: "completed" }, true);
  await expect(controller.change({ action: "set", objective: "Second" }, options)).rejects.toThrow("revision");
  await expect(
    controller.change({ action: "edit", objective: "Second", ...control(controller) }, options),
  ).rejects.toThrow("Completed");
  const previous = controller.read().goal!;
  await controller.change({ action: "set", objective: "Second", expectedRevision: previous.revision }, options);
  expect(controller.read().goal).toMatchObject({ status: "active", turnsUsed: 0, tokensUsed: 0 });
  expect(controller.read().goal!.id).not.toBe(previous.id);
});

test("outer run limits are distinguished from token limits", async () => {
  const { controller } = await setup();
  await controller.change(
    { action: "set", objective: "Fix", maxTurns: 1 },
    { idle: true, enabled: true, mode: "default" },
  );
  const run = (await controller.beginRun())!;
  await controller.settle(run, { status: "completed" }, true);
  expect(controller.read().goal?.reason).toBe("turn_limit");
});

test("completion does not exempt the final response from its token cap", async () => {
  const { controller } = await setup();
  await controller.change(
    { action: "set", objective: "Fix", tokenBudget: 5 },
    { idle: true, enabled: true, mode: "default" },
  );
  const run = (await controller.beginRun())!;
  await controller.report(run.identity, "complete", "Verified");
  run.recordUsage({
    sessionId: "session",
    coreTurnId: "final",
    inputTokens: 3,
    outputTokens: 3,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
  expect(run.signal.aborted).toBe(true);
  await controller.settle(run, { status: "interrupted" }, true);
  expect((await controller.snapshot()).goal).toMatchObject({
    status: "complete",
    tokensUsed: 6,
    completionEvidence: "Verified",
  });
});

test("terminal runtime failures cancel owned children and child wake preserves retry backoff", async () => {
  const wakes: number[] = [];
  const { controller } = await setup((delay) => {
    wakes.push(delay ?? 0);
  });
  const clock = spyOn(Date, "now").mockReturnValue(1000);
  try {
    await controller.change({ action: "set", objective: "Fix" }, { idle: true, enabled: true, mode: "default" });
    const run = (await controller.beginRun())!;
    run.childStarted("child");
    await controller.settle(
      run,
      {
        status: "failed",
        error: {
          name: "Error",
          message: "offline",
          providerErrorType: "network",
          isRetryable: true,
          retryAfterMs: 10_000,
        },
      },
      true,
    );
    run.childFinished("child");
    expect(wakes.at(-1)).toBe(10_000);
    const next = (await controller.beginRun())!;
    next.childStarted("child2");
    await controller.settle(
      next,
      { status: "failed", error: { name: "Error", message: "quota", providerErrorReason: "usage_limit_reached" } },
      true,
    );
    expect(next.signal.aborted).toBe(true);
    expect(controller.read().goal?.status).toBe("usage_limited");
  } finally {
    clock.mockRestore();
  }
});

test("goal context is injected on prompt start and refreshed after compaction, not every round", async () => {
  const { controller } = await setup();
  await controller.change({ action: "set", objective: "Fix auth" }, { idle: true, enabled: true, mode: "default" });
  const scope = (await controller.beginRun())!;
  const hook = createGoalContextHook({ controller: () => controller, scope: () => scope });
  const round = { messages: [], turnId: "turn", compactedThisTurn: false };
  const first = hook.beforeTurn!(round)!;
  expect(first[0].source).toBe("goal");
  expect(first[0].content).toContain("Fix auth");
  expect(hook.beforeTurn!(round)).toBeUndefined();
  scope.recordUsage({
    sessionId: "session",
    coreTurnId: "one",
    inputTokens: 2,
    outputTokens: 3,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
  await controller.flush();
  expect(hook.beforeTurn!({ ...round, compactedThisTurn: true })![0].content).toContain('"tokensUsed":5');
  hook.onPromptStart!({ messages: [] });
  expect(hook.beforeTurn!(round)).toHaveLength(1);
});
