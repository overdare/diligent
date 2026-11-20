// @summary Tests for bash process-group termination and live output streaming through tool updates

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@diligent/core/tool-contract";
import { createBashTool } from "@diligent/runtime/tools";

const bashTool = createBashTool(process.cwd());
const posix = process.platform !== "win32";

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    if (process.platform === "linux") {
      // An orphan can be a zombie until PID 1 reaps it. It cannot execute or hold pipes open.
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      return stat[stat.lastIndexOf(")") + 2] !== "Z";
    }
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
  test("foreground Bash cleans up descendants even when the shell exits successfully", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "diligent-foreground-bash-"));
    let pid = 0;
    try {
      const result = await createBashTool(cwd).execute(
        { command: "sleep 30 </dev/null >/dev/null 2>&1 & echo $! > child.pid" },
        { toolCallId: "tc", signal: new AbortController().signal, abort: () => {} },
      );
      pid = Number(readFileSync(join(cwd, "child.pid"), "utf8"));
      expect(pid).toBeGreaterThan(0);
      expect(result.metadata?.exitCode).toBe(0);
      expect(await waitUntilDead(pid, 500)).toBe(true);
    } finally {
      if (pid > 0 && isAlive(pid)) process.kill(pid, "SIGKILL");
      await rm(cwd, { recursive: true, force: true });
    }
  });

  test("a timeout forces a descendant to exit even after the shell handles SIGTERM", async () => {
    const result = await bashTool.execute(
      {
        command: `trap 'exit 42' TERM; sh -c 'trap "" TERM; echo "$$"; exec sleep 30' & wait`,
        timeout: 500,
      },
      { toolCallId: "tc", signal: new AbortController().signal, abort: () => {} },
    );
    const pid = Number(result.output.match(/^(\d+)$/m)?.[1]);

    expect(result.metadata?.timedOut).toBe(true);
    expect(result.metadata?.exitCode).toBe(42);
    expect(pid).toBeGreaterThan(0);
    expect(await waitUntilDead(pid, 500)).toBe(true);
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

  test("an abort lets the command handle SIGTERM", async () => {
    const controller = new AbortController();
    const result = await bashTool.execute(
      { command: `trap 'exit 42' TERM; echo ready; sleep 30 & wait`, timeout: 3000 },
      {
        toolCallId: "tc",
        signal: controller.signal,
        abort: () => {},
        onUpdate: (output) => {
          if (output.includes("ready")) controller.abort();
        },
      },
    );

    expect(result.metadata?.aborted).toBe(true);
    expect(result.metadata?.exitCode).toBe(42);
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
