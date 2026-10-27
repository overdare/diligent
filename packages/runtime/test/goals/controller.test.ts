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
  let interrupts = 0;
  const run = (await controller.beginRun({ interruptTools: () => interrupts++ }))!;
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
  expect(run.signal.aborted).toBe(false);
  expect(run.childSignal.aborted).toBe(true);
  expect(interrupts).toBe(1);
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
  run.noteTool("read");
  run.childStarted("child");
  await expect(controller.report(run.identity, "complete", "Verified")).rejects.toThrow("children");
  run.childFinished("child");
  await controller.settle(run, { status: "completed" });
  for (let i = 0; i < 3; i++) {
    const next = (await controller.beginRun())!;
    next.noteTool("get_goal");
    await controller.settle(next, { status: "completed" });
  }
  expect(controller.read().goal).toMatchObject({ status: "blocked", reason: "no_progress" });
});
test("only bounded structured transient failures retry; quota needs explicit resume", async () => {
  const { controller } = await setup();
  await controller.change({ action: "set", objective: "Fix" }, { idle: true, enabled: true, mode: "default" });
  for (let i = 0; i < 4; i++) {
    const run = (await controller.beginRun())!;
    await controller.settle(run, {
      status: "failed",
      error: { name: "ProviderError", message: "offline", providerErrorType: "network", isRetryable: true },
    });
    expect(controller.read().goal?.status).toBe(i < 3 ? "active" : "blocked");
  }
  await controller.change({ action: "resume", ...control(controller) }, { idle: true, enabled: true, mode: "default" });
  const run = (await controller.beginRun())!;
  await controller.settle(run, {
    status: "failed",
    error: { name: "ProviderError", message: "quota", providerErrorReason: "usage_limit_reached" },
  });
  expect(controller.read().goal?.status).toBe("usage_limited");
});

test("descendants defer the next outer run until their completion wakes the coordinator", async () => {
  const { controller } = await setup();
  await controller.change({ action: "set", objective: "Fix" }, { idle: true, enabled: true, mode: "default" });
  const run = (await controller.beginRun())!;
  run.childStarted("child");
  await controller.settle(run, { status: "completed" });
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
  run.noteTool("bash");
  await controller.report(run.identity, "complete", "Verified first");
  await controller.settle(run, { status: "completed" });
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
  run.noteTool("bash");
  await controller.settle(run, { status: "completed" });
  expect(controller.read().goal?.reason).toBe("turn_limit");
});

test("completion does not exempt the final response from its token cap", async () => {
  const { controller } = await setup();
  await controller.change(
    { action: "set", objective: "Fix", tokenBudget: 5 },
    { idle: true, enabled: true, mode: "default" },
  );
  const run = (await controller.beginRun())!;
  run.noteTool("bash");
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
  await controller.settle(run, { status: "interrupted" });
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
    await controller.settle(run, {
      status: "failed",
      error: {
        name: "Error",
        message: "offline",
        providerErrorType: "network",
        isRetryable: true,
        retryAfterMs: 10_000,
      },
    });
    run.childFinished("child");
    expect(wakes.at(-1)).toBe(10_000);
    const next = (await controller.beginRun())!;
    next.childStarted("child2");
    await controller.settle(next, {
      status: "failed",
      error: { name: "Error", message: "quota", providerErrorReason: "usage_limit_reached" },
    });
    expect(next.signal.aborted).toBe(true);
    expect(controller.read().goal?.status).toBe("usage_limited");
  } finally {
    clock.mockRestore();
  }
});

test("goal runs carry the continuation as input; context is re-injected only after compaction", async () => {
  const { controller } = await setup();
  await controller.change({ action: "set", objective: "Fix auth" }, { idle: true, enabled: true, mode: "default" });
  const scope = (await controller.beginRun())!;
  expect(controller.continuationPrompt()).toContain("<objective>\nFix auth\n</objective>");
  const hook = createGoalContextHook({ controller: () => controller, scope: () => scope });
  const round = { messages: [], turnId: "turn", compactedThisTurn: false };
  expect(hook.beforeTurn!(round)).toBeUndefined();
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
  const compacted = hook.beforeTurn!({ ...round, compactedThisTurn: true })!;
  expect(compacted[0].source).toBe("goal");
  expect(compacted[0].content).toContain("Context was compacted");
  expect(compacted[0].content).toContain("Tokens used: 5");
});

