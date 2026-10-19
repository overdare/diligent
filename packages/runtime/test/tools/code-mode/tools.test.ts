// @summary Tests for code mode exec/exec_wait: tool exposure, nested dispatch, yielding, isolation, and termination
import { afterEach, describe, expect, test } from "bun:test";
import type { NestedToolEvent, Tool, ToolContext, ToolResult } from "@diligent/core/tool-contract";
import { applyCodeMode, CodeModeSession } from "@diligent/runtime/tools";
import { z } from "zod";

const sessions: CodeModeSession[] = [];

afterEach(() => {
  for (const session of sessions.splice(0)) session.dispose();
});

function makeTool(
  name: string,
  execute: (args: Record<string, unknown>) => Promise<ToolResult>,
  extra?: Partial<Tool>,
): Tool {
  return {
    name,
    description: `${name} tool`,
    parameters: z.object({ value: z.string().optional() }),
    execute: (args) => execute(args),
    ...extra,
  };
}

function makeCtx(
  toolCallId: string,
  events: NestedToolEvent[] = [],
  signal = new AbortController().signal,
): ToolContext {
  return { toolCallId, signal, abort: () => {}, emitNestedToolEvent: (event) => events.push(event) };
}

function setup(tools: Tool[], codeMode: "on" | "only" = "only") {
  const session = new CodeModeSession();
  sessions.push(session);
  const exposed = applyCodeMode(tools, { codeMode, session });
  const exec = exposed.find((tool) => tool.name === "exec")!;
  const execWait = exposed.find((tool) => tool.name === "exec_wait")!;
  return { exposed, exec, execWait };
}

describe("applyCodeMode exposure", () => {
  const echo = makeTool("echo", async () => ({ output: "" }));
  const plan = makeTool("plan", async () => ({ output: "" }));
  const providerWeb = makeTool("web_search", async () => ({ output: "" }), {
    modelExposure: { kind: "provider_builtin", capability: "web" } as Tool["modelExposure"],
  });

  test("off returns the tool list unchanged", () => {
    const tools = [echo, plan];
    expect(applyCodeMode(tools, { codeMode: "off", session: new CodeModeSession() })).toBe(tools);
  });

  test("only hides nested tools but keeps direct-only and provider-native tools", () => {
    const { exposed, exec } = setup([echo, plan, providerWeb]);
    expect(exposed.map((tool) => tool.name)).toEqual(["plan", "web_search", "exec", "exec_wait"]);
    expect(exec.description).toContain("declare const tools: { echo(args: {");
    expect(exec.description).not.toContain("plan(args");
  });

  test("on keeps every direct tool beside exec", () => {
    const { exposed } = setup([echo, plan], "on");
    expect(exposed.map((tool) => tool.name)).toEqual(["echo", "plan", "exec", "exec_wait"]);
  });
});

