// @summary Agent loop coordinating compaction, streaming, tools, and loop safety

import type { Model, StreamFunction, SystemSection, ThinkingEffort } from "../llm/types";
import type { Tool } from "../tool/types";
import type { Message, ToolCallBlock } from "../types";
import { streamAssistantMessage } from "./assistant";
import { runCompaction, shouldCompact } from "./compaction";
import { runToolCalls } from "./tool";
import type { AgentStream, CompactionConfig } from "./types";
import { DoomLoopDetector } from "./util/doom-loop";
import { toSerializableError } from "./util/errors";

// Internal fully-resolved config for one loop run
interface LoopConfig {
  model: Model;
  systemPrompt: SystemSection[];
  tools: Tool[];
  effort: ThinkingEffort;
  compaction?: CompactionConfig;
}

export interface LoopRuntime {
  config: LoopConfig;
  streamFunction: StreamFunction;
  stream: AgentStream;
  sessionId?: string;
  hooks: {
    drainSteeringMessages: () => Message[];
    pendingSteeringCount: () => number;
  };
}


export async function runAgentLoop(messages: Message[], runtime: LoopRuntime, userSignal?: AbortSignal): Promise<Message[]> {
  const { config, streamFunction, stream, hooks } = runtime;
  const toolAbortController = new AbortController();
  const signal = AbortSignal.any([toolAbortController.signal, userSignal].filter((s): s is AbortSignal => s != null));

  const loopRequest = { config, streamFunction, sessionId: runtime.sessionId, signal };
  const conversation = [...messages];
  const doomLoopTracker = new DoomLoopDetector();
  const registry = new Map(config.tools.map((tool) => [tool.name, tool]));
  const providerStream = streamFunction;
  let itemCounter = 0;
  let turnNumber = 0;
  const nextItemId = () => `item-${++itemCounter}`;

  stream.emit({ type: "agent_start" });

  try {
    while (true) {
      if (signal?.aborted) {
        break;
      }

      const turnId = `turn-${++turnNumber}`;
      stream.emit({ type: "turn_start", turnId });

      await compactIfNeeded(conversation, loopRequest, stream);

      const steering = hooks.drainSteeringMessages();
      if (steering.length > 0) {
        conversation.push(...steering);
        stream.emit({ type: "steering_injected", messageCount: steering.length, messages: steering });
      }

      const assistantMessage = await streamAssistantMessage(
        conversation,
        loopRequest,
        { tools: config.tools, systemPrompt: config.systemPrompt, providerStream },
        stream,
        nextItemId,
      );
      conversation.push(assistantMessage);

      stream.emit({ type: "usage", usage: assistantMessage.usage });

      const toolCalls = assistantMessage.content.filter((block): block is ToolCallBlock => block.type === "tool_call");
      const { executions } = await runToolCalls(toolCalls, signal, registry, stream, nextItemId, () =>
        toolAbortController.abort(),
      );

      for (const execution of executions) {
        if (!signal.aborted) {
          conversation.push(execution.toolResult);
        }
        doomLoopTracker.record(execution.toolCall.name, execution.toolCall.input);
      }

      const doomLoop = doomLoopTracker.check();
      if (doomLoop.detected) {
        conversation.push({
          role: "user",
          content: `[WARNING: Doom loop detected — tool "${doomLoop.toolName}" is being called in a repeating pattern (length ${doomLoop.patternLength}). Try a different approach.]`,
          timestamp: Date.now(),
        });
      }

      stream.emit({
        type: "turn_end",
        turnId,
        message: assistantMessage,
        toolResults: executions.map((execution) => execution.toolResult),
      });

      if (signal.aborted || (toolCalls.length === 0 && hooks.pendingSteeringCount() === 0)) break;
    }
  } catch (err) {
    if (!userSignal?.aborted) {
      stream.emit({ type: "error", error: toSerializableError(err), fatal: true });
      throw err;
    }
  } finally {
    stream.emit({ type: "agent_end", messages: conversation });
  }

  return conversation;
}

async function compactIfNeeded(
  messages: Message[],
  request: {
    config: LoopConfig;
    streamFunction: StreamFunction;
    sessionId?: string;
    signal?: AbortSignal;
  },
  stream: AgentStream,
): Promise<void> {
  const config = request.config.compaction;
  if (!config) return;
  if (!shouldCompact(messages, request.config.model.contextWindow, config.reservePercent)) return;

  const result = await runCompaction({
    messages,
    model: request.config.model,
    systemPrompt: request.config.systemPrompt,
    compactionConfig: config,
    streamFn: request.streamFunction,
    stream,
    signal: request.signal,
  });
  messages.splice(0, messages.length, ...result.messages);
}
