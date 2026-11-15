// @summary Tool-call runner for sequential and parallel execution batches

import type { ToolOutputFileStore } from "../tool/executor";
import { executeTool } from "../tool/executor";
import type { ToolContext, ToolRegistry, ToolRunScope } from "../tool/types";
import type { ToolCallBlock, ToolResultMessage } from "../types";
import type { AgentStream } from "./types";

interface ToolCallExecution {
  toolCall: ToolCallBlock;
  toolResult: ToolResultMessage;
  endTurn?: boolean;
}

export async function runToolCalls(
  toolCalls: ToolCallBlock[],
  signal: AbortSignal | undefined,
  registry: ToolRegistry,
  stream: AgentStream,
  generateItemId: () => string,
  onToolAbort: () => void,
  outputStore?: ToolOutputFileStore,
  sessionId?: string,
  runScope?: ToolRunScope,
): Promise<{
  executions: ToolCallExecution[];
}> {
  const executions: ToolCallExecution[] = [];

  if (toolCalls.length === 0) {
    return { executions };
  }

  const buildToolContext = (toolCall: ToolCallBlock, toolItemId: string): ToolContext => ({
    toolCallId: toolCall.id,
    sessionId,
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
    emitNestedToolEvent: (event) => {
      stream.emit({ ...event, parentToolCallId: toolCall.id });
    },
    ...(runScope ? { runScope } : {}),
  });

  const canRunInParallel =
    toolCalls.length > 1 && toolCalls.every((toolCall) => registry.get(toolCall.name)?.supportParallel);
  const itemIds = toolCalls.map(() => generateItemId());

  if (signal?.aborted) {
    fillAbortedExecutions(toolCalls, itemIds, executions, signal, stream);
    return { executions };
  }

  if (canRunInParallel) {
    for (let index = 0; index < toolCalls.length; index++) {
      stream.emit({
        type: "tool_start",
        itemId: itemIds[index],
        toolCallId: toolCalls[index].id,
        toolName: toolCalls[index].name,
        input: toolCalls[index].input,
      });
    }

    const results = await Promise.all(
      toolCalls.map((toolCall, index) =>
        executeTool(registry, toolCall, buildToolContext(toolCall, itemIds[index]), { outputStore }),
      ),
    );

    for (let index = 0; index < toolCalls.length; index++) {
      executions.push(toToolCallExecution(toolCalls[index], itemIds[index], results[index], stream));
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
    });

    const result = await executeTool(registry, toolCall, buildToolContext(toolCall, itemIds[index]), { outputStore });
    executions.push(toToolCallExecution(toolCall, itemIds[index], result, stream));

    if (signal?.aborted) break;
  }

  // Sequential: only executed calls emitted tool_start, so unexecuted ones still need it.
  fillAbortedExecutions(toolCalls, itemIds, executions, signal, stream);
  return { executions };
}

/**
 * Calls skipped by a pre-aborted batch or sequential cancellation still need a
 * matching tool_result for provider replay. Synthesize tool_start and tool_end
 * only for calls that never executed; settled parallel calls retain their results.
 */
function fillAbortedExecutions(
  toolCalls: ToolCallBlock[],
  itemIds: string[],
  executions: Array<{ toolCall: ToolCallBlock; toolResult: ToolResultMessage }>,
  signal: AbortSignal | undefined,
  stream: AgentStream,
): void {
  if (!signal?.aborted) return;
  const executed = new Set(executions.map((execution) => execution.toolCall.id));

  for (let index = 0; index < toolCalls.length; index++) {
    const toolCall = toolCalls[index];
    if (executed.has(toolCall.id)) continue;

    stream.emit({
      type: "tool_start",
      itemId: itemIds[index],
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      input: toolCall.input,
    });

    const toolResult: ToolResultMessage = {
      role: "tool_result",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      output: "[Aborted by user]",
      isError: false,
      timestamp: Date.now(),
    };

    stream.emit({
      type: "tool_end",
      itemId: itemIds[index],
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      output: toolResult.output,
      isError: false,
    });

    executions.push({ toolCall, toolResult });
  }
}

function toToolCallExecution(
  toolCall: ToolCallBlock,
  itemId: string,
  result: Awaited<ReturnType<typeof executeTool>>,
  stream: AgentStream,
): ToolCallExecution {
  const toolResult: ToolResultMessage = {
    role: "tool_result",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    output: result.output,
    outputImages: result.outputImages,
    isError: !!result.metadata?.error,
    timestamp: Date.now(),
    render: result.render,
    metadata: result.metadata,
  };

  stream.emit({
    type: "tool_end",
    itemId,
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    output: result.output,
    outputImages: result.outputImages,
    isError: toolResult.isError,
    render: result.render,
    metadata: result.metadata,
  });

  return { toolCall, toolResult, endTurn: !toolResult.isError && result.endTurn };
}
