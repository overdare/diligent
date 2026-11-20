// @summary Tool-call runner: schedules a batch through a FIFO reader/writer gate and keeps results in model order

import type { ToolOutputFileStore } from "../tool/executor";
import { executeTool } from "../tool/executor";
import type { ToolContext, ToolRegistry, ToolRunScope } from "../tool/types";
import type { ToolCallBlock, ToolResultMessage } from "../types";
import { ToolGate } from "./tool-gate";
import type { AgentStream } from "./types";

export interface ToolCallExecution {
  toolCall: ToolCallBlock;
  toolResult: ToolResultMessage;
  endTurn?: boolean;
}

export interface ToolCallBatchResult {
  /** One execution per call, in the model's call order. */
  executions: ToolCallExecution[];
}

/**
 * Runs one batch of model tool calls. Parallel-safe calls (`supportParallel`) share the gate and overlap; every
 * other call runs alone. Admission follows the model's order, so no call overtakes an earlier exclusive call.
 */
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
): Promise<ToolCallBatchResult> {
  if (toolCalls.length === 0) {
    return { executions: [] };
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

  const itemIds = toolCalls.map(() => generateItemId());
  const settled: Array<ToolCallExecution | undefined> = new Array(toolCalls.length);
  const gate = new ToolGate();

  await Promise.all(
    toolCalls.map(async (toolCall, index) => {
      let release: () => void;
      try {
        release = await gate.acquire(registry.get(toolCall.name)?.supportParallel === true, signal);
      } catch {
        return; // Aborted before admission; paired below.
      }
      try {
        if (signal?.aborted) return;
        stream.emit({
          type: "tool_start",
          itemId: itemIds[index],
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          input: toolCall.input,
        });
        const result = await executeTool(registry, toolCall, buildToolContext(toolCall, itemIds[index]), {
          outputStore,
        });
        settled[index] = toToolCallExecution(toolCall, itemIds[index], result, stream);
      } finally {
        release();
      }
    }),
  );

  return { executions: pairUnexecutedCalls(toolCalls, itemIds, settled, stream) };
}

/**
 * Every call needs a matching tool_result for provider replay. Calls that never started (a pre-aborted batch, or
 * an abort while they waited for the gate) get synthesized tool_start/tool_end events and an aborted result;
 * calls that ran keep their results.
 */
function pairUnexecutedCalls(
  toolCalls: ToolCallBlock[],
  itemIds: string[],
  settled: Array<ToolCallExecution | undefined>,
  stream: AgentStream,
): ToolCallExecution[] {
  return toolCalls.map((toolCall, index) => {
    const execution = settled[index];
    if (execution) return execution;

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

    return { toolCall, toolResult };
  });
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
