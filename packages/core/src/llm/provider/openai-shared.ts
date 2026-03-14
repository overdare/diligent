// @summary Shared OpenAI Responses API utilities: message conversion, stop reason mapping, tool building, and SSE event handling
import type { ResponseInputItem, ResponseInputMessageContentList } from "openai/resources/responses/responses";
import type { EventStream } from "../../event-stream";
import type { AssistantMessage, ContentBlock, Message, StopReason, Usage } from "../../types";
import { materializeUserContentBlocks } from "../image-io";
import type { Model, ProviderEvent, ProviderResult, ToolDefinition } from "../types";
import { ProviderError } from "../types";

export type ResponsesReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";

export async function convertMessages(messages: Message[]): Promise<ResponseInputItem[]> {
  const result: ResponseInputItem[] = [];
  // Track function_calls that haven't been matched with an output yet (call_id -> index in result)
  const pendingCalls = new Map<string, number>();

  for (const msg of messages) {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        result.push({ type: "message", role: "user", content: [{ type: "input_text", text: msg.content }] });
      } else {
        const blocks = await materializeUserContentBlocks(msg.content);
        const content: ResponseInputMessageContentList = [];
        for (const block of blocks) {
          if (block.type === "text") {
            content.push({ type: "input_text", text: block.text });
          } else if (block.type === "image") {
            content.push({
              type: "input_image",
              image_url: `data:${block.source.media_type};base64,${block.source.data}`,
              detail: "auto",
            });
          }
        }
        result.push({ type: "message", role: "user", content });
      }
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

export function toResponsesReasoningEffort(effort: "none" | "low" | "medium" | "high" | "max"): ResponsesReasoningEffort {
  if (effort === "max") return "xhigh";
  return effort;
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

export async function buildResponsesRequestBody(input: {
  model: string;
  messages: Message[];
  systemInstructions?: string;
  tools?: ToolDefinition[];
  sessionId?: string;
  maxTokens?: number;
  temperature?: number;
  useReasoning?: boolean;
  effort?: "none" | "low" | "medium" | "high" | "max";
  store?: boolean;
  promptCacheRetention?: string;
  strictTools?: boolean;
}): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {
    model: input.model,
    stream: true,
    input: await convertMessages(input.messages),
  };
  if (input.systemInstructions) body.instructions = input.systemInstructions;
  if (input.sessionId) body.prompt_cache_key = input.sessionId;
  if (input.promptCacheRetention) body.prompt_cache_retention = input.promptCacheRetention;
  if (input.store !== undefined) body.store = input.store;
  if (input.tools && input.tools.length > 0) {
    body.tools = buildTools(input.tools, input.strictTools);
  }
  if (input.maxTokens !== undefined) body.max_output_tokens = input.maxTokens;
  if (input.temperature !== undefined) body.temperature = input.temperature;
  if (input.useReasoning && input.effort) {
    body.reasoning = { effort: toResponsesReasoningEffort(input.effort), summary: "auto" };
    body.include = ["reasoning.encrypted_content"];
  }
  return body;
}

export function isContextOverflow(message: string): boolean {
  const patterns = [/maximum context length/i, /context_length_exceeded/i, /too many tokens/i, /exceeds the model/i];
  return patterns.some((p) => p.test(message));
}

export function mapUsage(
  usage:
    | {
        input_tokens: number;
        output_tokens: number;
        input_tokens_details?: { cached_tokens?: number };
        output_tokens_details?: { reasoning_tokens?: number };
      }
    | undefined,
): Usage {
  const cachedTokens = usage?.input_tokens_details?.cached_tokens ?? 0;
  return {
    inputTokens: (usage?.input_tokens ?? 0) - cachedTokens,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadTokens: cachedTokens,
    cacheWriteTokens: 0,
  };
}

export function extractCompactionSummary(payload: Record<string, unknown>): string | undefined {
  if (typeof payload.summary === "string") return payload.summary;
  if (typeof payload.compaction_summary === "string") return payload.compaction_summary;
  return undefined;
}

/**
 * Process OpenAI Responses API SSE events from an async iterable.
 * Works for both SDK streams (openai.ts) and raw-parsed objects (chatgpt.ts).
 */
type ResponseToolBuffer = { id: string; name: string; args: string };

type ResponsesAPIState = {
  contentBlocks: ContentBlock[];
  currentText: string;
  currentThinking: string;
  currentToolId: string;
  stopReason: StopReason;
  usage: Usage;
  toolBuffers: Map<string, ResponseToolBuffer>;
};

type ResponsesAPIDecodedEvent =
  | { kind: "text_delta"; delta: string }
  | { kind: "thinking_delta"; delta: string }
  | { kind: "tool_call_start"; id: string; name: string }
  | { kind: "tool_call_args_delta"; itemId?: string; delta: string }
  | { kind: "reasoning_done"; summaryText: string }
  | { kind: "message_done"; texts: string[] }
  | { kind: "tool_call_done"; id: string; name: string; args: string }
  | {
      kind: "response_completed";
      usage?: {
        input_tokens: number;
        output_tokens: number;
        input_tokens_details?: { cached_tokens?: number };
        output_tokens_details?: { reasoning_tokens?: number };
      };
      status?: string;
    }
  | { kind: "response_failed"; message: string };

function createResponsesAPIState(): ResponsesAPIState {
  return {
    contentBlocks: [],
    currentText: "",
    currentThinking: "",
    currentToolId: "",
    stopReason: "end_turn",
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    toolBuffers: new Map<string, ResponseToolBuffer>(),
  };
}

function decodeResponsesAPIEvent(event: Record<string, unknown>): ResponsesAPIDecodedEvent | undefined {
  const type = event.type as string;

  switch (type) {
    case "response.output_text.delta": {
      const delta = event.delta as string;
      if (!delta) return undefined;
      return { kind: "text_delta", delta };
    }
    case "response.reasoning_summary_text.delta": {
      const delta = event.delta as string;
      if (!delta) return undefined;
      return { kind: "thinking_delta", delta };
    }
    case "response.output_item.added": {
      const item = event.item as Record<string, unknown> | undefined;
      if (item?.type !== "function_call") return undefined;
      return { kind: "tool_call_start", id: (item.call_id as string) ?? "", name: (item.name as string) ?? "" };
    }
    case "response.function_call_arguments.delta": {
      const delta = event.delta as string;
      if (!delta) return undefined;
      return { kind: "tool_call_args_delta", itemId: event.item_id as string | undefined, delta };
    }
    case "response.output_item.done": {
      const item = event.item as Record<string, unknown> | undefined;
      if (!item) return undefined;
      if (item.type === "reasoning") {
        return { kind: "reasoning_done", summaryText: extractReasoningSummaryText(item.summary) };
      }
      if (item.type === "message") {
        return { kind: "message_done", texts: extractOutputTexts(item.content) };
      }
      if (item.type === "function_call") {
        return {
          kind: "tool_call_done",
          id: (item.call_id as string) ?? "",
          name: (item.name as string) ?? "",
          args: (item.arguments as string) ?? "",
        };
      }
      return undefined;
    }
    case "response.completed": {
      const response = event.response as Record<string, unknown> | undefined;
      if (!response) return undefined;
      return {
        kind: "response_completed",
        usage: response.usage as {
          input_tokens: number;
          output_tokens: number;
          input_tokens_details?: { cached_tokens?: number };
          output_tokens_details?: { reasoning_tokens?: number };
        },
        status: response.status as string | undefined,
      };
    }
    case "response.failed": {
      const response = event.response as Record<string, unknown> | undefined;
      const responseError = response?.error as Record<string, unknown> | undefined;
      return { kind: "response_failed", message: (responseError?.message as string) ?? "Response failed" };
    }
    default:
      return undefined;
  }
}

function reduceResponsesAPIEvent(state: ResponsesAPIState, event: ResponsesAPIDecodedEvent): ProviderEvent[] {
  switch (event.kind) {
    case "text_delta":
      state.currentText += event.delta;
      return [{ type: "text_delta", delta: event.delta }];

    case "thinking_delta":
      state.currentThinking += event.delta;
      return [{ type: "thinking_delta", delta: event.delta }];

    case "tool_call_start":
      state.currentToolId = event.id;
      state.toolBuffers.set(event.id, { id: event.id, name: event.name, args: "" });
      return [{ type: "tool_call_start", id: event.id, name: event.name }];

    case "tool_call_args_delta": {
      const itemId = event.itemId ?? state.currentToolId;
      const buffer = state.toolBuffers.get(itemId);
      if (buffer) {
        buffer.args += event.delta;
        return [{ type: "tool_call_delta", id: buffer.id, delta: event.delta }];
      }
      if (state.currentToolId) {
        return [{ type: "tool_call_delta", id: state.currentToolId, delta: event.delta }];
      }
      return [];
    }

    case "reasoning_done": {
      const finalThinking = state.currentThinking || event.summaryText;
      if (!finalThinking) return [];
      state.currentThinking = "";
      state.contentBlocks.unshift({ type: "thinking", thinking: finalThinking });
      return [{ type: "thinking_end", thinking: finalThinking }];
    }

    case "message_done": {
      if (event.texts.length === 0) return [];
      state.currentText = "";
      return event.texts.map((text) => {
        state.contentBlocks.push({ type: "text", text });
        return { type: "text_end", text } as const;
      });
    }

    case "tool_call_done": {
      let input: Record<string, unknown>;
      try {
        input = JSON.parse(event.args) as Record<string, unknown>;
      } catch {
        input = {};
      }
      state.toolBuffers.delete(event.id);
      state.contentBlocks.push({ type: "tool_call", id: event.id, name: event.name, input });
      return [{ type: "tool_call_end", id: event.id, name: event.name, input }];
    }

    case "response_completed":
      state.usage = mapUsage(event.usage);
      state.stopReason = mapStopReason(event.status);
      return [];

    case "response_failed": {
      const errorType = isContextOverflow(event.message) ? "context_overflow" : "unknown";
      return [{ type: "error", error: new ProviderError(event.message, errorType, false) }];
    }
  }
}

function emitProviderEvents(stream: EventStream<ProviderEvent, ProviderResult>, events: ProviderEvent[]): void {
  for (const event of events) {
    stream.push(event);
  }
}

function extractReasoningSummaryText(summary: unknown): string {
  if (!Array.isArray(summary)) return "";
  return summary
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const text = (part as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    })
    .filter((text) => text.length > 0)
    .join("\n");
}

