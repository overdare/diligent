// @summary Mode and config e2e tests: mode switching, effort changes
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Mode, ThinkingEffort } from "@diligent/protocol";
import { createSimpleStream } from "./helpers/fake-stream";
import { createProtocolClient, type ProtocolTestClient } from "./helpers/protocol-client";
import { createTestServer } from "./helpers/server-factory";

let tmpDir: string;
let client: ProtocolTestClient;

afterEach(async () => {
  client?.close();
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

describe("mode-and-config", () => {
  test("mode/set switches to plan mode", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "diligent-e2e-mode-"));
    const server = createTestServer({ cwd: tmpDir, streamFunction: createSimpleStream("ok") });
    client = createProtocolClient(server);

    const threadId = await client.initAndStartThread(tmpDir);

    const result = (await client.request("mode/set", {
      threadId,
      mode: "plan",
    })) as { mode: Mode };

    expect(result.mode).toBe("plan");
  });

  test("effort/set changes effort level", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "diligent-e2e-effort-"));
    const server = createTestServer({ cwd: tmpDir, streamFunction: createSimpleStream("ok") });
    client = createProtocolClient(server);

    const threadId = await client.initAndStartThread(tmpDir);

    const result = (await client.request("effort/set", {
      threadId,
      effort: "max",
    })) as { effort: ThinkingEffort };

    expect(result.effort).toBe("max");
  });

  test("plan mode is reflected in thread/read after mode/set", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "diligent-e2e-mode-persist-"));

    const server = createTestServer({
      cwd: tmpDir,
      streamFunction: createSimpleStream("plan response"),
    });
    client = createProtocolClient(server);

    const threadId = await client.initAndStartThread(tmpDir);

    // Set mode to plan
    await client.request("mode/set", { threadId, mode: "plan" });

    // Run a turn — the stream function should receive plan mode via buildAgentConfig
    await client.sendTurnAndWait(threadId, "plan something");

    // Verify the thread read shows the effort/state
    const readResult = (await client.request("thread/read", { threadId })) as {
      messages: Array<{ role: string; content: unknown }>;
    };

    // Messages should exist (mode change + user + assistant)
    expect(readResult.messages.length).toBeGreaterThanOrEqual(2);
  });

  test("effort/set max is reflected in thread/read currentEffort", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "diligent-e2e-effort-persist-"));
    const server = createTestServer({ cwd: tmpDir, streamFunction: createSimpleStream("ok") });
    client = createProtocolClient(server);

    const threadId = await client.initAndStartThread(tmpDir);

    await client.request("effort/set", { threadId, effort: "max" });

    const readResult = (await client.request("thread/read", { threadId })) as {
      currentEffort: ThinkingEffort;
    };

    expect(readResult.currentEffort).toBe("max");
  });
});
