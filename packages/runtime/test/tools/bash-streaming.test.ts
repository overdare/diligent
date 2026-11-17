// @summary Tests for bash process-group termination and live output streaming through tool updates
import { describe, expect, test } from "bun:test";
import type { ToolContext } from "@diligent/core/tool-contract";
import { createBashTool } from "@diligent/runtime/tools";

const bashTool = createBashTool(process.cwd());
const posix = process.platform !== "win32";

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Process death is an OS event with no completion signal to await, so poll until a bounded deadline.
async function waitUntilDead(pid: number, deadlineMs = 3000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    if (!isAlive(pid)) return true;
    await Bun.sleep(25);
  }
  return !isAlive(pid);
}

describe.if(posix)("bash process groups", () => {
  test("a timeout also kills processes the shell started", async () => {
    const result = await bashTool.execute(
      { command: "sleep 30 & echo $!; wait", timeout: 500 },
      { toolCallId: "tc", signal: new AbortController().signal, abort: () => {} },
    );
    const pid = Number(result.output.match(/^(\d+)$/m)?.[1]);

    expect(result.metadata?.timedOut).toBe(true);
    expect(pid).toBeGreaterThan(0);
    expect(await waitUntilDead(pid)).toBe(true);
  });

  test("an abort also kills processes the shell started", async () => {
    const controller = new AbortController();
    const updates: string[] = [];
    const ctx: ToolContext = {
      toolCallId: "tc",
      signal: controller.signal,
      abort: () => {},
      onUpdate: (partial) => {
        updates.push(partial);
        controller.abort();
      },
    };
    const result = await bashTool.execute({ command: "sleep 30 & echo $!; wait" }, ctx);
    const pid = Number(result.output.match(/^(\d+)$/m)?.[1]);

    expect(result.metadata?.aborted).toBe(true);
    expect(pid).toBeGreaterThan(0);
    expect(await waitUntilDead(pid)).toBe(true);
  });
});

describe.if(posix)("bash live output", () => {
  test("streams output while the command is still running", async () => {
    const updates: string[] = [];
    let finished = false;
    let updatedBeforeFinish = false;
    const ctx: ToolContext = {
      toolCallId: "tc",
      signal: new AbortController().signal,
      abort: () => {},
      onUpdate: (partial) => {
        updates.push(partial);
        if (!finished) updatedBeforeFinish = true;
      },
    };
    const result = await bashTool.execute({ command: "printf first; sleep 1; printf second" }, ctx);
    finished = true;

    expect(result.output).toBe("firstsecond");
    expect(updatedBeforeFinish).toBe(true);
    expect(updates[0]).toBe("first");
    expect("firstsecond".startsWith(updates.join(""))).toBe(true);
  });

  test("caps each update and marks the bytes it skipped", async () => {
    const updates: string[] = [];
    const ctx: ToolContext = {
      toolCallId: "tc",
      signal: new AbortController().signal,
      abort: () => {},
      onUpdate: (partial) => updates.push(partial),
    };
    await bashTool.execute({ command: "head -c 200000 /dev/zero | tr '\\0' x; sleep 0.5" }, ctx);

    expect(updates.length).toBeGreaterThan(0);
    for (const update of updates) expect(update.length).toBeLessThanOrEqual(8 * 1024 + 64);
    expect(updates.some((update) => /\[… \d+ characters …\]/.test(update))).toBe(true);
  });
});
