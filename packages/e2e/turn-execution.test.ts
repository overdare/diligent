// @summary Turn execution e2e tests: notification sequences, tool use, persistence, multi-turn
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool } from "@diligent/core";
import { DILIGENT_SERVER_NOTIFICATION_METHODS } from "@diligent/protocol";
import { z } from "zod";
import { createSimpleStream, createToolUseStream } from "./helpers/fake-stream";
import { createProtocolClient, type ProtocolTestClient } from "./helpers/protocol-client";
import { createTestServer } from "./helpers/server-factory";

const echoTool: Tool = {
  name: "test_tool",
  description: "Echo tool for testing",
  parameters: z.object({ arg: z.string() }),
  async execute(args) {
    return { output: `echo: ${args.arg}` };
  },
};

let tmpDir: string;
let client: ProtocolTestClient;

async function setup(opts?: { streamFunction?: ReturnType<typeof createSimpleStream>; tools?: Tool[] }) {
  tmpDir = await mkdtemp(join(tmpdir(), "diligent-e2e-turn-"));
  const server = createTestServer({
    cwd: tmpDir,
    streamFunction: opts?.streamFunction,
    tools: opts?.tools,
  });
  client = createProtocolClient(server);
  return { server, client };
}

afterEach(async () => {
  client?.close();
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

describe("turn-execution", () => {
  test("text turn produces correct notification sequence", async () => {
    await setup({ streamFunction: createSimpleStream("hello world") });
    const threadId = await client.initAndStartThread(tmpDir);

    await client.sendTurnAndWait(threadId, "say hello");

    // Wait for idle status (arrives after turn/completed in the finally block)
    await client.waitFor(
      (n) =>
        n.method === DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_STATUS_CHANGED &&
        (n.params as { status: string }).status === "idle",
    );

    const allNotifs = client.notifications;
    const methods = allNotifs.map((n) => n.method);

    // Expected sequence: status→busy, turn/started, item/started(user), item/completed(user),
    // item/started(agent), item/delta, item/completed(agent), turn/completed, status→idle
    // Note: turn initiator doesn't receive userMessage item notifications
    expect(methods).toContain(DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_STATUS_CHANGED);
    expect(methods).toContain(DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_STARTED);
    expect(methods).toContain(DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_STARTED);
    expect(methods).toContain(DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_DELTA);
    expect(methods).toContain(DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_COMPLETED);
    expect(methods).toContain(DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED);

    // Verify ordering: status(busy) before turn/started before turn/completed before status(idle)
    const busyIdx = allNotifs.findIndex(
      (n) =>
        n.method === DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_STATUS_CHANGED &&
        (n.params as { status: string }).status === "busy",
    );
    const turnStartedIdx = allNotifs.findIndex((n) => n.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_STARTED);
    const turnCompletedIdx = allNotifs.findIndex(
      (n) => n.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED,
    );
    const idleIdx = allNotifs.findIndex(
      (n) =>
        n.method === DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_STATUS_CHANGED &&
        (n.params as { status: string }).status === "idle",
    );

    expect(busyIdx).toBeLessThan(turnStartedIdx);
    expect(turnStartedIdx).toBeLessThan(turnCompletedIdx);
    expect(turnCompletedIdx).toBeLessThan(idleIdx);
  });

  test("tool use turn includes tool item notifications", async () => {
    const toolStream = createToolUseStream(
      [{ id: "tc-1", name: "test_tool", input: { arg: "value" } }],
      "done after tool",
    );
    await setup({ streamFunction: toolStream, tools: [echoTool] });
    const threadId = await client.initAndStartThread(tmpDir);

    const turnNotifs = await client.sendTurnAndWait(threadId, "use the tool");

    // Should have item/started with type=toolCall
    const toolStarted = turnNotifs.find(
      (n) =>
        n.method === DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_STARTED &&
        (n.params as { item?: { type?: string } }).item?.type === "toolCall",
    );
    expect(toolStarted).toBeTruthy();

    // Should have item/completed with type=toolCall
    const toolCompleted = turnNotifs.find(
      (n) =>
        n.method === DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_COMPLETED &&
        (n.params as { item?: { type?: string } }).item?.type === "toolCall",
    );
    expect(toolCompleted).toBeTruthy();
  });

  test("duplicate turn/start while running returns error", async () => {
    await setup({ streamFunction: createSimpleStream("slow response") });
    const threadId = await client.initAndStartThread(tmpDir);

    // Subscribe and start first turn
    await client.request("thread/subscribe", { threadId });
    await client.request("turn/start", { threadId, message: "first" });

    // Try starting another turn immediately — should fail
    try {
      await client.request("turn/start", { threadId, message: "second" });
      expect.unreachable("Should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("already running");
    }

    // Wait for first turn to finish
    await client.waitForNotification(DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED);
  });

  test("turn completion persists messages to thread/read", async () => {
    await setup({ streamFunction: createSimpleStream("persisted response") });
    const threadId = await client.initAndStartThread(tmpDir);

    await client.sendTurnAndWait(threadId, "hello");

    const result = (await client.request("thread/read", { threadId })) as {
      messages: Array<{ role: string }>;
    };

    // Should have user + assistant messages
    const roles = result.messages.map((m) => m.role);
    expect(roles).toContain("user");
    expect(roles).toContain("assistant");
  });

  test("multi-turn accumulates context", async () => {
    await setup({ streamFunction: createSimpleStream("response") });
    const threadId = await client.initAndStartThread(tmpDir);

    await client.sendTurnAndWait(threadId, "first message");
    await client.sendTurnAndWait(threadId, "second message");

    const result = (await client.request("thread/read", { threadId })) as {
      messages: Array<{ role: string }>;
    };

    // 2 user + 2 assistant = 4 messages minimum
    expect(result.messages.length).toBeGreaterThanOrEqual(4);
  });
});
