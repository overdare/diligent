// @summary App-server session e2e tests for persistence, resume, lookup, and list preview
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProviderError, ProviderErrorType } from "@diligent/core/provider-contract";
import { DILIGENT_SERVER_NOTIFICATION_METHODS, type ThreadReadResponse } from "@diligent/protocol";
import type { StreamFunction } from "@diligent/runtime";
import { createSimpleStream } from "./helpers/fake-stream";
import { createProtocolClient, type ProtocolTestClient } from "./helpers/protocol-client";
import { createTestServer } from "./helpers/server-factory";

let tmpDir: string;
let client: ProtocolTestClient;

afterEach(async () => {
  client?.close();
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

describe("session-resume", () => {
  test("thread/resume by threadId restores context", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "diligent-e2e-resume-"));
    const streamFn = createSimpleStream("resumed ok");

    // First server instance: create thread and run a turn
    const server1 = createTestServer({ cwd: tmpDir, streamFunction: streamFn });
    const client1 = createProtocolClient(server1);

    const threadId = await client1.initAndStartThread(tmpDir);
    await client1.sendTurnAndWait(threadId, "hello from first server");
    client1.close();

    // Second server instance: resume the thread
    const server2 = createTestServer({ cwd: tmpDir, streamFunction: streamFn });
    client = createProtocolClient(server2);

    await client.request("initialize", {
      clientName: "test",
      clientVersion: "0.0.1",
      protocolVersion: 1,
    });

    const result = (await client.request("thread/resume", { threadId })) as {
      found: boolean;
      threadId?: string;
      context?: unknown[];
    };

    expect(result.found).toBe(true);
    expect(result.threadId).toBe(threadId);
    expect(result.context).toBeInstanceOf(Array);
    expect(result.context!.length).toBeGreaterThan(0);
  });

  test("thread/resume mostRecent returns latest thread", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "diligent-e2e-resume-recent-"));
    const streamFn = createSimpleStream("ok");

    const server1 = createTestServer({ cwd: tmpDir, streamFunction: streamFn });
    const client1 = createProtocolClient(server1);

    // Create two threads
    const threadId1 = await client1.initAndStartThread(tmpDir);
    await client1.sendTurnAndWait(threadId1, "first thread");

    const threadId2 = await client1.initAndStartThread(tmpDir);
    await client1.sendTurnAndWait(threadId2, "second thread");
    client1.close();

    // Resume mostRecent on new server
    const server2 = createTestServer({ cwd: tmpDir, streamFunction: streamFn });
    client = createProtocolClient(server2);

    await client.request("initialize", {
      clientName: "test",
      clientVersion: "0.0.1",
      protocolVersion: 1,
    });

    const result = (await client.request("thread/resume", { mostRecent: true })) as {
      found: boolean;
      threadId?: string;
    };

    expect(result.found).toBe(true);
    expect(result.threadId).toBe(threadId2);
  });

  test("thread/resume non-existent threadId returns found:false", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "diligent-e2e-resume-404-"));

    const server = createTestServer({ cwd: tmpDir });
    client = createProtocolClient(server);

    await client.request("initialize", {
      clientName: "test",
      clientVersion: "0.0.1",
      protocolVersion: 1,
    });

    const result = (await client.request("thread/resume", {
      threadId: "99999999999999999-ffffff",
    })) as { found: boolean };

    expect(result.found).toBe(false);
  });

  test("thread/list includes firstUserMessage preview after turn", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "diligent-e2e-resume-preview-"));

    const server = createTestServer({ cwd: tmpDir, streamFunction: createSimpleStream("ok") });
    client = createProtocolClient(server);

    const threadId = await client.initAndStartThread(tmpDir);
    await client.sendTurnAndWait(threadId, "my first message");

    const result = (await client.request("thread/list", { limit: 100 })) as {
      data: Array<{ id: string; firstUserMessage?: string }>;
    };

    const thread = result.data.find((t) => t.id === threadId);
    expect(thread).toBeTruthy();
    expect(thread!.firstUserMessage).toContain("my first message");
  });

  test("thread/read restores a failed turn's error at its transcript position after restart", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "diligent-e2e-resume-error-"));
    let calls = 0;
    const succeed = createSimpleStream("recovered");
    const streamFn: StreamFunction = (model, context, options) => {
      calls += 1;
      if (calls === 1) {
        throw new ProviderError("socket closed unexpectedly", {
          errorType: ProviderErrorType.Network,
          isRetryable: false,
        });
      }
      return succeed(model, context, options);
    };

    const server1 = createTestServer({ cwd: tmpDir, streamFunction: streamFn });
    const client1 = createProtocolClient(server1);
    const threadId = await client1.initAndStartThread(tmpDir);
    const failedTurn = await client1.sendTurnAndWait(threadId, "first request");
    await client1.sendTurnAndWait(threadId, "second request");
    client1.close();

    const liveError = failedTurn.flatMap((notification) =>
      notification.method === DILIGENT_SERVER_NOTIFICATION_METHODS.AGENT_EVENT &&
      notification.params.event.type === "error"
        ? [notification.params.event.error]
        : [],
    );
    expect(liveError).toHaveLength(1);
    expect(liveError[0]?.presentation?.recovery).toEqual({ kind: "retry" });

    const server2 = createTestServer({ cwd: tmpDir, streamFunction: streamFn });
    client = createProtocolClient(server2);
    await client.request("initialize", {
      clientName: "test",
      clientVersion: "0.0.1",
      protocolVersion: 1,
    });
    const read = (await client.request("thread/read", { threadId })) as ThreadReadResponse;

    expect(read.items.map((item) => item.type)).toEqual(["userMessage", "error", "userMessage", "agentMessage"]);
    const [firstUser, errorItem, secondUser] = read.items;
    if (firstUser?.type !== "userMessage" || errorItem?.type !== "error" || secondUser?.type !== "userMessage") {
      throw new Error("expected user, error, user ordering");
    }
    expect(errorItem.error.message).toBe("socket closed unexpectedly");
    expect(errorItem.error.presentation).toEqual(liveError[0]?.presentation);
    expect(errorItem.timestamp).toBeGreaterThanOrEqual(firstUser.timestamp ?? Number.POSITIVE_INFINITY);
    expect(errorItem.timestamp).toBeLessThanOrEqual(secondUser.timestamp ?? 0);
  });
});
