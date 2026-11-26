// @summary Covers how goal turn failures settle as interrupted or failed depending on abort state
import { expect, test } from "bun:test";
import type { ThreadRuntime } from "../../src/app-server/thread-handlers";
import { handleTurnStart } from "../../src/app-server/turn-handlers";

type Settled = { status: string; error?: { message?: string } };

function goalHarness(run: (abortScope: () => void) => Promise<{ status: string }>) {
  const scopeController = new AbortController();
  const settled: Settled[] = [];
  const consumed: Promise<unknown>[] = [];
  const firstSettle = Promise.withResolvers<void>();
  const goal = {
    hasChildren: false,
    read: () => ({ goal: { status: "active" } }),
    waitForChildren: async () => {},
    beginRun: async () => ({
      signal: scopeController.signal,
      identity: "scope",
      recordUsage: () => {},
    }),
    settle: async (_scope: unknown, outcome: Settled) => {
      settled.push(outcome);
      firstSettle.resolve();
    },
    observe: () => {},
    pause: async () => {},
    wake: () => {},
  };
  const runtime = {
    id: "thread",
    cwd: "/tmp/project",
    mode: "default",
    effort: "medium",
    model: { provider: "anthropic", modelId: "claude-sonnet-5" },
    manager: {
      getCurrentModel: () => ({ provider: "anthropic", modelId: "claude-sonnet-5" }),
      appendModelChange: () => {},
      subscribe: () => () => {},
      runWithOutcome: () => run(() => scopeController.abort()),
    },
    abortController: null,
    currentTurnId: null,
    isRunning: false,
  } as unknown as ThreadRuntime;
  const ctx = {
    resolveThreadRuntime: async () => runtime,
    emit: async () => {},
    consumeTurn: async (_runtime: ThreadRuntime, runPromise: Promise<void>) => {
      consumed.push(runPromise);
      await runPromise.catch(() => {});
      return undefined;
    },
    getUserId: () => undefined,
  };
  const start = () =>
    handleTurnStart(ctx as never, { threadId: "thread", message: "continue goal" }, undefined, new Map(), {
      goal: goal as never,
    });
  return { start, settled, consumed, settledOnce: firstSettle.promise };
}

test("a goal run that rejects after its scope aborts settles as interrupted", async () => {
  const harness = goalHarness(async (abortScope) => {
    abortScope();
    throw new Error("stream closed");
  });
  await expect(harness.start()).resolves.toEqual({ accepted: true, userMessageId: undefined });
  await harness.settledOnce;
  expect(harness.settled).toEqual([{ status: "interrupted" }]);
});

test("a goal run that rejects without an abort settles as failed with the error", async () => {
  const harness = goalHarness(async () => {
    throw new Error("provider exploded");
  });
  await harness.start();
  await harness.settledOnce;
  expect(harness.settled).toHaveLength(1);
  expect(harness.settled[0]?.status).toBe("failed");
  expect(harness.settled[0]?.error?.message).toBe("provider exploded");
});

test("a synchronous start failure after the scope aborts settles as interrupted and only releases the goal admission", async () => {
  const harness = goalHarness((abortScope) => {
    abortScope();
    throw new Error("sync abort failure");
  });
  await expect(harness.start()).rejects.toThrow("sync abort failure");
  expect(harness.settled).toEqual([{ status: "interrupted" }]);
  expect(harness.consumed).toHaveLength(1);
  await expect(harness.consumed[0]).rejects.toThrow("Goal admission cancelled");
});

test("a synchronous start failure without abort settles as failed and consumes the original rejection first", async () => {
  const harness = goalHarness(() => {
    throw new Error("sync failure");
  });
  await expect(harness.start()).rejects.toThrow("sync failure");
  expect(harness.settled).toHaveLength(1);
  expect(harness.settled[0]?.status).toBe("failed");
  expect(harness.settled[0]?.error?.message).toBe("sync failure");
  expect(harness.consumed).toHaveLength(2);
  await expect(harness.consumed[0]).rejects.toThrow("sync failure");
  await expect(harness.consumed[1]).rejects.toThrow("Goal admission cancelled");
});
