// @summary Goal behavior through the public JSON-RPC boundary
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderEvent, ProviderResult } from "@diligent/core/provider-contract";
import type { ThreadGoalResponse } from "@diligent/protocol";
import type { StreamFunction } from "@diligent/runtime";
import { EventStream } from "@diligent/runtime";
import { createSimpleStream, createToolUseStream } from "./helpers/fake-stream";
import { createProtocolClient, type ProtocolTestClient } from "./helpers/protocol-client";
import { createTestServer } from "./helpers/server-factory";

const dirs: string[] = [];
const clients: ProtocolTestClient[] = [];
const servers: ReturnType<typeof createTestServer>[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  await Promise.all(servers.splice(0).map((server) => server.shutdown()));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function setup(streamFunction?: StreamFunction, enabled = true) {
  const cwd = await mkdtemp(join(tmpdir(), "goal-e2e-"));
  dirs.push(cwd);
  const server = createTestServer({
    cwd,
    streamFunction,
    runtimeToolsConfig: {},
    runtimeConfigOverrides: { diligent: { goals: { enabled } } },
  });
  const client = createProtocolClient(server);
  servers.push(server);
  clients.push(client);
  const threadId = await client.initAndStartThread(cwd);
  return { cwd, client, threadId, server };
}
async function setGoal(client: ProtocolTestClient, threadId: string, extra = {}) {
  return (await client.request("thread/goal/set", {
    threadId,
    action: "set",
    objective: "Verify the fix",
    ...extra,
  })) as ThreadGoalResponse;
}
test("automatic continuation stops at evidence-backed completion without fabricating user turns", async () => {
  const first = createSimpleStream("Need another step");
  const complete = createToolUseStream(
    [{ id: "done", name: "update_goal", input: { status: "complete", evidence: "Verification succeeded" } }],
    "Done",
  );
  let calls = 0;
  const { client, threadId, cwd } = await setup((...args) => (calls++ === 0 ? first : complete)(...args));
  await setGoal(client, threadId);
  await client.waitFor((n) => n.method === "thread/goal/updated" && n.params.goal?.status === "complete");
  await client.waitFor(
    (n) => n.method === "thread/goal/updated" && n.params.goal?.status === "complete" && n.params.goal.tokensUsed === 6,
  );
  const read = (await client.request("thread/read", { threadId })) as {
    items: Array<{ type: string }>;
    goal: { status: string; turnsUsed: number };
  };
  expect(read.goal).toMatchObject({ status: "complete", turnsUsed: 2 });
  expect(
    client.notifications.filter((n) => n.method === "agent/event" && n.params.event.type === "user_message"),
  ).toHaveLength(0);
  const transcript = (await readFile(join(cwd, ".diligent", "sessions", `${threadId}.jsonl`), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const inputs = transcript.filter((entry) => entry.type === "message" && entry.message.role === "user");
  expect(inputs.length).toBeGreaterThan(0);
  expect(inputs.every((entry) => entry.visibility === "internal" && entry.source === "goal")).toBe(true);
});
test("token budget aborts before the sampled tool callback can report completion", async () => {
  const { client, threadId } = await setup(
    createToolUseStream(
      [{ id: "done", name: "update_goal", input: { status: "complete", evidence: "Must not execute" } }],
      "Done",
    ),
  );
  await setGoal(client, threadId, { tokenBudget: 2 });
  await client.waitFor((n) => n.method === "thread/goal/updated" && n.params.goal?.status === "budget_limited");
  const result = (await client.request("thread/goal/get", { threadId })) as ThreadGoalResponse;
  expect(result.goal).toMatchObject({ status: "budget_limited", tokensUsed: 2 });
  expect(result.goal?.completionEvidence).toBeUndefined();
});
test("feature gate permits status reads but prevents creating goals", async () => {
  const { client, threadId } = await setup(undefined, false);
  expect(await client.request("thread/goal/get", { threadId })).toEqual({ goal: null, sequence: 0 });
  await expect(setGoal(client, threadId)).rejects.toThrow("disabled");
});
test("runtime stops three tool-free continuations without relying on model assertions", async () => {
  const { client, threadId } = await setup();
  await setGoal(client, threadId);
  await client.waitFor((n) => n.method === "thread/goal/updated" && n.params.goal?.status === "blocked");
  const result = (await client.request("thread/goal/get", { threadId })) as ThreadGoalResponse;
  expect(result.goal).toMatchObject({ status: "blocked", reason: "no_progress", turnsUsed: 3 });
});

test("Stop pauses the goal between runs and rejects stale client changes", async () => {
  const { client, threadId } = await setup();
  const initial = await setGoal(client, threadId);
  await client.waitForNotification("turn/completed");
  await client.request("turn/interrupt", { threadId });
  const paused = (await client.request("thread/goal/get", { threadId })) as ThreadGoalResponse;
  expect(paused.goal).toMatchObject({ status: "paused" });
  await expect(
    client.request("thread/goal/set", {
      threadId,
      action: "clear",
      expectedGoalId: initial.goal!.id,
      expectedRevision: initial.goal!.revision,
    }),
  ).rejects.toThrow("revision conflict");
  const cleared = (await client.request("thread/goal/set", {
    threadId,
    action: "clear",
    expectedGoalId: paused.goal!.id,
    expectedRevision: paused.goal!.revision,
  })) as ThreadGoalResponse;
  expect(cleared.goal).toBeNull();
  expect(cleared.sequence).toBeGreaterThan(paused.sequence);
});

test("pausing cancels unanswered questions and persists the paused state", async () => {
  const stream = createToolUseStream(
    [
      {
        id: "q",
        name: "request_user_input",
        input: {
          questions: [
            { id: "q", header: "Choice", question: "Which?", options: [{ label: "A", description: "Option A" }] },
          ],
        },
      },
    ],
    "Done",
  );
  const { client, threadId } = await setup(stream);
  let requested!: () => void;
  const pending = new Promise<void>((resolve) => {
    requested = resolve;
  });
  client.onServerRequest(async () => {
    requested();
    return await new Promise(() => {});
  });
  await setGoal(client, threadId);
  await pending;
  await client.request("turn/interrupt", { threadId });
  await client.waitForNotification("server/request/resolved");
  const result = (await client.request("thread/goal/get", { threadId })) as ThreadGoalResponse;
  expect(result.goal?.status).toBe("paused");
});

test("ordinary user input takes priority over a waiting automatic goal run", async () => {
  const stream = createToolUseStream(
    [
      {
        id: "q",
        name: "request_user_input",
        input: {
          questions: [
            { id: "q", header: "Choice", question: "Which?", options: [{ label: "A", description: "Option A" }] },
          ],
        },
      },
    ],
    "User request handled",
  );
  const { client, threadId } = await setup(stream);
  let requested!: () => void;
  const pending = new Promise<void>((resolve) => {
    requested = resolve;
  });
  client.onServerRequest(async () => {
    requested();
    return await new Promise(() => {});
  });
  await setGoal(client, threadId);
  await pending;
  await expect(client.request("turn/start", { threadId, message: "Work on this instead" })).resolves.toMatchObject({
    accepted: true,
  });
  await client.waitForNotification("turn/completed");
  const snapshot = (await client.request("thread/goal/get", { threadId })) as ThreadGoalResponse;
  expect(snapshot.goal).toMatchObject({ status: "paused", reason: "user_turn" });
  const read = (await client.request("thread/read", { threadId })) as { items: Array<{ type: string }> };
  expect(read.items.filter((item) => item.type === "userMessage")).toHaveLength(1);
});

test("child completion wakes the goal and child usage remains attributed after the parent run ends", async () => {
  let releaseChild!: () => Promise<void>;
  let rootCalls = 0;
  let childCalls = 0;
  const spawn = createToolUseStream(
    [{ id: "spawn", name: "spawn_agent", input: { message: "Inspect the implementation" } }],
    "Delegated",
  );
  const done = createToolUseStream(
    [{ id: "done", name: "update_goal", input: { status: "complete", evidence: "Child inspection finished" } }],
    "Done",
  );
  const simple = createSimpleStream("Inspected");
  const { client, threadId } = await setup((...args) => {
    if (args[1].tools.some((tool) => "name" in tool && tool.name === "get_goal"))
      return (rootCalls++ < 2 ? spawn : done)(...args);
    childCalls++;
    const stream = new EventStream<ProviderEvent, ProviderResult>(
      (event) => event.type === "done",
      (event) => ({ message: (event as Extract<ProviderEvent, { type: "done" }>).message }),
    );
    releaseChild = async () => {
      for await (const event of simple(...args)) stream.push(event);
    };
    args[2].signal?.addEventListener("abort", () => stream.error(new DOMException("Aborted", "AbortError")), {
      once: true,
    });
    return stream;
  });
  await setGoal(client, threadId);
  await client.waitForNotification("turn/completed");
  expect(rootCalls).toBe(2);
  expect(childCalls).toBe(1);
  await releaseChild();
  await client.waitFor(
    (n) =>
      n.method === "thread/goal/updated" && n.params.goal?.status === "complete" && n.params.goal.tokensUsed === 10,
  );
  const result = (await client.request("thread/goal/get", { threadId })) as ThreadGoalResponse;
  expect(result.goal).toMatchObject({ status: "complete", turnsUsed: 2, tokensUsed: 10 });
});

test("plan mode and shutdown pause goals and deleted threads remove the ledger", async () => {
  const { client, threadId, server, cwd } = await setup();
  await client.request("mode/set", { threadId, mode: "plan" });
  await expect(setGoal(client, threadId)).rejects.toThrow("plan mode");
  await client.request("mode/set", { threadId, mode: "default" });
  await setGoal(client, threadId);
  await server.shutdown();
  const ledgerPath = join(cwd, ".diligent", "sessions", "goals", `${threadId}.jsonl`);
  const records = (await readFile(ledgerPath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(records.at(-1).goal.status).toBe("paused");
  const restored = createTestServer({
    cwd,
    runtimeToolsConfig: {},
    runtimeConfigOverrides: { diligent: { goals: { enabled: true } } },
  });
  servers.push(restored);
  const restoredClient = createProtocolClient(restored);
  clients.push(restoredClient);
  await restoredClient.initAndStartThread(cwd);
  const snapshot = (await restoredClient.request("thread/goal/get", { threadId })) as ThreadGoalResponse;
  expect(snapshot.goal?.status).toBe("paused");
  expect(await restoredClient.request("thread/delete", { threadId })).toEqual({ deleted: true });
  await expect(readFile(ledgerPath)).rejects.toMatchObject({ code: "ENOENT" });
});