describe("exec", () => {
  test("runs nested tools, emits nested events, and records them for history", async () => {
    const echo = makeTool("echo", async (args) => ({ output: `echo:${args.value}` }));
    const { exec } = setup([echo]);
    const events: NestedToolEvent[] = [];

    const result = await exec.execute(
      { code: `const out = await tools.echo({ value: "a" });\ntext(out);` },
      makeCtx("call-1", events),
    );

    expect(result.output).toBe("Script completed\necho:a");
    expect(events.map((event) => `${event.type}:${event.toolCallId}`)).toEqual([
      "tool_start:call-1#1",
      "tool_end:call-1#1",
    ]);
    expect(result.metadata?.codeMode).toMatchObject({
      status: "completed",
      nestedCalls: [{ toolCallId: "call-1#1", toolName: "echo", input: { value: "a" }, output: "echo:a" }],
    });
  });

  test("rejects the guest promise for failed nested tools and reports script errors with line numbers", async () => {
    const fail = makeTool("fail", async () => ({ output: "boom", metadata: { error: true } }));
    const { exec } = setup([fail]);

    const caught = await exec.execute(
      {
        code: `try { await tools.fail({}); } catch (error) { text(error instanceof Error ? error.message : "not an Error"); }`,
      },
      makeCtx("call-1"),
    );
    expect(caught.output).toBe("Script completed\nfail failed: boom");

    const thrown = await exec.execute(
      { code: `text("before");\nthrow new TypeError("bad input");` },
      makeCtx("call-2"),
    );
    expect(thrown.metadata?.error).toBe(true);
    expect(thrown.output).toContain("Script failed\nbefore\nScript error:\nTypeError: bad input");
    expect(thrown.output).toContain("exec.js:2:");
  });

  test("exposes no host globals to the guest", async () => {
    const { exec } = setup([]);
    const result = await exec.execute(
      { code: `text([typeof process, typeof require, typeof Bun, typeof fetch, typeof console].join(","));` },
      makeCtx("call-1"),
    );
    expect(result.output).toBe("Script completed\nundefined,undefined,undefined,undefined,undefined");
  });

  test("persists store() values across exec calls in the same session", async () => {
    const { exec } = setup([]);
    await exec.execute({ code: `store("answer", { n: 42 });` }, makeCtx("call-1"));
    const result = await exec.execute(
      { code: `text(load("answer").n); text(load("missing") === undefined);` },
      makeCtx("call-2"),
    );
    expect(result.output).toBe("Script completed\n42\ntrue");
  });

  test("runs tools without supportParallel one at a time even under Promise.all", async () => {
    let active = 0;
    let maxActive = 0;
    const slow = makeTool("slow", async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      // Real delay: guest calls arrive as cross-thread Worker messages, so overlap needs a genuine window.
      await Bun.sleep(10);
      active--;
      return { output: "ok" };
    });
    const { exec } = setup([slow]);
    await exec.execute(
      { code: `await Promise.all([tools.slow({}), tools.slow({}), tools.slow({})]);` },
      makeCtx("call-1"),
    );
    expect(maxActive).toBe(1);
  });

  test("completes instead of yielding when the deadline passes during the script's last nested call", async () => {
    // Real delay: the call must outlast yield_time_ms, which the cell measures on the wall clock.
    const slow = makeTool("slow", async () => {
      await Bun.sleep(60);
      return { output: "slow-done" };
    });
    const { exec } = setup([slow]);
    const result = await exec.execute({ code: `text(await tools.slow({}));`, yield_time_ms: 10 }, makeCtx("call-1"));
    expect(result.output).toBe("Script completed\nslow-done");
  });
});

describe("exec_wait", () => {
  test("resumes a yielded cell and runs calls requested while detached under the waiting call", async () => {
    const echo = makeTool("echo", async (args) => ({ output: `echo:${args.value}` }), { supportParallel: true });
    const { exec, execWait } = setup([echo]);

    const first = await exec.execute(
      {
        code: `text("early"); yield_control();\nawait new Promise((resolve) => setTimeout(resolve, 10));\ntext(await tools.echo({ value: "late" }));`,
      },
      makeCtx("call-1"),
    );
    expect(first.output).toBe("Script running with cell ID 1\nearly");

    // Real delay: the guest's own timer (in the Worker) must fire so the call is requested while detached.
    await Bun.sleep(50);
    const events: NestedToolEvent[] = [];
    const second = await execWait.execute({ cell_id: "1" }, makeCtx("call-2", events));
    expect(second.output).toBe("Script completed\necho:late");
    expect(events[0]).toMatchObject({ type: "tool_start", toolCallId: "call-2#1" });

    const closed = await execWait.execute({ cell_id: "1" }, makeCtx("call-3"));
    expect(closed.metadata?.error).toBe(true);
  });

  test("terminate stops a busy cell without taking the host down", async () => {
    const { exec, execWait } = setup([]);
    const running = await exec.execute({ code: "while (true) {}", yield_time_ms: 50 }, makeCtx("call-1"));
    expect(running.output).toBe("Script running with cell ID 1");

    const terminated = await execWait.execute({ cell_id: "1", terminate: true }, makeCtx("call-2"));
    expect(terminated.output).toBe("Script terminated");

    // Real delay: Bun 1.3 crashed shortly after terminating a Worker blocked in vm.runInContext.
    await Bun.sleep(50);
    const next = await exec.execute({ code: `text("alive");` }, makeCtx("call-3"));
    expect(next.output).toBe("Script completed\nalive");
  });

  test("aborting the driving call terminates the cell", async () => {
    const { exec } = setup([]);
    const controller = new AbortController();
    const pending = exec.execute({ code: "await new Promise(() => {});" }, makeCtx("call-1", [], controller.signal));
    controller.abort();
    expect((await pending).output).toBe("Script terminated");
  });
});
