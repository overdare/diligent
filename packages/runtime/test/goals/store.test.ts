// @summary Goal ledger replay, deduplication, isolation and crash-tail recovery
import { afterEach, expect, test } from "bun:test";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ThreadGoal } from "@diligent/protocol";
import { openGoalStore } from "../../src/goals/store";

const dirs: string[] = [];
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "diligent-goals-"));
  dirs.push(dir);
  return { dir, store: await openGoalStore(dir, "test-session") };
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
function goalFixture(): ThreadGoal {
  return {
    id: "g1",
    threadId: "test-session",
    revision: 1,
    objective: "Fix auth",
    status: "active",
    maxTurns: 3,
    turnsUsed: 0,
    tokensUsed: 0,
    cacheReadTokens: 0,
    activeTimeMs: 0,
    accountingScope: "reported_agent_tokens",
    createdAt: 1,
    updatedAt: 1,
  };
}

test("serialized snapshots preserve clear history and monotonically ordered records on reopen", async () => {
  const { dir, store } = await setup();
  await Promise.all([
    store.append({ type: "snapshot", goal: goalFixture(), epoch: 1, revision: 1 }),
    store.append({ type: "snapshot", goal: null, epoch: 2, revision: 2 }),
  ]);
  await store.close();
  const reopened = await openGoalStore(dir, "test-session");
  expect(reopened.read()).toMatchObject({ goal: null, sequence: 2, epoch: 2, revision: 2 });
  expect((await readFile(join(dir, "goals/test-session.jsonl"), "utf8")).trim().split("\n")).toHaveLength(2);
});

test("usage replay excludes cached reads, deduplicates samples and never charges a replacement", async () => {
  const { dir, store } = await setup();
  await store.append({ type: "snapshot", goal: goalFixture(), epoch: 1, revision: 1 });
  const sample = {
    identity: { goalId: "g1", epoch: 1, outerRunId: "r1" },
    sessionId: "test-session",
    coreTurnId: "c1",
    inputTokens: 10,
    cacheWriteTokens: 2,
    outputTokens: 3,
    cacheReadTokens: 100,
  };
  await store.append({ type: "usage", sample });
  await store.close();
  const reopened = await openGoalStore(dir, "test-session");
  await reopened.append({ type: "usage", sample });
  expect(reopened.read().goal).toMatchObject({ tokensUsed: 15, cacheReadTokens: 100 });
  await reopened.append({ type: "snapshot", goal: { ...goalFixture(), id: "g2", revision: 2 }, epoch: 2, revision: 2 });
  await reopened.append({ type: "usage", sample: { ...sample, coreTurnId: "c2" } });
  expect(reopened.read().goal?.tokensUsed).toBe(0);
});

test("resuming the same child inside an outer run charges each child execution once", async () => {
  const { dir, store } = await setup();
  await store.append({ type: "snapshot", goal: goalFixture(), epoch: 1, revision: 1 });
  const sample = {
    identity: { goalId: "g1", epoch: 1, outerRunId: "outer" },
    sessionId: "child",
    coreTurnId: "turn-1",
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  await store.append({ type: "usage", sample: { ...sample, executionId: "first" } });
  await store.append({ type: "usage", sample: { ...sample, executionId: "resumed" } });
  await store.append({ type: "usage", sample: { ...sample, executionId: "resumed" } });
  expect(store.read().goal?.tokensUsed).toBe(30);
  await store.close();
  expect((await openGoalStore(dir, "test-session")).read().goal?.tokensUsed).toBe(30);
});

test("recovery discards only an unfinished final line and future appends remain replayable", async () => {
  const { dir, store } = await setup();
  await store.append({ type: "snapshot", goal: goalFixture(), epoch: 1, revision: 1 });
  await store.close();
  const path = join(dir, "goals/test-session.jsonl");
  await appendFile(path, '{"incomplete":');
  const reopened = await openGoalStore(dir, "test-session");
  await reopened.append({ type: "snapshot", goal: null, epoch: 2, revision: 2 });
  expect((await openGoalStore(dir, "test-session")).read().sequence).toBe(2);
  await appendFile(path, "bad-json\n");
  await expect(openGoalStore(dir, "test-session")).rejects.toThrow();
});

test("goal storage rejects traversal session IDs", async () => {
  const { dir } = await setup();
  await expect(openGoalStore(dir, "../outside")).rejects.toThrow("Invalid session ID");
});
