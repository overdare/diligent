// @summary Runs real provider SDK instrumentation in a process isolated from global provider mocks.
import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("real OpenAI and Anthropic SDK failure and streaming contracts remain isolated from unit-test mocks", async () => {
  // Provider unit suites replace @anthropic-ai/sdk process-wide with mock.module.
  // A fresh process is necessary to prove attachment to the real SDK classes.
  const fixture = fileURLToPath(new URL("../fixtures/observability/model-instrumentation.case.ts", import.meta.url));
  const child = Bun.spawn([process.execPath, "run", fixture], { stdout: "pipe", stderr: "pipe", timeout: 10000 });
  try {
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expect(stdout.trim().split("\n")).toHaveLength(3);
    expect(stdout).toContain("passed: preserves Anthropic streaming and exports token usage without input or output");
    expect(stdout).toContain("passed: preserves OpenAI streaming and exports token usage without input or output");
  } finally {
    child.kill();
  }
}, 15000);
