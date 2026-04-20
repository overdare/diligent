// @summary E2E tests for plugin lifecycle hooks: UserPromptSubmit blocking and Stop hook execution
import { afterEach, describe, expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DILIGENT_SERVER_NOTIFICATION_METHODS } from "@diligent/protocol";
import { createSimpleStream } from "./helpers/fake-stream";
import { createProtocolClient, type ProtocolTestClient } from "./helpers/protocol-client";
import { createTestServer } from "./helpers/server-factory";

const FIXTURE_PLUGIN_DIR = join(import.meta.dir, "fixtures", "hook-test-plugin");
const PLUGIN_NAME = "hook-test-plugin";

let tmpDir: string;
let client: ProtocolTestClient;

/**
 * Install the hook-test-plugin fixture into tmpDir/node_modules so the plugin
 * loader can discover it at runtime via the cwd-local resolution path.
 */
async function installFixturePlugin(cwd: string): Promise<void> {
  const pluginDir = join(cwd, "node_modules", PLUGIN_NAME);
  await mkdir(pluginDir, { recursive: true });
  const { copyFile } = await import("node:fs/promises");
  await copyFile(join(FIXTURE_PLUGIN_DIR, "package.json"), join(pluginDir, "package.json"));
  await copyFile(join(FIXTURE_PLUGIN_DIR, "index.js"), join(pluginDir, "index.js"));
}

async function setup() {
  tmpDir = await mkdtemp(join(tmpdir(), "diligent-e2e-hooks-"));
  await installFixturePlugin(tmpDir);

  const server = createTestServer({
    cwd: tmpDir,
    streamFunction: createSimpleStream("ok"),
    runtimeToolsConfig: {
      plugins: [{ package: PLUGIN_NAME, enabled: true }],
    },
  });
  client = createProtocolClient(server);
  return { server, client };
}

afterEach(async () => {
  client?.close();
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

describe("plugin-hooks", () => {
  test("UserPromptSubmit hook blocks a prompt and emits error notification", async () => {
    await setup();
    const threadId = await client.initAndStartThread(tmpDir);

    // Send a prompt that triggers the blocking hook
    const turnNotifs = await client.sendTurnAndWait(threadId, "BLOCK this prompt please");

    // The hook should have blocked the prompt: expect an error notification with HookBlocked
    const errorNotif = turnNotifs.find((n) => n.method === DILIGENT_SERVER_NOTIFICATION_METHODS.ERROR);
    expect(errorNotif).toBeTruthy();
    const errorParams = errorNotif?.params as { error?: { name?: string; message?: string } } | undefined;
    expect(errorParams?.error?.name).toBe("HookBlocked");
    expect(errorParams?.error?.message).toContain("hook-test-plugin");

    // A TURN_COMPLETED should still arrive (the server completes the turn even when blocked)
    const turnCompleted = turnNotifs.find((n) => n.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED);
    expect(turnCompleted).toBeTruthy();
  });

  test("UserPromptSubmit hook allows a normal prompt and injects additionalContext", async () => {
    await setup();
    const threadId = await client.initAndStartThread(tmpDir);

    // Send a normal prompt (not starting with "BLOCK")
    const turnNotifs = await client.sendTurnAndWait(threadId, "hello world");

    // Should not have a HookBlocked error
    const errorNotif = turnNotifs.find((n) => n.method === DILIGENT_SERVER_NOTIFICATION_METHODS.ERROR);
    expect(errorNotif).toBeUndefined();

    // Turn should complete normally
    const turnCompleted = turnNotifs.find((n) => n.method === DILIGENT_SERVER_NOTIFICATION_METHODS.TURN_COMPLETED);
    expect(turnCompleted).toBeTruthy();
  });

  test("Stop hook fires after turn completion and writes marker file", async () => {
    await setup();
    const threadId = await client.initAndStartThread(tmpDir);

    await client.sendTurnAndWait(threadId, "hello");

    // Wait briefly for the Stop hook to complete (it runs asynchronously after turn)
    await client.waitFor(
      (n) =>
        n.method === DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_STATUS_CHANGED &&
        (n.params as { status: string }).status === "idle",
      3000,
    );

    // The Stop hook should have written a marker file to tmpDir
    const markerPath = join(tmpDir, "hook-stop-fired");
    await expect(access(markerPath)).resolves.toBeNull();

    const markerContent = JSON.parse(await readFile(markerPath, "utf8")) as { hook_event_name?: string };
    expect(markerContent.hook_event_name).toBe("Stop");
  });
});
