// @summary Tests for code mode exec/exec_wait: tool exposure, nested dispatch, yielding, isolation, and termination
import { afterEach, describe, expect, test } from "bun:test";
import {
  executeTool,
  type NestedToolEvent,
  type Tool,
  type ToolContext,
  type ToolOutputFileStore,
  type ToolRegistry,
  type ToolResult,
  type ToolRunScope,
} from "@diligent/core/tool-contract";
import { applyCodeMode, type CodeModeResultMetadata, CodeModeSession } from "@diligent/runtime/tools";
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

function setup(tools: Tool[], codeMode: "on" | "only" = "only", outputStore?: ToolOutputFileStore) {
  const session = new CodeModeSession();
  sessions.push(session);
  const exposed = applyCodeMode(tools, { codeMode, session, outputStore });
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

  test("reports guest syntax errors with line, column, source excerpt, and a template literal hint", async () => {
    const { exec } = setup([]);
    const rawNewline = await exec.execute(
      { code: `const n = 1;\ntext("python3 - <<'PY'\nimport json\nPY");` },
      makeCtx("call-1"),
    );
    expect(rawNewline.metadata?.error).toBe(true);
    expect(rawNewline.output).toContain("exec.js:2:6");
    expect(rawNewline.output).toContain(`  2 | text("python3 - <<'PY'\n    |      ^`);
    expect(rawNewline.output).toContain("template literal");

    const badObject = await exec.execute({ code: `const a = 1;\nlet x = {;\ntext(a);` }, makeCtx("call-2"));
    expect(badObject.output).toContain("exec.js:2:10");
    expect(badObject.output).toContain("  1 | const a = 1;\n  2 | let x = {;\n    |          ^");
    expect(badObject.output).not.toContain("template literal");
  });

  test("scripts receive complete nested output while only the exec result is truncated for the model", async () => {
    const items = Array.from({ length: 4_000 }, (_, index) => ({ index, label: `item-${index}` }));
    const bigJson = JSON.stringify({ items });
    const saved: string[] = [];
    const outputStore: ToolOutputFileStore = {
      save: async (output) => {
        saved.push(output);
        return `/tmp/full-output-${saved.length}.txt`;
      },
    };
    const list = makeTool("list", async () => ({ output: bigJson }));
    const { exec } = setup([list], "only", outputStore);
    const events: NestedToolEvent[] = [];
    const registry: ToolRegistry = new Map([[exec.name, exec]]);

    const result = await executeTool(
      registry,
      {
        type: "tool_call",
        id: "call-1",
        name: "exec",
        input: {
          code: `const data = JSON.parse(await tools.list({}));\ntext(data.items.length);\ntext(data.items.at(-1).label);\ntext("x".repeat(20000));`,
          max_output_tokens: 1_000,
        },
      },
      makeCtx("call-1", events),
      { outputStore },
    );

    expect(bigJson.length).toBeGreaterThan(50_000);
    expect(result.output).toStartWith("Script completed\n4000\nitem-3999\n");
    expect(result.metadata?.truncated).toBe(true);

    // History keeps a capped copy of the nested output and points at the complete one.
    const codeMode = result.metadata?.codeMode as CodeModeResultMetadata;
    const nested = codeMode.nestedCalls[0]!;
    expect(nested.output.length).toBeLessThan(bigJson.length);
    expect(saved).toContain(bigJson);
    expect(nested.fullOutputPath).toBe(`/tmp/full-output-${saved.indexOf(bigJson) + 1}.txt`);
    expect(nested.output).toContain(`full output at: ${nested.fullOutputPath}`);

    const end = events.find((event) => event.type === "tool_end");
    expect(end?.type === "tool_end" ? end.output : undefined).toBe(nested.output);
  });

  test("short nested outputs are persisted whole without saving a copy", async () => {
    const saved: string[] = [];
    const echo = makeTool("echo", async (args) => ({ output: `echo:${args.value}` }));
    const outputStore: ToolOutputFileStore = {
      save: async (output) => {
        saved.push(output);
        return "/tmp/unused.txt";
      },
    };
    const { exec } = setup([echo], "only", outputStore);
    const result = await exec.execute({ code: `text(await tools.echo({ value: "a" }));` }, makeCtx("call-1"));
    const codeMode = result.metadata?.codeMode as CodeModeResultMetadata;
    expect(codeMode.nestedCalls[0]).toMatchObject({ output: "echo:a" });
    expect(codeMode.nestedCalls[0]?.fullOutputPath).toBeUndefined();
    expect(saved).toEqual([]);
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
});

describe("exec_wait", () => {
  test("without a run scope, holds calls requested while detached and runs them under the next wait", async () => {
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

/** A fake agent run: what the core loop hands each tool call as `ctx.runScope`. */
interface FakeRun {
  scope: ToolRunScope;
  abort: () => void;
  close: () => Promise<void>;
}

function makeRun(): FakeRun {
  const abort = new AbortController();
  const closing = new AbortController();
  const tracked: Promise<unknown>[] = [];
  return {
    scope: {
      signal: abort.signal,
      closing: closing.signal,
      track: (work) => {
        tracked.push(work);
      },
    },
    abort: () => abort.abort(),
    close: async () => {
      closing.abort();
      await Promise.allSettled(tracked);
    },
  };
}

function makeRunCtx(toolCallId: string, run: FakeRun, events: NestedToolEvent[] = []): ToolContext {
  return { ...makeCtx(toolCallId, events, run.scope.signal), runScope: run.scope };
}

describe("background dispatch", () => {
  test("a yielded cell keeps making nested calls without a wait, attributed to its last driver", async () => {
    const called = Promise.withResolvers<void>();
    const echo = makeTool("echo", async (args) => {
      called.resolve();
      return { output: `echo:${args.value}` };
    });
    const { exec, execWait } = setup([echo]);
    const run = makeRun();
    const events: NestedToolEvent[] = [];

    const first = await exec.execute(
      { code: `yield_control();\ntext(await tools.echo({ value: "bg" }));` },
      makeRunCtx("call-1", run, events),
    );
    expect(first.output).toBe("Script running with cell ID 1");
    await called.promise;
    await run.close();
    expect(events.map((event) => `${event.type}:${event.toolCallId}`)).toEqual([
      "tool_start:call-1#1",
      "tool_end:call-1#1",
    ]);

    const second = await execWait.execute({ cell_id: "1" }, makeRunCtx("call-2", makeRun()));
    expect(second.output).toBe("Script completed\necho:bg");
    expect((second.metadata?.codeMode as CodeModeResultMetadata).nestedCalls).toMatchObject([
      { toolCallId: "call-1#1", parentToolCallId: "call-1", output: "echo:bg" },
    ]);
  });

  test("yield_time_ms returns on time while a nested call is still running", async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const slow = makeTool("slow", async () => {
      started.resolve();
      await release.promise;
      return { output: "slow-done" };
    });
    const { exec, execWait } = setup([slow]);
    const run = makeRun();

    const pending = exec.execute({ code: `text(await tools.slow({}));`, yield_time_ms: 50 }, makeRunCtx("call-1", run));
    await started.promise;
    expect((await pending).output).toBe("Script running with cell ID 1");

    release.resolve();
    await run.close();
    const waited = await execWait.execute({ cell_id: "1" }, makeRunCtx("call-2", makeRun()));
    expect(waited.output).toBe("Script completed\nslow-done");
  });

  test("calls requested after the run closes wait for the next driver", async () => {
    const calls: unknown[] = [];
    const echo = makeTool("echo", async (args) => {
      calls.push(args.value);
      return { output: `echo:${args.value}` };
    });
    const { exec, execWait } = setup([echo]);
    const run = makeRun();
    await exec.execute(
      {
        code: `yield_control();\nawait new Promise((resolve) => setTimeout(resolve, 20));\ntext(await tools.echo({ value: "late" }));`,
      },
      makeRunCtx("call-1", run),
    );
    await run.close();
    // Real delay: the guest's own timer (in the Worker) must fire so the call is requested after the run closed.
    await Bun.sleep(60);
    expect(calls).toEqual([]);

    const events: NestedToolEvent[] = [];
    const waited = await execWait.execute({ cell_id: "1" }, makeRunCtx("call-2", makeRun(), events));
    expect(waited.output).toBe("Script completed\necho:late");
    expect(events[0]).toMatchObject({ type: "tool_start", toolCallId: "call-2#1" });
  });

  test("aborting the run terminates a yielded cell", async () => {
    const { exec, execWait } = setup([]);
    const run = makeRun();
    await exec.execute({ code: "yield_control();\nawait new Promise(() => {});" }, makeRunCtx("call-1", run));
    run.abort();
    const waited = await execWait.execute({ cell_id: "1" }, makeCtx("call-2"));
    expect(waited.output).toBe("Script terminated");
  });

  test("direct calls of a non-parallel tool wait for the script's background call", async () => {
    const order: string[] = [];
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const edit = makeTool("edit", async (args) => {
      order.push(`start:${args.value}`);
      if (args.value === "script") {
        started.resolve();
        await release.promise;
      }
      order.push(`end:${args.value}`);
      return { output: "ok" };
    });
    const { exposed, exec } = setup([edit], "on");
    const directEdit = exposed.find((tool) => tool.name === "edit")!;
    const run = makeRun();

    await exec.execute({ code: `yield_control();\nawait tools.edit({ value: "script" });` }, makeRunCtx("call-1", run));
    await started.promise;
    const direct = directEdit.execute({ value: "direct" }, makeCtx("call-2"));
    // A direct call that bypassed the gate would have started by its first await.
    await Promise.resolve();
    expect(order).toEqual(["start:script"]);

    release.resolve();
    await direct;
    await run.close();
    expect(order).toEqual(["start:script", "end:script", "start:direct", "end:direct"]);
  });

  test("an aborted direct call stops waiting without blocking later calls", async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const edit = makeTool("edit", async (args) => {
      if (args.value === "script") {
        started.resolve();
        await release.promise;
      }
      return { output: `edited:${args.value}` };
    });
    const { exposed, exec } = setup([edit], "on");
    const directEdit = exposed.find((tool) => tool.name === "edit")!;
    const registry: ToolRegistry = new Map([[directEdit.name, directEdit]]);
    const run = makeRun();
    await exec.execute({ code: `yield_control();\nawait tools.edit({ value: "script" });` }, makeRunCtx("call-1", run));
    await started.promise;

    const controller = new AbortController();
    const abandoned = executeTool(
      registry,
      { type: "tool_call", id: "call-2", name: "edit", input: { value: "abandoned" } },
      makeCtx("call-2", [], controller.signal),
    );
    const next = executeTool(
      registry,
      { type: "tool_call", id: "call-3", name: "edit", input: { value: "next" } },
      makeCtx("call-3"),
    );
    controller.abort();
    expect((await abandoned).metadata?.error).toBe(true);

    release.resolve();
    expect((await next).output).toBe("edited:next");
    await run.close();
  });
});