function extractOutputTexts(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const texts: string[] = [];
  for (const rawPart of content) {
    if (!rawPart || typeof rawPart !== "object") continue;
    const part = rawPart as { type?: unknown; text?: unknown };
    if (part.type === "output_text" && typeof part.text === "string") {
      texts.push(part.text);
    }
  }
  return texts;
}

export async function handleResponsesAPIEvents(
  iter: AsyncIterable<Record<string, unknown>>,
  stream: EventStream<ProviderEvent, ProviderResult>,
  model: Model,
  signal?: AbortSignal,
  _turnIndex?: number,
  _sessionId?: string,
): Promise<void> {
  const state = createResponsesAPIState();

  for await (const event of iter) {
    if (signal?.aborted) break;
    const decodedEvent = decodeResponsesAPIEvent(event);
    if (!decodedEvent) continue;
    const emittedEvents = reduceResponsesAPIEvent(state, decodedEvent);
    emitProviderEvents(stream, emittedEvents);
    if (emittedEvents.some((providerEvent) => providerEvent.type === "error")) return;
  }

  if (signal?.aborted) return;

  // Flush any remaining text that wasn't closed by output_item.done
  if (state.currentText) {
    const text = state.currentText;
    state.currentText = "";
    state.contentBlocks.push({ type: "text", text });
    stream.push({ type: "text_end", text });
  }

  stream.push({ type: "usage", usage: state.usage });

  const assistantMessage: AssistantMessage = {
    role: "assistant",
    content: state.contentBlocks,
    model: model.id,
    usage: state.usage,
    stopReason: state.stopReason,
    timestamp: Date.now(),
  };

  stream.push({ type: "done", stopReason: state.stopReason, message: assistantMessage });
}
