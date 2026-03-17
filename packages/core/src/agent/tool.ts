// @summary Tool-call runner for sequential and parallel execution batches

import { executeTool } from "../tool/executor";
import type { ToolContext, ToolRegistry } from "../tool/types";
import type { ToolCallBlock, ToolResultMessage } from "../types";
import type { AgentStream } from "./types";

function buildToolStartRender(input: unknown): { version: 2; inputSummary?: string; blocks: unknown[] } | undefined {
  let summary: string | undefined;
  if (typeof input === "string") {
    summary = input.trim().split("\n").find(Boolean);
  } else if (input && typeof input === "object" && !Array.isArray(input)) {
    const recordInput = input as Record<string, unknown>;
    const patchValue = recordInput.patch;
    if (typeof patchValue === "string") {
      const patchLine = patchValue
        .split("\n")
        .map((line) => line.trim())
        .find(
          (line) =>
            line.startsWith("*** Add File:") ||
            line.startsWith("*** Update File:") ||
            line.startsWith("*** Delete File:"),
        );
      if (patchLine) {
        summary = patchLine
          .replace("*** Add File:", "")
          .replace("*** Update File:", "")
          .replace("*** Delete File:", "")
          .trim();
      }
    }
    if (!summary) {
      const filePath = recordInput.file_path;
      if (typeof filePath === "string" && filePath.trim()) summary = filePath.trim();
    }
    if (!summary) {
      const command = recordInput.command;
      if (typeof command === "string" && command.trim()) summary = command.trim();
    }
    if (!summary) {
      const action = recordInput.action;
      if (typeof action === "string" && action.trim()) summary = action.trim();
    }
  }

  if (!summary) return undefined;
  return { version: 2, inputSummary: summary, blocks: [] };
}

export async function runToolCalls(
  toolCalls: ToolCallBlock[],
  signal: AbortSignal | undefined,
  registry: ToolRegistry,
  stream: AgentStream,
  generateItemId: () => string,
  onToolAbort: () => void,
): Promise<{
  executions: Array<{
    toolCall: ToolCallBlock;
    toolResult: ToolResultMessage;
  }>;
}> {
  const executions: Array<{
    toolCall: ToolCallBlock;
    toolResult: ToolResultMessage;
  }> = [];

  if (toolCalls.length === 0) {
    return { executions };
  }

  const buildToolContext = (toolCall: ToolCallBlock, toolItemId: string): ToolContext => ({
    toolCallId: toolCall.id,
    signal: signal ?? new AbortController().signal,
    abort: onToolAbort,
    onUpdate: (partial) => {
      stream.emit({
        type: "tool_update",
        itemId: toolItemId,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        partialResult: partial,
      });
    },
  });

  const canRunInParallel =
    toolCalls.length > 1 && toolCalls.every((toolCall) => registry.get(toolCall.name)?.supportParallel);
  const itemIds = toolCalls.map(() => generateItemId());

  if (canRunInParallel) {
    for (let index = 0; index < toolCalls.length; index++) {
      stream.emit({
        type: "tool_start",
        itemId: itemIds[index],
        toolCallId: toolCalls[index].id,
        toolName: toolCalls[index].name,
        input: toolCalls[index].input,
        render: buildToolStartRender(toolCalls[index].input),
      });
    }

    const results = await Promise.all(
      toolCalls.map((toolCall, index) => executeTool(registry, toolCall, buildToolContext(toolCall, itemIds[index]))),
    );

    for (let index = 0; index < toolCalls.length; index++) {
      executions.push(toToolCallExecution(toolCalls[index], itemIds[index], results[index], stream));
      if (signal?.aborted) break;
    }

    return { executions };
  }

  for (let index = 0; index < toolCalls.length; index++) {
    const toolCall = toolCalls[index];
    if (signal?.aborted) {
      break;
    }

    stream.emit({
      type: "tool_start",
      itemId: itemIds[index],
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      input: toolCall.input,
      render: buildToolStartRender(toolCall.input),
    });

    const result = await executeTool(registry, toolCall, buildToolContext(toolCall, itemIds[index]));
    executions.push(toToolCallExecution(toolCall, itemIds[index], result, stream));

    if (signal?.aborted) break;
  }

  return { executions };
}

function toToolCallExecution(
  toolCall: ToolCallBlock,
  itemId: string,
  result: Awaited<ReturnType<typeof executeTool>>,
  stream: AgentStream,
): {
  toolCall: ToolCallBlock;
  toolResult: ToolResultMessage;
} {
  const toolResult: ToolResultMessage = {
    role: "tool_result",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    output: result.output,
    isError: !!result.metadata?.error,
    timestamp: Date.now(),
    render: result.render,
  };

  stream.emit({
    type: "tool_end",
    itemId,
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    output: result.output,
    isError: toolResult.isError,
    render: result.render,
  });

  return { toolCall, toolResult };
}