const options = { idle: true, enabled: true, mode: "default" };
const usage = (coreTurnId: string, tokens: number, sessionId = "session") => ({
  sessionId,
  coreTurnId,
  inputTokens: tokens,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

test("completion requires a work tool in the current run; non-work tools do not count", async () => {
  const { controller } = await setup();
  await controller.change({ action: "set", objective: "Fix" }, options);
  const run = (await controller.beginRun())!;
  for (const name of ["get_goal", "update_goal", "plan", "create_goal"]) run.noteTool(name);
  await expect(controller.report(run.identity, "complete", "Done")).rejects.toThrow(
    "Completion rejected: this goal run has not verified anything yet",
  );
  run.noteTool("glob");
  await controller.report(run.identity, "complete", "Done");
  expect(controller.read().goal?.status).toBe("complete");
});

test("blocked is rejected before the third run since start, and a rejected claim becomes the no-progress reason", async () => {
  const { controller } = await setup();
  await controller.change({ action: "set", objective: "Fix" }, options);
  for (let i = 1; i <= 2; i++) {
    const run = (await controller.beginRun())!;
    await expect(controller.report(run.identity, "blocked", "Need API key")).rejects.toThrow(
      `Blocked rejected: this is consecutive goal run ${i};`,
    );
    await controller.settle(run, { status: "completed" });
  }
  const third = (await controller.beginRun())!;
  await controller.settle(third, { status: "completed" });
  expect(controller.read().goal).toMatchObject({ status: "blocked", reason: "Need API key" });

  await controller.change({ action: "resume", ...control(controller) }, options);
  for (let i = 0; i < 2; i++) await controller.settle((await controller.beginRun())!, { status: "completed" });
  const run = (await controller.beginRun())!;
  await controller.report(run.identity, "blocked", "Need API key");
  expect(run.signal.aborted).toBe(true);
  expect(controller.read().goal).toMatchObject({ status: "blocked", reason: "Need API key" });
});

test("model-requested pause works from an active goal and from a user-turn suspension", async () => {
  const wakes: number[] = [];
  const { controller } = await setup((delay) => wakes.push(delay ?? 0));
  await expect(controller.requestPause()).rejects.toThrow("No active goal to pause");
  await controller.change({ action: "set", objective: "Fix" }, options);
  const run = (await controller.beginRun())!;
  await controller.requestPause();
  expect(run.signal.aborted).toBe(true);
  expect(controller.read().goal).toMatchObject({ status: "paused", reason: "user_request" });

  await controller.change({ action: "resume", ...control(controller) }, options);
  await controller.suspendForUserTurn("turn-1");
  await controller.requestPause();
  wakes.length = 0;
  await controller.resumeAfterUserTurn("turn-1", { enabled: true, mode: "default" });
  expect(controller.read().goal).toMatchObject({ status: "paused", reason: "user_request" });
  expect(wakes).toEqual([]);
});

test("user-turn suspension rebinds to the latest turn and resumes only after that turn", async () => {
  const wakes: number[] = [];
  const { controller } = await setup((delay) => wakes.push(delay ?? 0));
  await controller.change({ action: "set", objective: "Fix" }, options);
  const run = (await controller.beginRun())!;
  await controller.suspendForUserTurn("turn-1");
  expect(run.signal.aborted).toBe(true);
  expect(controller.read().goal).toMatchObject({ status: "paused", reason: "user_turn" });
  // Settling the interrupted goal run must not cancel the pending auto-resume.
  await controller.settle(run, { status: "interrupted" });
  await controller.suspendForUserTurn("turn-2");
  await controller.resumeAfterUserTurn("turn-1", { enabled: true, mode: "default" });
  expect(controller.read().goal?.status).toBe("paused");
  wakes.length = 0;
  await controller.resumeAfterUserTurn("turn-2", { enabled: true, mode: "default" });
  expect(controller.read().goal).toMatchObject({ status: "active", reason: undefined });
  expect(wakes).toEqual([0]);
});

test("user-turn auto-resume is cancelled by Stop, plan mode, goal changes, or disabled goals", async () => {
  const { controller } = await setup();
  await controller.change({ action: "set", objective: "Fix" }, options);
  const resume = (turnId: string, mode = "default", enabled = true) =>
    controller.resumeAfterUserTurn(turnId, { enabled, mode });

  await controller.suspendForUserTurn("a");
  await controller.pause("user");
  await resume("a");
  expect(controller.read().goal).toMatchObject({ status: "paused", reason: "user" });

  await controller.change({ action: "resume", ...control(controller) }, options);
  await controller.suspendForUserTurn("b");
  await controller.pause("plan_mode");
  await resume("b");
  expect(controller.read().goal).toMatchObject({ status: "paused", reason: "plan_mode" });

  await controller.change({ action: "resume", ...control(controller) }, options);
  await controller.suspendForUserTurn("c");
  await resume("c", "plan");
  expect(controller.read().goal).toMatchObject({ status: "paused", reason: "user_turn" });

  await controller.suspendForUserTurn("d");
  await resume("d", "default", false);
  expect(controller.read().goal?.status).toBe("paused");

  await controller.suspendForUserTurn("e");
  await controller.change({ action: "edit", maxTurns: 50, ...control(controller) }, options);
  await resume("e");
  expect(controller.read().goal).toMatchObject({ status: "paused", reason: "user_turn", maxTurns: 50 });
});

test("config reload resumes after success and never overrides a user-turn suspension", async () => {
  const { controller } = await setup();
  await controller.change({ action: "set", objective: "Fix" }, options);
  await controller.pause("config_reload");
  expect(controller.read().goal).toMatchObject({ status: "paused", reason: "config_reload" });
  await controller.resumeAfterConfigReload({ enabled: true, mode: "default" });
  expect(controller.read().goal?.status).toBe("active");

  await controller.suspendForUserTurn("turn");
  await controller.pause("config_reload");
  await controller.resumeAfterConfigReload({ enabled: true, mode: "default" });
  expect(controller.read().goal).toMatchObject({ status: "paused", reason: "user_turn" });
  await controller.resumeAfterUserTurn("turn", { enabled: true, mode: "default" });
  expect(controller.read().goal?.status).toBe("active");

  await controller.pause("config_reload");
  await controller.pause("disabled");
  await controller.resumeAfterConfigReload({ enabled: true, mode: "default" });
  expect(controller.read().goal).toMatchObject({ status: "paused", reason: "disabled" });
});

test("soft budget allows one wrap-up injection and stops the run at the next sample", async () => {
  const { controller } = await setup();
  await controller.change({ action: "set", objective: "Fix", tokenBudget: 10 }, options);
  let interrupts = 0;
  const scope = (await controller.beginRun({ interruptTools: () => interrupts++ }))!;
  const hook = createGoalContextHook({ controller: () => controller, scope: () => scope });
  const round = { messages: [], turnId: "turn", compactedThisTurn: false };
  expect(hook.beforeTurn!(round)).toBeUndefined();
  scope.recordUsage(usage("one", 12));
  expect(controller.read().goal).toMatchObject({ status: "budget_limited", reason: "token_budget" });
  expect(interrupts).toBe(1);
  expect(scope.signal.aborted).toBe(false);

  const wrapUp = hook.beforeTurn!(round)!;
  expect(wrapUp[0].content).toContain("The active thread goal has reached its token budget");
  // Child usage is charged but does not count as a root wrap-up sample.
  scope.recordUsage(usage("child", 1, "child-thread"));
  expect(interrupts).toBe(1);
  scope.recordUsage(usage("two", 1));
  expect(interrupts).toBe(2);
  expect(hook.beforeTurn!(round)).toBeUndefined();
  expect(scope.signal.aborted).toBe(true);
  await controller.settle(scope, { status: "interrupted" });
  expect((await controller.snapshot()).goal).toMatchObject({
    status: "budget_limited",
    reason: "token_budget",
    tokensUsed: 14,
  });
});

test("a text-only wrap-up settles budget-limited and invalidates the run", async () => {
  const { controller } = await setup();
  await controller.change({ action: "set", objective: "Fix", tokenBudget: 10 }, options);
  const scope = (await controller.beginRun())!;
  scope.recordUsage(usage("one", 10));
  expect(controller.contextInjection(scope, { first: false, compacted: false })).toContain("token budget");
  await controller.settle(scope, { status: "completed" });
  expect(scope.signal.aborted).toBe(true);
  expect(controller.read().goal).toMatchObject({ status: "budget_limited", runStartedAt: undefined });
});

test("late usage outside the current run takes the hard budget path", async () => {
  const { controller } = await setup();
  await controller.change({ action: "set", objective: "Fix", tokenBudget: 10 }, options);
  const scope = (await controller.beginRun())!;
  scope.noteTool("bash");
  await controller.settle(scope, { status: "completed" });
  expect(controller.read().goal?.status).toBe("active");
  const next = (await controller.beginRun())!;
  scope.recordUsage(usage("late", 10));
  expect(next.signal.aborted).toBe(true);
  expect(controller.read().goal).toMatchObject({ status: "budget_limited", reason: "token_budget" });
  expect(controller.contextInjection(next, { first: false, compacted: false })).toBeUndefined();
});

test("runStartedAt tracks only the in-flight run", async () => {
  const { controller, dir } = await setup();
  await controller.change({ action: "set", objective: "Fix" }, options);
  expect(controller.read().goal?.runStartedAt).toBeUndefined();
  const run = (await controller.beginRun())!;
  expect(controller.read().goal?.runStartedAt).toBe(run.startedAt);
  await controller.flush();
  const reopened = await GoalController.open(await openGoalStore(dir, "session"), "session", {
    changed: async () => {},
    wake: () => {},
  });
  expect(reopened.read().goal).toMatchObject({ status: "paused", reason: "restart", runStartedAt: undefined });
  run.noteTool("bash");
  await controller.settle(run, { status: "completed" });
  expect(controller.read().goal?.runStartedAt).toBeUndefined();
  await controller.beginRun();
  await controller.pause("user");
  expect(controller.read().goal?.runStartedAt).toBeUndefined();
});

test("run limits are unlimited by default, honor the configured default, and edits can clear them", async () => {
  const { controller } = await setup();
  await controller.change({ action: "set", objective: "Fix" }, options);
  expect(controller.read().goal?.maxTurns).toBeUndefined();
  await controller.change({ action: "clear", ...control(controller) }, options);
  await controller.change({ action: "set", objective: "Fix", tokenBudget: 100 }, { ...options, defaultMaxTurns: 7 });
  expect(controller.read().goal).toMatchObject({ maxTurns: 7, tokenBudget: 100 });
  await controller.pause("user");
  await expect(controller.change({ action: "edit", ...control(controller) }, options)).rejects.toThrow(
    "Nothing to edit",
  );
  await controller.change({ action: "edit", maxTurns: null, tokenBudget: null, ...control(controller) }, options);
  expect(controller.read().goal).toMatchObject({ objective: "Fix", maxTurns: undefined, tokenBudget: undefined });
});

test("an objective edit resets the audit and is announced to the next run only", async () => {
  const { controller } = await setup();
  await controller.change({ action: "set", objective: "Fix" }, options);
  for (let i = 0; i < 2; i++) await controller.settle((await controller.beginRun())!, { status: "completed" });
  await controller.pause("user");
  await controller.change({ action: "edit", objective: "Fix and document", ...control(controller) }, options);
  await controller.change({ action: "resume", ...control(controller) }, options);
  const run = (await controller.beginRun())!;
  expect(controller.continuationPrompt()).toContain("The user edited this objective");
  await expect(controller.report(run.identity, "blocked", "stuck")).rejects.toThrow("consecutive goal run 1;");
  await controller.settle(run, { status: "completed" });
  await controller.beginRun();
  expect(controller.continuationPrompt()).not.toContain("The user edited this objective");
});
