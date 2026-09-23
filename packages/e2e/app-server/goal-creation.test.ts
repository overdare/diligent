// @summary Model-requested goal creation and successful-user-turn handoff through JSON-RPC
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDefaultModelRef } from "@diligent/core/model-registry";
import {
  ProviderError,
  ProviderErrorType,
  type ProviderEvent,
  type ProviderResult,
} from "@diligent/core/provider-contract";
import type { ThreadGoalResponse } from "@diligent/protocol";
import { EventStream, ProviderManager, type StreamFunction } from "@diligent/runtime";
import { createSimpleStream, createToolUseStream } from "./helpers/fake-stream";
import { createProtocolClient, type ProtocolTestClient } from "./helpers/protocol-client";
import { createTestServer } from "./helpers/server-factory";

const resources: Array<{
  cwd: string;
  server: ReturnType<typeof createTestServer>;
  client: ProtocolTestClient;
}> = [];
afterEach(async () => {
  for (const { cwd, server, client } of resources.splice(0)) {
    client.close();
    await server.shutdown();
    await rm(cwd, { recursive: true, force: true });
  }
});
async function setup(streamFunction = createSimpleStream("ok"), enabled?: boolean) {
  const cwd = await mkdtemp(join(tmpdir(), "goal-create-e2e-"));
  const server = createTestServer({
    cwd,
    streamFunction,
    runtimeToolsConfig: {},
    runtimeConfigOverrides: {
      providerManager: new ProviderManager({
        auth: { anthropic: { isConfigured: () => true, getStream: () => streamFunction } },
      }),
      ...(enabled === undefined ? {} : { diligent: { goals: { enabled } } }),
    },
  });
  const client = createProtocolClient(server);
  resources.push({ cwd, server, client });
  const threadId = await client.initAndStartThread(cwd);
  return { cwd, server, client, threadId };
}
const requestGoal = () =>
  createToolUseStream(
    [{ id: "create", name: "create_goal", input: { objective: "Verify the fix", maxTurns: 3, tokenBudget: 30 } }],
    "Goal requested",
  );
const finishGoal = () =>
  createToolUseStream(
    [{ id: "done", name: "update_goal", input: { status: "complete", evidence: "Verification passed" } }],
    "Done",
  );
async function readGoal(client: ProtocolTestClient, threadId: string) {
  return (await client.request("thread/goal/get", { threadId })) as ThreadGoalResponse;
}

test("goal RPC executes with no goals configuration, but ordinary turns stay ordinary", async () => {
  const { client, threadId } = await setup();
  await client.sendTurnAndWait(threadId, "Explain this code");
  expect((await readGoal(client, threadId)).goal).toBeNull();
  await client.request("thread/goal/set", { threadId, action: "set", objective: "Verify", maxTurns: 1 });
  await client.waitFor((n) => n.method === "thread/goal/updated" && n.params.goal?.status === "budget_limited");
  expect((await readGoal(client, threadId)).goal).toMatchObject({ turnsUsed: 1, reason: "turn_limit" });
});

