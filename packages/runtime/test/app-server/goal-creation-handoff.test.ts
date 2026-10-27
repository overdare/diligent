// @summary Pending goal handoff remains revocable during terminal cleanup and user admission
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleConfigReload } from "../../src/app-server/config-handlers";
import { dispatchClientRequest } from "../../src/app-server/request-dispatcher";
import { handleThreadDelete } from "../../src/app-server/session-handlers";
import {
  resetTurnRuntimeState,
  type ThreadHandlersContext,
  type ThreadRuntime,
} from "../../src/app-server/thread-handlers";
import { handleTurnInterrupt, handleTurnStart } from "../../src/app-server/turn-handlers";
import { GoalController } from "../../src/goals/controller";
import { openGoalStore } from "../../src/goals/store";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

for (const boundary of [
  "success",
  "stop",
  "new user",
  "write failure",
  "indirect config reload",
  "tool settings",
  "thread deletion",
] as const) {
  test(`pending creation at the cleanup boundary: ${boundary}`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "goal-handoff-"));
    dirs.push(dir);
    let wakes = 0;
    const goal = await GoalController.open(await openGoalStore(dir, "thread"), "thread", {
      changed: async () => {},
      wake: () => {
        wakes++;
      },
    });
    const model = { provider: "anthropic" as const, modelId: "claude-sonnet-5" };
    let release!: () => void;
    const finish = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    let staleCreate: NonNullable<ThreadRuntime["goalCreation"]>["create"];
    const runtime = {
      id: "thread",
      cwd: dir,
      model,
      mode: "default",
      effort: "medium",
      goal,
      abortController: null,
      currentTurnId: null,
      isRunning: false,
      manager: {
        getCurrentModel: () => model,
        runWithOutcome: async () => {
          if (++calls === 1) {
            staleCreate = runtime.goalCreation!.create;
            expect(
              await staleCreate({ objective: "Finish the verified work" }, new AbortController().signal),
            ).toMatchObject({ status: "pending" });
            await finish;
          }
          return { status: "completed" };
        },
      },
    } as unknown as ThreadRuntime;
    let replacement: ReturnType<typeof handleTurnStart> | undefined;
    let cleanups = 0;
    const ctx = {
      resolveThreadRuntime: async () => runtime,
      ensureGoal: async () => goal,
      getGoalsConfig: () => undefined,
      getSkillNames: () => [],
      getPluginHooks: async () => ({ onUserPromptSubmit: [] }),
      getUserId: () => "user",
      emit: async () => {},
      consumeTurn: async (_runtime: ThreadRuntime, run: Promise<void>) => {
        await run;
        resetTurnRuntimeState(runtime);
        if (++cleanups === 1) {
          if (boundary === "stop") expect(await handleTurnInterrupt(ctx, runtime.id)).toEqual({ interrupted: true });
          if (boundary === "write failure") throw new Error("Session write failed");
          if (boundary === "thread deletion")
            await expect(
              handleThreadDelete({ threads: new Map([[runtime.id, runtime]]) } as never, runtime.id),
            ).rejects.toThrow("currently running");
          if (boundary === "indirect config reload")
            await handleConfigReload(async () => ({ skills: [] }), new Map([[runtime.id, runtime]]));
          if (boundary === "tool settings") {
            // Stop at the context lookup to avoid writing global user configuration.
            // The dispatcher must already revoke creation before settings I/O begins.
            await expect(
              dispatchClientRequest(
                {
                  threadHandlersCtx: {
                    threads: new Map([[runtime.id, runtime]]),
                    resolveToolsContext: async () => {
                      expect(runtime.goalCreation).toBeUndefined();
                      throw new Error("Settings I/O boundary");
                    },
                  },
                  toolConfig: { getTools: () => ({}), setTools: () => {} },
                } as never,
                "peer",
                { method: "tools/set", params: { threadId: runtime.id, builtin: {} } },
              ),
            ).rejects.toThrow("Settings I/O boundary");
          }
          if (boundary === "new user")
            replacement = handleTurnStart(ctx, { threadId: runtime.id, message: "New work" }, "peer", new Map());
        }
        return undefined;
      },
    } as unknown as ThreadHandlersContext;
    await handleTurnStart(ctx, { threadId: runtime.id, message: "Keep working until verified" }, "peer", new Map());
    const originalWork = runtime.turnWork;
    release();
    await originalWork;
    await replacement;
    await runtime.turnWork;
    await goal.flush();
    expect(wakes).toBe(boundary === "success" ? 1 : 0);
    if (boundary === "success")
      expect(goal.read().goal).toMatchObject({ objective: "Finish the verified work", turnsUsed: 0 });
    else expect(goal.read().goal).toBeNull();
    await expect(staleCreate!({ objective: "Stale request" }, new AbortController().signal)).rejects.toThrow(
      "current root user turn",
    );
    expect(runtime.goalCreation).toBeUndefined();
    await goal.close();
  });
}

for (const ending of ["completed", "failed", "stop"] as const) {
  test(`an ordinary user turn suspends an active goal and resumes it only on success: ${ending}`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "goal-user-turn-"));
    dirs.push(dir);
    let wakes = 0;
    const goal = await GoalController.open(await openGoalStore(dir, "thread"), "thread", {
      changed: async () => {},
      wake: () => {
        wakes++;
      },
    });
    await goal.change(
      { action: "set", objective: "Keep the suite green" },
      { idle: true, enabled: true, mode: "default" },
    );
    wakes = 0;
    const model = { provider: "anthropic" as const, modelId: "claude-sonnet-5" };
    const { promise: finish, resolve: release } = Promise.withResolvers<void>();
    const runtime = {
      id: "thread",
      cwd: dir,
      model,
      mode: "default",
      effort: "medium",
      goal,
      abortController: null,
      currentTurnId: null,
      isRunning: false,
      manager: {
        getCurrentModel: () => model,
        runWithOutcome: async () => {
          await finish;
          return ending === "failed"
            ? { status: "failed", error: { name: "Error", message: "provider failed" } }
            : { status: "completed" };
        },
      },
    } as unknown as ThreadRuntime;
    const ctx = {
      resolveThreadRuntime: async () => runtime,
      ensureGoal: async () => goal,
      getGoalsConfig: () => undefined,
      getSkillNames: () => [],
      getPluginHooks: async () => ({ onUserPromptSubmit: [] }),
      getUserId: () => "user",
      emit: async () => {},
      consumeTurn: async (_runtime: ThreadRuntime, run: Promise<void>) => {
        await run;
        resetTurnRuntimeState(runtime);
        return undefined;
      },
    } as unknown as ThreadHandlersContext;
    await handleTurnStart(ctx, { threadId: runtime.id, message: "Also fix the README" }, "peer", new Map());
    expect(goal.read().goal).toMatchObject({ status: "paused", reason: "user_turn" });
    if (ending === "stop") await handleTurnInterrupt(ctx, runtime.id);
    const work = runtime.turnWork;
    release();
    await work;
    await goal.flush();
    if (ending === "completed") {
      expect(goal.read().goal).toMatchObject({ status: "active", reason: undefined });
      expect(wakes).toBe(1);
    } else {
      expect(goal.read().goal).toMatchObject({ status: "paused", reason: ending === "stop" ? "user" : "user_turn" });
      expect(wakes).toBe(0);
    }
    await goal.close();
  });
}
