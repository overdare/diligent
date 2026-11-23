// @summary App-server e2e tests for thread/name/set: list visibility, notification, unloaded threads, and clearing

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DILIGENT_SERVER_NOTIFICATION_METHODS, type SessionSummary, type ThreadReadResponse } from "@diligent/protocol";
import { createSimpleStream, createSlowStream } from "./helpers/fake-stream";
import { createProtocolClient, type ProtocolTestClient } from "./helpers/protocol-client";
import { createTestServer } from "./helpers/server-factory";

let tmpDir = "";
let client: ProtocolTestClient | undefined;

afterEach(async () => {
  client?.close();
  client = undefined;
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  tmpDir = "";
});

async function listedName(target: ProtocolTestClient, threadId: string): Promise<string | undefined> {
  const result = (await target.request("thread/list", { limit: 100 })) as { data: SessionSummary[] };
  const summary = result.data.find((thread) => thread.id === threadId);
  if (!summary) throw new Error(`thread ${threadId} is not listed`);
  return summary.name;
}

describe("thread/name/set", () => {
  test("names a loaded thread, notifies, and survives a restart", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "diligent-e2e-rename-"));
    const streamFunction = createSimpleStream("ok");
    const first = createProtocolClient(createTestServer({ cwd: tmpDir, streamFunction }));
    client = first;
    const threadId = await first.initAndStartThread(tmpDir);
    await first.sendTurnAndWait(threadId, "triage the flaky test");

    expect(await first.request("thread/name/set", { threadId, name: "  Flaky test triage  " })).toEqual({});
    const updated = await first.waitForNotification(DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_NAME_UPDATED);
    expect(updated.params).toEqual({ threadId, name: "Flaky test triage" });
    expect(await listedName(first, threadId)).toBe("Flaky test triage");

    // The rename rewrote the file; later turns must still append to it and earlier turns must survive.
    await first.sendTurnAndWait(threadId, "second request after rename");
    const read = (await first.request("thread/read", { threadId })) as ThreadReadResponse;
    const userTexts = read.items.flatMap((item) =>
      item.type === "userMessage" && typeof item.message.content === "string" ? [item.message.content] : [],
    );
    expect(userTexts).toEqual(["triage the flaky test", "second request after rename"]);
    first.close();

    const second = createProtocolClient(createTestServer({ cwd: tmpDir, streamFunction }));
    client = second;
    await second.initAndStartThread(tmpDir);
    expect(await listedName(second, threadId)).toBe("Flaky test triage");
  });

  test("names a thread that is only on disk and clears a name with an empty string", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "diligent-e2e-rename-disk-"));
    const streamFunction = createSimpleStream("ok");
    const first = createProtocolClient(createTestServer({ cwd: tmpDir, streamFunction }));
    client = first;
    const threadId = await first.initAndStartThread(tmpDir);
    await first.sendTurnAndWait(threadId, "write the release notes");
    first.close();

    const second = createProtocolClient(createTestServer({ cwd: tmpDir, streamFunction }));
    client = second;
    await second.initAndStartThread(tmpDir);

    await second.request("thread/name/set", { threadId, name: "Release notes" });
    expect(await listedName(second, threadId)).toBe("Release notes");

    await second.request("thread/name/set", { threadId, name: "" });
    expect(await listedName(second, threadId)).toBeUndefined();
  });

  test("rejects unknown threads and names longer than 120 characters", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "diligent-e2e-rename-invalid-"));
    client = createProtocolClient(createTestServer({ cwd: tmpDir, streamFunction: createSimpleStream("ok") }));
    const threadId = await client.initAndStartThread(tmpDir);

    await expect(client.request("thread/name/set", { threadId: "missing-thread", name: "x" })).rejects.toThrow();
    await expect(client.request("thread/name/set", { threadId, name: "x".repeat(121) })).rejects.toThrow();
  });

  test("refuses to rename a thread while its turn is running", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "diligent-e2e-rename-running-"));
    client = createProtocolClient(createTestServer({ cwd: tmpDir, streamFunction: createSlowStream("working", 50) }));
    const threadId = await client.initAndStartThread(tmpDir);
    await client.request("thread/subscribe", { threadId });
    await client.request("turn/start", { threadId, message: "long task" });
    await client.waitForNotification(DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_STARTED);

    await expect(client.request("thread/name/set", { threadId, name: "Renamed mid-turn" })).rejects.toThrow(
      "currently running",
    );
  });
});
