// @summary Real Anthropic SDK loopback coverage isolated from provider unit-test module mocks
import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("Sonnet 5.5 reaches /v1/messages with adaptive thinking, binding controls, tools, and images", async () => {
  // Other provider tests mock @anthropic-ai/sdk process-wide. Use a fresh process to exercise the real SDK.
  const child = Bun.spawn(
    [process.execPath, fileURLToPath(new URL("../../../helpers/sonnet-5-5-wire.ts", import.meta.url))],
    {
      stdout: "pipe",
      stderr: "pipe",
      timeout: 10_000,
    },
  );
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
    expect(stdout.trim()).toBe("Sonnet 5.5 loopback wire contract: 5 efforts verified");
  } finally {
    child.kill();
  }
}, 15_000);
