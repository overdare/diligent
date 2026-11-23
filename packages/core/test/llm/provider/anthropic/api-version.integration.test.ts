// @summary Real Anthropic SDK request contract for API version 2026-10-21, isolated from provider module mocks
import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("Messages, Files, and native compaction requests send 2026-10-21, keep X-Api-Key, and omit rejected fields", async () => {
  // Other provider tests mock @anthropic-ai/sdk process-wide. Use a fresh process to exercise the real SDK.
  const child = Bun.spawn(
    [process.execPath, fileURLToPath(new URL("../../../helpers/anthropic-api-version-wire.ts", import.meta.url))],
    { stdout: "pipe", stderr: "pipe", timeout: 10_000 },
  );
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
    expect(stdout.trim()).toBe("anthropic api version wire contract verified");
  } finally {
    child.kill();
  }
}, 15_000);
