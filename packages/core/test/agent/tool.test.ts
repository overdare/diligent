// @summary Tests for tool batch cancellation and provider replay pairing
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { runToolCalls } from "../../src/agent/tool";
import { AgentStream, type CoreAgentEvent } from "../../src/agent/types";
import type { Tool, ToolRegistry, ToolResult } from "../../src/tool/types";
import type { ToolCallBlock } from "../../src/types";

function makeTool(name: string, supportParallel: boolean, executions: string[]): Tool {
  return {
    name,
    description: `${name} test tool`,
    parameters: z.object({}),
    supportParallel,
    async execute() {
      executions.push(name);
      return { output: name };
    },
  };
}

async function runPreAbortedBatch(tools: Tool[]): Promise<{
  events: CoreAgentEvent[];
  toolCallIds: string[];
}> {
  const controller = new AbortController();
  controller.abort();
  const stream = new AgentStream();
  const events: CoreAgentEvent[] = [];
  stream.subscribe((event) => events.push(event));
  const toolCalls: ToolCallBlock[] = tools.map((tool, index) => ({
    type: "tool_call",
    id: `call-${index + 1}`,
    name: tool.name,
    input: {},
  }));
  const registry: ToolRegistry = new Map(tools.map((tool) => [tool.name, tool]));
  let itemId = 0;

  const result = await runToolCalls(
    toolCalls,
    controller.signal,
    registry,
    stream,
    () => `item-${++itemId}`,
    () => {},
  );

  return {
    events,
    toolCallIds: result.executions.map((execution) => execution.toolCall.id),
  };
}

