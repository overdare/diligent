// @summary Tests for tool batch cancellation and provider replay pairing
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { runToolCalls } from "../../src/agent/tool";
import { AgentStream, type CoreAgentEvent } from "../../src/agent/types";
import type { Tool, ToolRegistry } from "../../src/tool/types";
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
});
