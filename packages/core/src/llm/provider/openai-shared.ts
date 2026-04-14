// @summary Shared OpenAI Responses API utilities: message conversion, stop reason mapping, tool building, and SSE event handling
import type { ResponseInputItem, ResponseInputMessageContentList } from "openai/resources/responses/responses";
import type { EventStream } from "../../event-stream";
import type { AssistantMessage, ContentBlock, Message, StopReason, Usage } from "../../types";
import { materializeUserContentBlocks } from "../image-io";
import type {
  FunctionToolDefinition,
  Model,
  ProviderBuiltinToolDefinition,
  ProviderEvent,
  ProviderResult,
  ToolDefinition,
} from "../types";
import { ProviderError } from "../types";

export type ResponsesReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";

export async function convertMessages(messages: Message[], cwd?: string): Promise<ResponseInputItem[]> {
  const result: ResponseInputItem[] = [];
  // Track function_calls that haven't been matched with an output yet (call_id -> index in result)
  const pendingCalls = new Map<string, number>();

  for (const msg of messages) {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        result.push({ type: "message", role: "user", content: [{ type: "input_text", text: msg.content }] });
      } else {
        const blocks = await materializeUserContentBlocks(msg.content, { cwd });
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

export async function toResponseInputItems(input: {
  messages: Message[];
  cwd?: string;
  compactionSummary?: Record<string, unknown>;
}): Promise<ResponseInputItem[]> {
  const convertedMessages = await convertMessages(input.messages, input.cwd);
  if (input.compactionSummary) {
    return [input.compactionSummary as unknown as ResponseInputItem, ...convertedMessages];
  }
  return convertedMessages;
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

export function toResponsesReasoningEffort(
  effort: "none" | "low" | "medium" | "high" | "max",
): ResponsesReasoningEffort {
  if (effort === "max") return "xhigh";
  return effort;
}

type OpenAIFunctionTool = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
};

type OpenAIWebSearchTool = {
  type: "web_search" | "web_search_preview";
  filters?: { allowed_domains?: string[] };
  search_context_size?: "low" | "medium" | "high";
  user_location?: {
    type: "approximate";
    city?: string;
    country?: string;
    region?: string;
    timezone?: string;
  };
};

export type OpenAIResponsesTool = OpenAIFunctionTool | OpenAIWebSearchTool;

function mapContextSize(maxContentTokens?: number): OpenAIWebSearchTool["search_context_size"] {
  if (maxContentTokens === undefined) return undefined;
  if (maxContentTokens <= 2_000) return "low";
  if (maxContentTokens <= 8_000) return "medium";
  return "high";
}

function mergeWebSearchTools(tools: ProviderBuiltinToolDefinition[]): OpenAIWebSearchTool | undefined {
  if (tools.length === 0) return undefined;

  const allowedDomains = Array.from(
    new Set(tools.flatMap((tool) => tool.options?.allowedDomains ?? []).filter((value) => value.length > 0)),
  );
  const contextSizes = tools
    .map((tool) => mapContextSize(tool.options?.maxContentTokens))
    .filter((value): value is "low" | "medium" | "high" => value !== undefined);
  const userLocation = tools.map((tool) => tool.options?.userLocation).find((value) => value !== undefined);

  return {
    type: "web_search",
    ...(allowedDomains.length > 0 ? { filters: { allowed_domains: allowedDomains } } : {}),
    ...(contextSizes.includes("high")
      ? { search_context_size: "high" as const }
      : contextSizes.includes("medium")
        ? { search_context_size: "medium" as const }
        : contextSizes.includes("low")
          ? { search_context_size: "low" as const }
          : {}),
    ...(userLocation ? { user_location: userLocation } : {}),
  };
}

export function buildTools(tools: ToolDefinition[], strict?: boolean): OpenAIResponsesTool[] {
  const functionTools: OpenAIFunctionTool[] = tools.flatMap((tool) => {
    if (tool.kind !== "function") return [];
    const t: FunctionToolDefinition = tool;
    return [
      {
        type: "function" as const,
        name: t.name,
        description: t.description,
        parameters: { type: "object", ...t.inputSchema },
        ...(strict !== undefined && { strict }),
      },
    ];
  });

  const webTool = mergeWebSearchTools(
    tools.filter((tool): tool is ProviderBuiltinToolDefinition => tool.kind === "provider_builtin"),
  );

  return webTool ? [...functionTools, webTool] : functionTools;
}

export async function buildResponsesRequestBody(input: {
  model: string;
  messages: Message[];
  cwd?: string;
  compactionSummary?: Record<string, unknown>;
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
    input: await toResponseInputItems({
      messages: input.messages,
      cwd: input.cwd,
      compactionSummary: input.compactionSummary,
    }),
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
  if (input.tools?.some((tool) => tool.kind === "provider_builtin")) {
    const existing = Array.isArray(body.include) ? body.include : [];
    body.include = [...new Set([...existing, "web_search_call.action.sources"])];
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

function pushText(chunks: string[], value: unknown): void {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (trimmed.length === 0) return;
  chunks.push(trimmed);
}

function pushReasoningSummary(chunks: string[], value: unknown): void {
  if (!Array.isArray(value)) return;
  for (const rawPart of value) {
    if (!rawPart || typeof rawPart !== "object") continue;
    const part = rawPart as Record<string, unknown>;
    pushText(chunks, part.text);
  }
}

function extractCompactionTranscriptFromOutput(output: unknown): string | undefined {
  if (!Array.isArray(output)) return undefined;

  const parts: string[] = [];
  for (const rawItem of output) {
    if (!rawItem || typeof rawItem !== "object") continue;
    const item = rawItem as Record<string, unknown>;
    if (item.type !== "message") continue;

    const role = typeof item.role === "string" ? item.role : undefined;
    if (!Array.isArray(item.content)) continue;

    const textChunks: string[] = [];
    for (const rawPart of item.content) {
      if (!rawPart || typeof rawPart !== "object") continue;
      const part = rawPart as Record<string, unknown>;
      const type = typeof part.type === "string" ? part.type : undefined;
      if ((type === "input_text" || type === "output_text" || type === "text") && typeof part.text === "string") {
        const trimmed = part.text.trim();
        if (trimmed.length > 0) textChunks.push(trimmed);
      }
    }

    if (textChunks.length === 0) continue;
    const body = textChunks.join("\n");
    if (role === "assistant") {
      parts.push(`<assistant>\n${body}\n</assistant>`);
    } else {
      parts.push(`<user>\n${body}\n</user>`);
    }
  }

  if (parts.length === 0) return undefined;
  return parts.join("\n\n");
}

function extractCompactionSummaryFromOutput(output: unknown): string | undefined {
  if (!Array.isArray(output)) return undefined;

  const chunks: string[] = [];
  for (const rawItem of output) {
    if (!rawItem || typeof rawItem !== "object") continue;
    const item = rawItem as Record<string, unknown>;

    pushText(chunks, item.summary);
    pushReasoningSummary(chunks, item.summary);
    pushText(chunks, item.compaction_summary);
    pushText(chunks, item.compacted_summary);
    if (item.type !== "message" || !Array.isArray(item.content)) {
      pushText(chunks, item.text);
    }

    if (item.type === "message") {
      if (Array.isArray(item.content)) {
        for (const rawPart of item.content) {
          if (typeof rawPart === "string") {
            continue;
          }
          if (!rawPart || typeof rawPart !== "object") continue;
          const part = rawPart as Record<string, unknown>;
          pushText(chunks, part.summary);
          pushReasoningSummary(chunks, part.summary);
          pushText(chunks, part.compaction_summary);
          pushText(chunks, part.compacted_summary);
          if (part.type === "output_text" || part.type === "text") {
            pushText(chunks, part.text);
          }
        }
      } else {
        if (typeof item.role !== "string" || item.role !== "user") {
          pushText(chunks, item.content);
        }
      }
      continue;
    }

    if (item.type === "output_text" || item.type === "text") {
      pushText(chunks, item.text);
    }
  }

  if (chunks.length === 0) return undefined;
  return chunks.join("\n");
}

function summarizeOutputShape(output: unknown): string {
  if (!Array.isArray(output)) return "none";
  const shapes = output.slice(0, 8).map((rawItem) => {
    if (!rawItem || typeof rawItem !== "object") return "unknown";
    const item = rawItem as Record<string, unknown>;
    const itemType = typeof item.type === "string" ? item.type : "unknown";
    if (!Array.isArray(item.content)) return itemType;
    const contentTypes = item.content
      .slice(0, 3)
      .map((rawPart) => {
        if (!rawPart || typeof rawPart !== "object") return typeof rawPart;
        const part = rawPart as Record<string, unknown>;
        return typeof part.type === "string" ? part.type : "obj";
      })
      .join("+");
    return `${itemType}[${contentTypes || "empty"}]`;
  });
  return shapes.join(";") || "empty";
}

function countStructuredCompactionItems(output: unknown): number {
  if (!Array.isArray(output)) return 0;
  return output.filter((rawItem) => {
    if (!rawItem || typeof rawItem !== "object") return false;
    const item = rawItem as Record<string, unknown>;
    const itemType = typeof item.type === "string" ? item.type : "";
    return itemType === "compaction" || itemType === "compaction_summary";
  }).length;
}

export function describeCompactionPayload(payload: Record<string, unknown>): string {
  const keys = Object.keys(payload);
  const topKeys = keys.length > 0 ? keys.slice(0, 8).join(",") : "none";
  const outputLen = Array.isArray(payload.output) ? payload.output.length : 0;
  const outputShape = summarizeOutputShape(payload.output);
  const structuredCompactionItems = countStructuredCompactionItems(payload.output);
  return `payload_keys=${topKeys} output_items=${outputLen} output_shape=${outputShape} structured_compaction_items=${structuredCompactionItems}`;
}

export function extractCompactionSummary(payload: Record<string, unknown>): string | undefined {
  if (typeof payload.summary === "string") return payload.summary;
  if (typeof payload.compaction_summary === "string") return payload.compaction_summary;
  if (typeof payload.compacted_summary === "string") return payload.compacted_summary;
  if (extractCompactionSummaryItem(payload)) return undefined;
  const fromOutput = extractCompactionSummaryFromOutput(payload.output);
  if (fromOutput) return fromOutput;
  const transcript = extractCompactionTranscriptFromOutput(payload.output);
  if (transcript) return transcript;
  return undefined;
}

export function extractCompactionSummaryItem(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!Array.isArray(payload.output)) return undefined;
  for (const rawItem of payload.output) {
    if (!rawItem || typeof rawItem !== "object") continue;
    const item = rawItem as Record<string, unknown>;
    const itemType = typeof item.type === "string" ? item.type : "";
    if (
      (itemType === "compaction" || itemType === "compaction_summary") &&
      typeof item.encrypted_content === "string"
    ) {
      return { type: "compaction", encrypted_content: item.encrypted_content };
    }
  }
  return undefined;
}

/**
 * Process OpenAI Responses API SSE events from an async iterable.
 * Works for both SDK streams (openai.ts) and raw-parsed objects (chatgpt.ts).
 */
type ResponseToolBuffer = { id: string; name: string; args: string };

type ProviderName = "openai" | "chatgpt" | "anthropic";
type ProviderToolUseBlock = Extract<ContentBlock, { type: "provider_tool_use" }>;
type WebSearchResultBlock = Extract<ContentBlock, { type: "web_search_result" }>;
type WebFetchResultBlock = Extract<ContentBlock, { type: "web_fetch_result" }>;

type ResponsesAPIState = {
  contentBlocks: ContentBlock[];
  pendingProviderToolUses: Map<string, ProviderToolUseBlock>;
  pendingWebSearchResults: Map<string, WebSearchResultBlock>;
  pendingWebFetchResults: Map<string, WebFetchResultBlock>;
  pendingCompletedResponse?: Record<string, unknown>;
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
  | { kind: "provider_web_call_start"; item: Record<string, unknown> }
  | { kind: "tool_call_args_delta"; itemId?: string; delta: string }
  | { kind: "reasoning_done"; summaryText: string }
  | { kind: "message_done"; blocks: ContentBlock[] }
  | { kind: "tool_call_done"; id: string; name: string; args: string }
  | { kind: "provider_web_call_done"; item: Record<string, unknown> }
  | {
      kind: "response_completed";
      response?: Record<string, unknown>;
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
    pendingProviderToolUses: new Map<string, ProviderToolUseBlock>(),
    pendingWebSearchResults: new Map<string, WebSearchResultBlock>(),
    pendingWebFetchResults: new Map<string, WebFetchResultBlock>(),
    pendingCompletedResponse: undefined,
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
      if (!item) return undefined;
      if (item.type === "web_search_call") {
        return { kind: "provider_web_call_start", item };
      }
      if (item.type !== "function_call") return undefined;
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
        return { kind: "message_done", blocks: extractOutputContentBlocks(item.content) };
      }
      if (item.type === "function_call") {
        return {
          kind: "tool_call_done",
          id: (item.call_id as string) ?? "",
          name: (item.name as string) ?? "",
          args: (item.arguments as string) ?? "",
        };
      }
      if (item.type === "web_search_call") {
        return { kind: "provider_web_call_done", item };
      }
      return undefined;
    }
    case "response.completed": {
      const response = event.response as Record<string, unknown> | undefined;
      if (!response) return undefined;
      return {
        kind: "response_completed",
        response,
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

function reduceResponsesAPIEvent(
  state: ResponsesAPIState,
  event: ResponsesAPIDecodedEvent,
  model: Model,
): ProviderEvent[] {
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

    case "provider_web_call_start": {
      debugWebSearchPayload("start", event.item, model.provider);
      const providerToolUse = createProviderToolUseBlock(event.item, model.provider);
      if (!providerToolUse) return [];
      state.pendingProviderToolUses.set(providerToolUse.id, providerToolUse);
      state.contentBlocks.push(providerToolUse);
      return [{ type: "content_block", block: providerToolUse }];
    }

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
      if (event.blocks.length === 0) return [];
      state.currentText = "";
      const emitted: ProviderEvent[] = [];
      for (const block of event.blocks) {
        state.contentBlocks.push(block);
        if (block.type === "text") emitted.push({ type: "text_end", text: block.text });
      }
      return emitted;
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

    case "provider_web_call_done": {
      debugWebSearchPayload("done", event.item, model.provider);
      const toolUseId = getProviderToolUseId(event.item);
      if (!toolUseId) return [];
      if (!state.pendingProviderToolUses.has(toolUseId)) {
        const providerToolUse = createProviderToolUseBlock(event.item, model.provider);
        if (providerToolUse) {
          state.pendingProviderToolUses.set(toolUseId, providerToolUse);
          state.contentBlocks.push(providerToolUse);
        }
      }
      const webSearchResult = createWebSearchResultBlock(event.item, toolUseId, model.provider);
      if (webSearchResult) {
        state.pendingWebSearchResults.set(toolUseId, webSearchResult);
        state.contentBlocks.push(webSearchResult);
        return [{ type: "content_block", block: webSearchResult }];
      }
      const webFetchResult = createWebFetchResultBlock(event.item, toolUseId, model.provider);
      if (webFetchResult) {
        state.pendingWebFetchResults.set(toolUseId, webFetchResult);
        state.contentBlocks.push(webFetchResult);
        return [{ type: "content_block", block: webFetchResult }];
      }
      return [];
    }

    case "response_completed":
      state.pendingCompletedResponse = event.response;
      applyCompletedResponseFallbacks(state, event.response, model.provider);
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

function getProviderName(provider: string): ProviderName {
  return provider === "chatgpt" ? "chatgpt" : provider === "anthropic" ? "anthropic" : "openai";
}

function getProviderToolUseId(item: Record<string, unknown>): string | undefined {
  const callId = item.call_id;
  if (typeof callId === "string" && callId.length > 0) return callId;
  const id = item.id;
  if (typeof id === "string" && id.length > 0) return id;
  return undefined;
}

function getWebAction(item: Record<string, unknown>): Record<string, unknown> | undefined {
  const action = item.action;
  return action && typeof action === "object" ? (action as Record<string, unknown>) : undefined;
}

function getCapabilityName(actionType: unknown): ProviderToolUseBlock["name"] | undefined {
  return actionType === "search"
    ? "web_search"
    : actionType === "open_page" || actionType === "find_in_page"
      ? "web_fetch"
      : undefined;
}

function createProviderToolUseBlock(item: Record<string, unknown>, provider: string): ProviderToolUseBlock | undefined {
  const id = getProviderToolUseId(item);
  const action = getWebAction(item);
  const actionType = action?.type ?? item.action_type;
  const status = typeof item.status === "string" ? item.status : undefined;
  const name = getCapabilityName(actionType) ?? (item.type === "web_search_call" ? "web_search" : undefined);
  if (!id || !name) return undefined;
  const input = action ?? (actionType ? { type: actionType } : status === "in_progress" ? { type: "search" } : {});
  const sources = normalizeSources(item);
  return {
    type: "provider_tool_use",
    id,
    provider: getProviderName(provider),
    name,
    input: sources.length > 0 ? { ...input, sources } : input,
  };
}

function normalizeSources(item: Record<string, unknown>): Array<Record<string, unknown>> {
  const action = getWebAction(item);
  const output = item.output && typeof item.output === "object" ? (item.output as Record<string, unknown>) : undefined;
  const result = item.result && typeof item.result === "object" ? (item.result as Record<string, unknown>) : undefined;
  const page = item.page && typeof item.page === "object" ? (item.page as Record<string, unknown>) : undefined;
  const candidateArrays = [
    action?.sources,
    item.sources,
    item.results,
    output?.sources,
    output?.results,
    output?.data,
    result?.sources,
    result?.results,
    page?.sources,
    page?.results,
    item.data,
  ];
  for (const candidate of candidateArrays) {
    if (!Array.isArray(candidate)) continue;
    return candidate.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object");
  }
  return [];
}

function collectDocumentCandidates(item: Record<string, unknown>): Record<string, unknown>[] {
  const output = item.output && typeof item.output === "object" ? (item.output as Record<string, unknown>) : undefined;
  const result = item.result && typeof item.result === "object" ? (item.result as Record<string, unknown>) : undefined;
  const page = item.page && typeof item.page === "object" ? (item.page as Record<string, unknown>) : undefined;
  const content =
    item.content && typeof item.content === "object" ? (item.content as Record<string, unknown>) : undefined;
  const candidates = [
    item.document,
    item.page,
    item.content,
    item.result,
    item.output,
    output?.document,
    output?.page,
    output?.content,
    output?.result,
    result?.document,
    result?.page,
    result?.content,
    page,
    content,
  ];
  return candidates.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object");
}

function pickDocumentString(candidates: Record<string, unknown>[], keys: string[]): string | undefined {
  for (const candidate of candidates) {
    const value = pickString(candidate, keys);
    if (value) return value;
  }
  return undefined;
}

function debugWebSearchPayload(
  stage: "start" | "done" | "completed",
  item: Record<string, unknown> | undefined,
  provider: string,
): void {
  if (process.env.DILIGENT_DEBUG_WEB_TOOLS !== "1") return;
  const summary = {
    provider,
    stage,
    itemType: item?.type,
    callId: item?.call_id,
    actionType: getWebAction(item ?? {})?.type ?? item?.action_type,
    keys: item ? Object.keys(item).slice(0, 20) : [],
    actionKeys: getWebAction(item ?? {}) ? Object.keys(getWebAction(item ?? {})!).slice(0, 20) : [],
    sourcesLen: normalizeSources(item ?? {}).length,
  };
  console.log(`[llm:web-tools] ${JSON.stringify(summary)}`);
}

function collectCompletedWebSearchCalls(response: Record<string, unknown> | undefined): Record<string, unknown>[] {
  const output = response?.output;
  if (!Array.isArray(output)) return [];
  return output.filter((item): item is Record<string, unknown> => {
    return Boolean(item) && typeof item === "object" && (item as Record<string, unknown>).type === "web_search_call";
  });
}

function applyCompletedResponseFallbacks(
  state: ResponsesAPIState,
  response: Record<string, unknown> | undefined,
  provider: string,
): void {
  const items = collectCompletedWebSearchCalls(response);
  if (items.length === 0) return;
  let recoveredToolUses = 0;
  let recoveredSearchResults = 0;
  let recoveredFetchResults = 0;
  for (const item of items) {
    debugWebSearchPayload("completed", item, provider);
    const toolUseId = getProviderToolUseId(item);
    if (!toolUseId) continue;

    if (!state.pendingProviderToolUses.has(toolUseId)) {
      const providerToolUse = createProviderToolUseBlock(item, provider);
      if (providerToolUse) {
        state.pendingProviderToolUses.set(toolUseId, providerToolUse);
        state.contentBlocks.push(providerToolUse);
        recoveredToolUses += 1;
      }
    }

    if (!state.pendingWebSearchResults.has(toolUseId)) {
      const webSearchResult = createWebSearchResultBlock(item, toolUseId, provider);
      if (webSearchResult && webSearchResult.results.length > 0) {
        state.pendingWebSearchResults.set(toolUseId, webSearchResult);
        state.contentBlocks.push(webSearchResult);
        recoveredSearchResults += 1;
      }
    }

    if (!state.pendingWebFetchResults.has(toolUseId)) {
      const webFetchResult = createWebFetchResultBlock(item, toolUseId, provider);
      if (webFetchResult) {
        state.pendingWebFetchResults.set(toolUseId, webFetchResult);
        state.contentBlocks.push(webFetchResult);
        recoveredFetchResults += 1;
      }
    }
  }

  const recoveredCalls = recoveredToolUses + recoveredSearchResults + recoveredFetchResults;
  if (recoveredCalls > 0) {
    return;
  }
}

function createWebSearchResultBlock(
  item: Record<string, unknown>,
  toolUseId: string,
  provider: string,
): WebSearchResultBlock | undefined {
  const action = getWebAction(item);
  if (action?.type !== "search") return undefined;
  const providerToolUse = createProviderToolUseBlock(item, provider);
  const providerSources = Array.isArray(providerToolUse?.input.sources)
    ? (providerToolUse?.input.sources as Array<Record<string, unknown>>)
    : [];
  const results = normalizeSources(item)
    .map((source) => {
      const url = typeof source.url === "string" ? source.url : "";
      const providerSource = providerSources.find((candidate) => candidate.url === url);
      return {
        url,
        ...(typeof source.title === "string"
          ? { title: source.title }
          : typeof providerSource?.title === "string"
            ? { title: providerSource.title }
            : {}),
        ...(typeof source.page_age === "string" ? { pageAge: source.page_age } : {}),
        ...(typeof source.snippet === "string"
          ? { snippet: source.snippet }
          : typeof providerSource?.snippet === "string"
            ? { snippet: providerSource.snippet }
            : {}),
        ...(typeof source.encrypted_content === "string"
          ? { encryptedContent: source.encrypted_content }
          : typeof providerSource?.encrypted_content === "string"
            ? { encryptedContent: providerSource.encrypted_content }
            : {}),
      };
    })
    .filter((result) => result.url.length > 0);
  return {
    type: "web_search_result",
    toolUseId,
    provider: getProviderName(provider),
    results,
  };
}

function pickString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function createWebFetchResultBlock(
  item: Record<string, unknown>,
  toolUseId: string,
  provider: string,
): WebFetchResultBlock | undefined {
  const action = getWebAction(item);
  if (action?.type !== "open_page" && action?.type !== "find_in_page") return undefined;

  const sources = normalizeSources(item);
  const source = sources[0];
  const url = pickString(action, ["url"]) ?? (source ? pickString(source, ["url"]) : undefined);
  if (!url) return undefined;

  const documentCandidates = [...collectDocumentCandidates(item), ...(source ? [source] : [])];
  const text = pickDocumentString(documentCandidates, ["text", "content", "snippet", "body", "markdown"]);
  const mimeType = pickDocumentString(documentCandidates, ["mime_type", "mimeType", "content_type", "contentType"]);
  const title = pickDocumentString(documentCandidates, ["title", "page_title", "pageTitle"]);
  const base64Data = pickDocumentString(documentCandidates, ["base64_data", "base64Data", "data"]);
  const retrievedAt =
    pickString(item, ["retrieved_at", "retrievedAt"]) ??
    pickDocumentString(documentCandidates, ["retrieved_at", "retrievedAt"]);

  return {
    type: "web_fetch_result",
    toolUseId,
    provider: getProviderName(provider),
    url,
    ...(text || mimeType || title || base64Data
      ? {
          document: {
            mimeType: mimeType ?? "text/html",
            ...(text ? { text } : {}),
            ...(base64Data ? { base64Data } : {}),
            ...(title ? { title } : {}),
            citationsEnabled: true,
          },
        }
      : {}),
    ...(retrievedAt ? { retrievedAt } : {}),
  };
}

function extractCitations(part: {
  text?: unknown;
  annotations?: unknown;
}): Array<NonNullable<Extract<ContentBlock, { type: "text" }>["citations"]>[number]> | undefined {
  if (!Array.isArray(part.annotations)) return undefined;
  const text = typeof part.text === "string" ? part.text : "";
  const citations: Array<NonNullable<Extract<ContentBlock, { type: "text" }>["citations"]>[number]> = [];
  for (const annotation of part.annotations) {
    if (!annotation || typeof annotation !== "object") continue;
    const raw = annotation as Record<string, unknown>;
    const annotationType = raw.type;
    const startIndex = typeof raw.start_index === "number" ? raw.start_index : undefined;
    const endIndex = typeof raw.end_index === "number" ? raw.end_index : undefined;
    const citedText =
      startIndex !== undefined && endIndex !== undefined && endIndex > startIndex
        ? text.slice(startIndex, endIndex)
        : undefined;

    if (
      (annotationType === "url_citation" || annotationType === "web_search_result_location") &&
      typeof raw.url === "string"
    ) {
      citations.push({
        type: "web_search_result_location",
        url: raw.url,
        ...(typeof raw.title === "string" ? { title: raw.title } : {}),
        ...(typeof raw.encrypted_index === "string" ? { encryptedIndex: raw.encrypted_index } : {}),
        ...(citedText ? { citedText } : {}),
      });
      continue;
    }

    const documentIndex = typeof raw.document_index === "number" ? raw.document_index : undefined;
    if ((annotationType === "file_citation" || annotationType === "char_location") && documentIndex !== undefined) {
      citations.push({
        type: "char_location",
        documentIndex,
        ...(typeof raw.document_title === "string" ? { documentTitle: raw.document_title } : {}),
        startCharIndex: startIndex ?? 0,
        endCharIndex: endIndex ?? 0,
        ...(citedText ? { citedText } : {}),
      });
    }
  }

  return citations.length > 0 ? citations : undefined;
}

function extractOutputContentBlocks(content: unknown): ContentBlock[] {
  if (!Array.isArray(content)) return [];
  const blocks: ContentBlock[] = [];
  for (const rawPart of content) {
    if (!rawPart || typeof rawPart !== "object") continue;
    const part = rawPart as { type?: unknown; text?: unknown; annotations?: unknown };
    if (part.type === "output_text" && typeof part.text === "string") {
      const citations = extractCitations(part);
      blocks.push({
        type: "text",
        text: part.text,
        ...(citations ? { citations } : {}),
      });
    }
  }
  return blocks;
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
    const emittedEvents = reduceResponsesAPIEvent(state, decodedEvent, model);
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