describe("runToolCalls", () => {
  test.each([
    "tool",
    "external",
  ] as const)("preserves settled parallel results after %s cancellation", async (source) => {
    const controller = new AbortController();
    const stream = new AgentStream();
    const events: CoreAgentEvent[] = [];
    stream.subscribe((event) => events.push(event));
    const effects: string[] = [];
    const completed: ToolResult = {
      output: "saved",
      outputImages: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "c2F2ZWQ=" } }],
      metadata: { saved: true },
    };
    const failed: ToolResult = { output: "write failed", metadata: { error: true } };
    const tools: Tool[] = [
      {
        ...makeTool("stop", true, effects),
        async execute() {
          await Promise.resolve();
          if (source === "external") controller.abort();
          return { output: "stopped", abortRequested: source === "tool" };
        },
      },
      {
        ...makeTool("save", true, effects),
        async execute() {
          effects.push("saved");
          return completed;
        },
      },
      { ...makeTool("fail", true, effects), execute: async () => failed },
    ];
    const calls: ToolCallBlock[] = tools.map((tool) => ({
      type: "tool_call",
      id: tool.name,
      name: tool.name,
      input: {},
    }));
    let itemId = 0;

    const result = await runToolCalls(
      calls,
      controller.signal,
      new Map(tools.map((tool) => [tool.name, tool])),
      stream,
      () => `item-${++itemId}`,
      () => controller.abort(),
    );

    expect(controller.signal.aborted).toBe(true);
    expect(effects).toEqual(["saved"]);
    const expected = [
      { toolCallId: "stop", output: "stopped", isError: false },
      { toolCallId: "save", ...completed, isError: false },
      { toolCallId: "fail", ...failed, isError: true },
    ];
    expect(result.executions.map((execution) => execution.toolResult)).toMatchObject(expected);
    // tool_end is emitted as each call settles; the provider-visible executions above keep model order.
    const ends = events.filter((event) => event.type === "tool_end");
    for (const expectedEnd of expected) {
      expect(ends.find((event) => event.toolCallId === expectedEnd.toolCallId)).toMatchObject(expectedEnd);
    }
    expect(ends).toHaveLength(expected.length);
  });

  test("pre-aborted parallel batch executes no tools and pairs every call", async () => {
    const executions: string[] = [];

    const result = await runPreAbortedBatch([
      makeTool("parallel-a", true, executions),
      makeTool("parallel-b", true, executions),
    ]);

    expect(executions).toEqual([]);
    expect(result.toolCallIds).toEqual(["call-1", "call-2"]);
    expect(result.events.filter((event) => event.type === "tool_start")).toHaveLength(2);
    expect(result.events.filter((event) => event.type === "tool_end")).toHaveLength(2);
  });

  test("pre-aborted sequential batch executes no tools and pairs every call", async () => {
    const executions: string[] = [];

    const result = await runPreAbortedBatch([
      makeTool("sequential-a", false, executions),
      makeTool("sequential-b", false, executions),
    ]);

    expect(executions).toEqual([]);
    expect(result.toolCallIds).toEqual(["call-1", "call-2"]);
    expect(result.events.filter((event) => event.type === "tool_start")).toHaveLength(2);
    expect(result.events.filter((event) => event.type === "tool_end")).toHaveLength(2);
  });

  describe("mixed shared and exclusive batches", () => {
    // Asserting that a queued call has NOT started needs every pending continuation to run first; one macrotask
    // turn drains the microtask queue, and no fixed duration is involved.
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    // Each call blocks until finish(id); `id` comes from the call input so one tool can serve several calls.
    function startBatch(calls: Array<{ id: string; shared: boolean }>) {
      const started: string[] = [];
      const waiting = new Map<string, () => void>();
      const blockingTool = (name: string, supportParallel: boolean): Tool => ({
        name,
        description: name,
        parameters: z.object({ id: z.string() }),
        supportParallel,
        async execute(args: { id: string }) {
          started.push(args.id);
          const { promise, resolve } = Promise.withResolvers<void>();
          waiting.set(args.id, resolve);
          await promise;
          return { output: `done ${args.id}` };
        },
      });
      const registry: ToolRegistry = new Map([
        ["shared", blockingTool("shared", true)],
        ["exclusive", blockingTool("exclusive", false)],
      ]);
      const controller = new AbortController();
      const stream = new AgentStream();
      const events: CoreAgentEvent[] = [];
      stream.subscribe((event) => events.push(event));
      let itemId = 0;
      const run = runToolCalls(
        calls.map(({ id, shared }) => ({
          type: "tool_call",
          id,
          name: shared ? "shared" : "exclusive",
          input: { id },
        })),
        controller.signal,
        registry,
        stream,
        () => `item-${++itemId}`,
        () => controller.abort(),
      );
      const finish = (id: string) => {
        const resolve = waiting.get(id);
        if (!resolve) throw new Error(`call ${id} is not running`);
        resolve();
      };
      return { started, finish, run, events, controller };
    }

    test("shared calls overlap, an exclusive call runs alone, and later calls wait their turn", async () => {
      const batch = startBatch([
        { id: "r1", shared: true },
        { id: "r2", shared: true },
        { id: "w", shared: false },
        { id: "r3", shared: true },
      ]);

      await flush();
      expect(batch.started).toEqual(["r1", "r2"]);

      batch.finish("r1");
      await flush();
      expect(batch.started).toEqual(["r1", "r2"]);

      batch.finish("r2");
      await flush();
      expect(batch.started).toEqual(["r1", "r2", "w"]);

      batch.finish("w");
      await flush();
      expect(batch.started).toEqual(["r1", "r2", "w", "r3"]);

      batch.finish("r3");
      const result = await batch.run;
      expect(result.executions.map((execution) => execution.toolResult.output)).toEqual([
        "done r1",
        "done r2",
        "done w",
        "done r3",
      ]);
      const startOrder = batch.events.filter((event) => event.type === "tool_start").map((event) => event.toolCallId);
      expect(startOrder).toEqual(["r1", "r2", "w", "r3"]);
    });

    test("aborting while calls are queued pairs the queued calls without running them", async () => {
      const batch = startBatch([
        { id: "r1", shared: true },
        { id: "w", shared: false },
        { id: "r2", shared: true },
      ]);

      await flush();
      expect(batch.started).toEqual(["r1"]);
      batch.controller.abort();
      batch.finish("r1");
      const result = await batch.run;

      expect(batch.started).toEqual(["r1"]);
      expect(result.executions.map((execution) => [execution.toolCall.id, execution.toolResult.output])).toEqual([
        ["r1", "done r1"],
        ["w", "[Aborted by user]"],
        ["r2", "[Aborted by user]"],
      ]);
      const starts = batch.events.filter((event) => event.type === "tool_start").map((event) => event.toolCallId);
      const ends = batch.events.filter((event) => event.type === "tool_end").map((event) => event.toolCallId);
      expect(starts.sort()).toEqual(["r1", "r2", "w"]);
      expect(ends.sort()).toEqual(["r1", "r2", "w"]);
    });
  });
});
