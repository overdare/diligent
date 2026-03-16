// @summary Assistant-response streaming helpers and provider debug logging

import { zodToJsonSchema } from "zod-to-json-schema";
import type { Model, StreamContext, StreamFunction, SystemSection, ThinkingEffort, ToolDefinition } from "../llm/types";
import { resolveMaxTokens } from "../llm/types";
import type { Tool } from "../tool/types";
import type { AssistantMessage, Message } from "../types";
import type { AgentStream } from "./types";

function toToolDefinition(tool: Pick<Tool, "name" | "description" | "parameters">): ToolDefinition {
  const { $schema, ...schema } = zodToJsonSchema(tool.parameters) as Record<string, unknown>;
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: schema,
  };
}

function createAssistantMessage(model: string): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    model,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    stopReason: "end_turn",
    timestamp: Date.now(),
  };
}

function ensureCurrentMessage(
  currentMessage: AssistantMessage | undefined,
  modelId: string,
  stream: AgentStream,
  itemId: string,
): AssistantMessage {
  if (currentMessage) return currentMessage;
  const message = createAssistantMessage(modelId);
  stream.emit({ type: "message_start", itemId, message });
  return message;
}

export async function streamAssistantMessage(
  messages: Message[],
  request: {
    config: {
      model: Model;
      effort: ThinkingEffort;
    };
    sessionId?: string;
    signal?: AbortSignal;
  },
  runtime: {
    tools: Tool[];
    systemPrompt: SystemSection[];
    providerStream: StreamFunction;
  },
  stream: AgentStream,
  generateItemId: () => string,
): Promise<AssistantMessage> {
  const context: StreamContext = {
    systemPrompt: runtime.systemPrompt,
    messages,
    tools: runtime.tools.map(toToolDefinition),
  };

  const turnStateRef: { value: string | undefined } = { value: undefined };
  const providerStream = runtime.providerStream(request.config.model, context, {
    signal: request.signal,
    effort: request.config.effort,
    sessionId: request.sessionId,
    maxTokens: resolveMaxTokens(request.config.model),
    turnStateRef,
  });

  const _requestStartedAt = Date.now();
  const messageItemId = generateItemId();
  let currentMessage: AssistantMessage | undefined;
  let sawDone = false;

  for await (const event of providerStream) {
    switch (event.type) {
      case "done":
        sawDone = true;
        currentMessage = event.message;
        stream.emit({ type: "message_end", itemId: messageItemId, message: event.message });
        break;
      case "error":
        providerStream.result().catch(() => {});
        throw event.error;
      case "text_delta":
      case "thinking_delta": {
        currentMessage = ensureCurrentMessage(currentMessage, request.config.model.id, stream, messageItemId);

        stream.emit({
          type: "message_delta",
          itemId: messageItemId,
          message: currentMessage,
          delta:
            event.type === "text_delta"
              ? { type: "text_delta", delta: event.delta }
              : { type: "thinking_delta", delta: event.delta },
        });
        break;
      }
      case "start":
      case "text_end":
      case "thinking_end":
        break;
      case "tool_call_start":
      case "tool_call_delta":
      case "tool_call_end":
        currentMessage = ensureCurrentMessage(currentMessage, request.config.model.id, stream, messageItemId);
        break;
      case "usage":
        break;
      default: {
        const exhaustive: never = event;
        throw new Error(`Unhandled provider event: ${String(exhaustive)}`);
      }
    }
  }

  if (!sawDone || !currentMessage) {
    if (request.signal?.aborted) {
      throw new Error("Aborted");
    }
    throw new Error("Provider stream ended without producing a message");
  }

  const result = await providerStream.result();
  return result.message;
}