test("model creation hands off after the user turn, excluding its usage from the goal", async () => {
  const create = requestGoal();
  const finish = finishGoal();
  let calls = 0;
  const { client, threadId, cwd } = await setup((...args) => (calls++ < 2 ? create : finish)(...args));
  await client.sendTurnAndWait(threadId, "Keep working until the fix is verified");
  await client.waitFor(
    (n) => n.method === "thread/goal/updated" && n.params.goal?.status === "complete" && n.params.goal.tokensUsed === 4,
  );
  expect((await readGoal(client, threadId)).goal).toMatchObject({
    objective: "Verify the fix",
    turnsUsed: 1,
    tokensUsed: 4,
    tokenBudget: 30,
    maxTurns: 3,
    completionEvidence: "Verification passed",
  });
  expect(calls).toBe(4);
  const transcript = (await readFile(join(cwd, ".diligent", "sessions", `${threadId}.jsonl`), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const userInputs = transcript.filter((entry) => entry.type === "message" && entry.message.role === "user");
  expect(userInputs.filter((entry) => entry.visibility !== "internal")).toHaveLength(1);
  expect(userInputs.length).toBeGreaterThan(1);
  expect(userInputs.slice(1).every((entry) => entry.visibility === "internal" && entry.source === "goal")).toBe(true);
  const completed = client.notifications.findIndex((n) => n.method === "turn/completed");
  const created = client.notifications.findIndex((n) => n.method === "thread/goal/updated" && n.params.goal !== null);
  expect(created).toBeGreaterThan(completed);
});

/** Hold the originating reply after create_goal has returned, without relying on timers. */
function heldReply() {
  let release!: () => void;
  let fail!: () => void;
  let ready!: () => void;
  const waiting = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const create = requestGoal();
  const finish = finishGoal();
  let calls = 0;
  const stream: StreamFunction = (...args) => {
    if (calls++ === 0) return create(...args);
    if (calls > 2) return finish(...args);
    const result = new EventStream<ProviderEvent, ProviderResult>(
      (e) => e.type === "done" || e.type === "error",
      (e) => {
        if (e.type === "error") throw e.error;
        return { message: (e as Extract<ProviderEvent, { type: "done" }>).message };
      },
    );
    release = () =>
      result.push({
        type: "done",
        stopReason: "end_turn",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Requested" }],
          model: { provider: "anthropic", modelId: "claude-sonnet-5" },
          usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
          stopReason: "end_turn",
          timestamp: Date.now(),
        },
      });
    fail = () =>
      result.push({ type: "error", error: new ProviderError("Origin reply failed", ProviderErrorType.Unknown, false) });
    args[2].signal?.addEventListener(
      "abort",
      () => result.push({ type: "error", error: new DOMException("Stopped", "AbortError") }),
      { once: true },
    );
    ready();
    return result as never;
  };
  return { stream, waiting, release: () => release(), fail: () => fail(), calls: () => calls };
}

test("accepted creation stays pending until the originating turn succeeds", async () => {
  const held = heldReply();
  const { client, threadId } = await setup(held.stream);
  const turn = client.sendTurnAndWait(threadId, "Continue until verified");
  await held.waiting;
  expect((await readGoal(client, threadId)).goal).toBeNull();
  const events = client.notifications.filter((n) => n.method === "agent/event").map((n) => n.params.event);
  expect(JSON.stringify(events)).toContain('\\"status\\":\\"pending\\"');
  held.release();
  await turn;
  await client.waitFor((n) => n.method === "thread/goal/updated" && n.params.goal?.status === "complete");
});

for (const ending of [
  "interrupt",
  "failure",
  "disconnect",
  "plan",
  "steer",
  "goal control",
  "config reload",
  "model change",
  "effort change",
  "thread deletion",
] as const) {
  test(`${ending} discards a pending creation instead of launching automatic work`, async () => {
    const held = heldReply();
    const { client, threadId, server, cwd } = await setup(held.stream);
    const turn =
      ending === "disconnect"
        ? client.request("turn/start", { threadId, message: "Continue until verified" })
        : client.sendTurnAndWait(threadId, "Continue until verified");
    await held.waiting;
    expect(JSON.stringify(client.notifications)).toContain('\\"status\\":\\"pending\\"');
    if (ending === "interrupt") await client.request("turn/interrupt", { threadId });
    else if (ending === "failure") held.fail();
    else if (ending === "plan") {
      await client.request("mode/set", { threadId, mode: "plan" });
      held.release();
    } else if (ending === "steer") {
      await client.request("turn/steer", { threadId, content: "Only explain; do not start a goal" });
      held.release();
    } else if (ending === "goal control") {
      await expect(
        client.request("thread/goal/set", { threadId, action: "set", objective: "Replacement" }),
      ).rejects.toThrow("running turn");
      held.release();
    } else if (ending === "config reload") {
      await client.request("config/reload", {});
      held.release();
    } else if (ending === "model change") {
      await client.request("config/set", { threadId, model: getDefaultModelRef("anthropic") });
      held.release();
    } else if (ending === "effort change") {
      await client.request("effort/set", { threadId, effort: "low" });
      held.release();
    } else if (ending === "thread deletion") {
      await expect(client.request("thread/delete", { threadId })).rejects.toThrow("currently running");
      held.release();
    } else {
      client.close();
      held.release();
    }
    if (ending === "disconnect") {
      // Shutdown waits for all turn cleanup; reconnect only afterwards to inspect durable state.
      await server.shutdown();
      const reopened = createTestServer({ cwd, runtimeToolsConfig: {} });
      const reader = createProtocolClient(reopened);
      resources.push({ cwd, server: reopened, client: reader });
      await reader.initAndStartThread(cwd);
      expect((await readGoal(reader, threadId)).goal).toBeNull();
      await turn;
    } else {
      await turn;
      // A subsequent user turn waits for the preceding execution's cleanup.
      await client.sendTurnAndWait(threadId, "Explain what happened");
      expect((await readGoal(client, threadId)).goal).toBeNull();
    }
    expect(client.notifications.some((n) => n.method === "thread/goal/updated" && n.params.goal !== null)).toBe(false);
  });
}

test("explicitly disabled goals reject model creation as well as RPC creation", async () => {
  const { client, threadId } = await setup(requestGoal(), false);
  await client.sendTurnAndWait(threadId, "Continue until verified");
  expect((await readGoal(client, threadId)).goal).toBeNull();
  expect(JSON.stringify(client.notifications)).toContain("disabled");
  await expect(client.request("thread/goal/set", { threadId, action: "set", objective: "Verify" })).rejects.toThrow(
    "disabled",
  );
});

test("originating client disconnect revokes pending creation even with another client connected", async () => {
  const held = heldReply();
  const { client, threadId, server, cwd } = await setup(held.stream);
  const observer = createProtocolClient(server);
  // Share server cleanup, but close the additional peer independently.
  try {
    await observer.initAndStartThread(cwd);
    await observer.request("thread/subscribe", { threadId });
    await client.request("turn/start", { threadId, message: "Continue until verified" });
    await held.waiting;
    expect(JSON.stringify(observer.notifications)).toContain('\\"status\\":\\"pending\\"');
    client.close();
    held.release();
    await observer.waitForNotification("turn/completed");
    await observer.sendTurnAndWait(threadId, "Explain what happened");
    expect((await readGoal(observer, threadId)).goal).toBeNull();
    expect(observer.notifications.some((n) => n.method === "thread/goal/updated" && n.params.goal !== null)).toBe(
      false,
    );
  } finally {
    observer.close();
  }
});

test("duplicate and internal creation cannot replace the accepted objective", async () => {
  const create = createToolUseStream(
    [
      { id: "first", name: "create_goal", input: { objective: "Original" } },
      { id: "duplicate", name: "create_goal", input: { objective: "Replacement" } },
    ],
    "Requested",
  );
  const internalCreate = requestGoal();
  const finish = finishGoal();
  let calls = 0;
  const { client, threadId } = await setup((...args) => {
    const index = calls++;
    return (index < 2 ? create : index === 2 ? internalCreate : finish)(...args);
  });
  await client.sendTurnAndWait(threadId, "Keep going until verified");
  await client.waitFor((n) => n.method === "thread/goal/updated" && n.params.goal?.status === "complete");
  expect((await readGoal(client, threadId)).goal).toMatchObject({ objective: "Original", turnsUsed: 1 });
  const outputs = client.notifications.flatMap((n) =>
    n.method === "agent/event" && n.params.event.type === "tool_end" ? [n.params.event] : [],
  );
  expect(outputs.find((e) => e.toolCallId === "duplicate")).toMatchObject({ isError: true });
  expect(outputs.find((e) => e.toolCallId === "create")).toMatchObject({ isError: true });
});

test("model creation cannot replace an existing completed goal", async () => {
  const done = finishGoal();
  const create = requestGoal();
  let calls = 0;
  const { client, threadId } = await setup((...args) => (calls++ < 2 ? done : create)(...args));
  await client.request("thread/goal/set", { threadId, action: "set", objective: "Original" });
  await client.waitForNotification("turn/completed");
  const previous = await readGoal(client, threadId);
  await client.sendTurnAndWait(threadId, "Keep going with another goal");
  expect((await readGoal(client, threadId)).goal).toMatchObject({
    id: previous.goal!.id,
    objective: "Original",
    status: "complete",
    turnsUsed: 1,
    tokensUsed: 4,
  });
  expect(JSON.stringify(client.notifications)).toContain("A goal already exists");
});
