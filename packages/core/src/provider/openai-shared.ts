// @summary Shared OpenAI Responses API utilities: message conversion, stop reason mapping, tool building, and SSE event handling
import type { EventStream } from "../event-stream";
import type { AssistantMessage, ContentBlock, Message, StopReason, Usage } from "../types";
import type { Model, ProviderEvent, ProviderResult, ToolDefinition } from "./types";
import { ProviderError } from "./types";

export type OpenAIInputItem =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string };

export function convertMessages(messages: Message[]): OpenAIInputItem[] {
  const result: OpenAIInputItem[] = [];
  // Track function_calls that haven't been matched with an output yet (call_id -> index in result)
  const pendingCalls = new Map<string, number>();

  for (const msg of messages) {
    if (msg.role === "user") {
      result.push({
        role: "user",
        content:
          typeof msg.content === "string"
            ? msg.content
            : msg.content
                .filter((b) => b.type === "text")
                .map((b) => (b as { type: "text"; text: string }).text)
                .join("\n"),
      });
    } else if (msg.role === "assistant") {
      for (const block of msg.content) {
        if (block.type === "text") {
          result.push({ role: "assistant", content: block.text });
        } else if (block.type === "tool_call") {
          pendingCalls.set(block.id, result.length);
          result.push({
            type: "function_call",
            call_id: block.id,
            name: block.name,
            arguments: JSON.stringify(block.input),
          });
        }
      }
    } else if (msg.role === "tool_result") {
      pendingCalls.delete(msg.toolCallId);
      result.push({
        type: "function_call_output",
        call_id: msg.toolCallId,
        output: msg.output,
      });
    }
  }

  // Inject synthetic outputs for any function_calls with no matching output.
  // This can happen when the session was interrupted while a tool was executing.
  if (pendingCalls.size > 0) {
    const injections = Array.from(pendingCalls.entries())
      .map(([callId, idx]) => ({
        idx: idx + 1,
        item: { type: "function_call_output" as const, call_id: callId, output: "(interrupted)" },
      }))
      .sort((a, b) => b.idx - a.idx); // insert back-to-front to preserve earlier indices
    for (const { idx, item } of injections) {
      result.splice(idx, 0, item);
    }
  }

  return result;
}

export function mapStopReason(status: string | undefined): StopReason {
  switch (status) {
    case "completed":
      return "end_turn";
    case "incomplete":
      return "max_tokens";
    case "failed":
      return "error";
    case "cancelled":
      return "aborted";
    default:
      return "end_turn";
  }
}

export function buildTools(
  tools: ToolDefinition[],
  strict?: boolean,
): Array<{
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
}> {
  return tools.map((t) => ({
    type: "function" as const,
    name: t.name,
    description: t.description,
    parameters: { type: "object", ...t.inputSchema },
    ...(strict !== undefined && { strict }),
  }));
}

export function mapUsage(usage: { input_tokens: number; output_tokens: number } | undefined): Usage {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
}

/**
 * Process OpenAI Responses API SSE events from an async iterable.
 * Works for both SDK streams (openai.ts) and raw-parsed objects (chatgpt.ts).
 */
export async function handleResponsesAPIEvents(
  iter: AsyncIterable<Record<string, unknown>>,
  stream: EventStream<ProviderEvent, ProviderResult>,
  model: Model,
  signal?: AbortSignal,
): Promise<void> {
  const contentBlocks: ContentBlock[] = [];
  let currentText = "";
  let currentThinking = "";
  let currentToolId = "";
  let stopReason: StopReason = "end_turn";
  let usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const toolBuffers = new Map<string, { id: string; name: string; args: string }>();

  for await (const event of iter) {
    if (signal?.aborted) break;

    const type = event.type as string;


    switch (type) {
      case "response.output_text.delta": {
        const delta = event.delta as string;
        if (delta) {
          currentText += delta;
          stream.push({ type: "text_delta", delta });
        }
        break;
      }

      case "response.reasoning_summary_text.delta": {
        const delta = event.delta as string;
        if (delta) {
          currentThinking += delta;
          stream.push({ type: "thinking_delta", delta });
        }
        break;
      }

      case "response.output_item.added": {
        const item = event.item as Record<string, unknown>;
        if (item?.type === "function_call") {
          const id = item.call_id as string;
          const name = item.name as string;
          currentToolId = id;
          toolBuffers.set(id, { id, name, args: "" });
          stream.push({ type: "tool_call_start", id, name });
        }
        break;
      }

      case "response.function_call_arguments.delta": {
        const delta = event.delta as string;
        // SDK events use item_id; raw events also use item_id
        const itemId = (event.item_id as string) ?? currentToolId;
        if (delta) {
          const buf = toolBuffers.get(itemId);
          if (buf) {
            buf.args += delta;
            stream.push({ type: "tool_call_delta", id: buf.id, delta });
          } else {
            // fallback for SDK path where item_id may not be set
            stream.push({ type: "tool_call_delta", id: currentToolId, delta });
          }
        }
        break;
      }

      case "response.output_item.done": {
        const item = event.item as Record<string, unknown>;
        if (item?.type === "reasoning") {
          if (currentThinking) {
            stream.push({ type: "thinking_end", thinking: currentThinking });
            contentBlocks.unshift({ type: "thinking", thinking: currentThinking });
            currentThinking = "";
          }
        } else if (item?.type === "message") {
          const content = item.content as Array<Record<string, unknown>>;
          if (content) {
            for (const part of content) {
              if (part.type === "output_text") {
                const text = part.text as string;
                stream.push({ type: "text_end", text });
                contentBlocks.push({ type: "text", text });
                currentText = "";
              }
            }
          }
        } else if (item?.type === "function_call") {
          const id = (item.call_id as string) ?? "";
          const name = (item.name as string) ?? "";
          const argsStr = (item.arguments as string) ?? "";
          let input: Record<string, unknown>;
          try {
            input = JSON.parse(argsStr) as Record<string, unknown>;
          } catch {
            input = {};
          }
          stream.push({ type: "tool_call_end", id, name, input });
          contentBlocks.push({ type: "tool_call", id, name, input });
          toolBuffers.delete(id);
        }
        break;
      }

      case "response.completed": {
        const resp = event.response as Record<string, unknown>;
        if (resp) {
          const u = resp.usage as Record<string, number> | undefined;
          usage = mapUsage(u as { input_tokens: number; output_tokens: number } | undefined);
          stopReason = mapStopReason(resp.status as string);
        }
        break;
      }

      case "response.failed": {
        const resp = event.response as Record<string, unknown>;
        const respError = resp?.error as Record<string, unknown> | undefined;
        const msg = (respError?.message as string) ?? "Response failed";
        stream.push({ type: "error", error: new ProviderError(msg, "unknown", false) });
        return;
      }
    }
  }

  // Flush any remaining text that wasn't closed by output_item.done
  if (currentText) {
    stream.push({ type: "text_end", text: currentText });
    contentBlocks.push({ type: "text", text: currentText });
  }

  stream.push({ type: "usage", usage });

  const assistantMessage: AssistantMessage = {
    role: "assistant",
    content: contentBlocks,
    model: model.id,
    usage,
    stopReason,
    timestamp: Date.now(),
  };

  stream.push({ type: "done", stopReason, message: assistantMessage });
}
