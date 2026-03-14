// @summary Anthropic provider implementation with thinking, streaming, and message conversion
import Anthropic from "@anthropic-ai/sdk";
import { EventStream } from "../../event-stream";
import type { AssistantMessage, ContentBlock, Message, StopReason, Usage } from "../../types";
import { isNetworkError } from "../errors";
import { materializeUserContentBlocks } from "../image-io";
import { normalizeThinkingEffort } from "../thinking-effort";
import type {
  Model,
  ProviderEvent,
  ProviderResult,
  StreamContext,
  StreamFunction,
  StreamOptions,
  SystemSection,
  ToolDefinition,
} from "../types";
import { ProviderError } from "../types";
import type { NativeCompactFn } from "./native-compaction";

export function createAnthropicStream(apiKey: string, baseUrl?: string): StreamFunction {
  const resolvedSdkBaseUrl = resolveAnthropicSdkBaseUrl(baseUrl);
  const debugEndpoint = `${resolvedSdkBaseUrl.replace(/\/+$/, "")}/v1/messages`;
  const client = new Anthropic({ apiKey, baseURL: resolvedSdkBaseUrl });

  return (model: Model, context: StreamContext, options: StreamOptions): EventStream<ProviderEvent, ProviderResult> => {
    const stream = new EventStream<ProviderEvent, ProviderResult>(
      (event) => event.type === "done" || event.type === "error",
      (event) => {
        if (event.type === "done") return { message: event.message };
        throw (event as { type: "error"; error: Error }).error;
      },
    );

    if (options.signal) stream.attachSignal(options.signal);

    (async () => {
      try {
        const effort = normalizeThinkingEffort(options.effort);
        const useAdaptive = model.supportsThinking && model.supportsAdaptiveThinking;
        const useBudget = model.supportsThinking && !model.supportsAdaptiveThinking;
        const useThinking = useAdaptive || useBudget;
        const budgetKey = effort === "none" ? "low" : effort;

        const budgetTokens = useThinking
          ? (model.thinkingBudgets?.[budgetKey] ?? model.defaultBudgetTokens ?? 8_000)
          : 0;

        const thinkingConfig = useAdaptive
          ? {
              thinking: { type: "adaptive" } as Anthropic.ThinkingConfigParam,
              output_config: { effort },
              temperature: 1,
            }
          : useBudget
            ? {
                thinking: { type: "enabled", budget_tokens: budgetTokens } as Anthropic.ThinkingConfigParam,
                temperature: 1,
              }
            : options.temperature !== undefined
              ? { temperature: options.temperature }
              : {};

        const systemBlocks = toAnthropicBlocks(context.systemPrompt);
        const requestParams = {
          model: model.id,
          max_tokens: options.maxTokens ?? model.maxOutputTokens,
          system: systemBlocks,
          messages: await convertMessages(context.messages),
          ...(context.tools.length > 0 && { tools: convertTools(context.tools) }),
          ...thinkingConfig,
        } as Anthropic.MessageCreateParams;

        if (process.env.ANTHROPIC_DEBUG_REQUEST === "1") {
          console.error("[anthropic.endpoint]", debugEndpoint);
          console.error("[anthropic.request]", JSON.stringify(requestParams, null, 2));
        }

        const sdkStream = client.messages.stream(
          requestParams,
          ...(options.signal ? [{ signal: options.signal }] : []),
        );

        stream.push({ type: "start" });

        // Track active tool call for delta routing
        let activeToolId: string | undefined;

        sdkStream.on("text", (textDelta) => {
          stream.push({ type: "text_delta", delta: textDelta });
        });

        sdkStream.on("thinking", (thinkingDelta) => {
          stream.push({ type: "thinking_delta", delta: thinkingDelta });
        });

        sdkStream.on("inputJson", (partialJson) => {
          if (activeToolId) {
            stream.push({ type: "tool_call_delta", id: activeToolId, delta: partialJson });
          }
        });

        sdkStream.on("contentBlock", (block) => {
          if (block.type === "text") {
            stream.push({ type: "text_end", text: block.text });
          } else if (block.type === "thinking") {
            stream.push({ type: "thinking_end", thinking: block.thinking });
          } else if (block.type === "tool_use") {
            stream.push({
              type: "tool_call_end",
              id: block.id,
              name: block.name,
              input: block.input as Record<string, unknown>,
            });
            activeToolId = undefined;
          }
        });

        sdkStream.on("streamEvent", (event) => {
          if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
            activeToolId = event.content_block.id;
            stream.push({ type: "tool_call_start", id: event.content_block.id, name: event.content_block.name });
          }
        });

        const finalMessage = await sdkStream.finalMessage();
        const assistantMessage = mapToAssistantMessage(finalMessage, model);
        stream.push({
          type: "usage",
          usage: assistantMessage.usage,
        });
        stream.push({
          type: "done",
          stopReason: assistantMessage.stopReason,
          message: assistantMessage,
        });
      } catch (err) {
        stream.push({
          type: "error",
          error: classifyAnthropicError(err),
        });
      }
    })();

    return stream;
  };
}

async function convertMessages(messages: Message[]): Promise<Anthropic.MessageParam[]> {
  const result: Anthropic.MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      const blocks =
        typeof msg.content === "string"
          ? [{ type: "text" as const, text: msg.content }]
          : (await materializeUserContentBlocks(msg.content)).map(convertContentBlock);
      result.push({ role: "user", content: blocks });
    } else if (msg.role === "assistant") {
      result.push({
        role: "assistant",
        content: msg.content.map(convertContentBlock),
      });
    } else if (msg.role === "tool_result") {
      // Tool results go into a user message with tool_result blocks
      // Check if previous result entry is already a user message we can append to
      const last = result[result.length - 1];
      const toolResultBlock: Anthropic.ToolResultBlockParam = {
        type: "tool_result",
        tool_use_id: msg.toolCallId,
        content: msg.output,
        is_error: msg.isError,
      };

      if (last && last.role === "user" && Array.isArray(last.content)) {
        (last.content as Anthropic.ContentBlockParam[]).push(toolResultBlock);
      } else {
        result.push({ role: "user", content: [toolResultBlock] });
      }
    }
  }

  // Cache breakpoint on last user message (text or tool_result) so the entire
  // conversation prefix is cached and any fork from this point gets a cache hit.
  for (let i = result.length - 1; i >= 0; i--) {
    const msg = result[i];
    if (msg.role !== "user" || !Array.isArray(msg.content) || msg.content.length === 0) continue;
    (msg.content[msg.content.length - 1] as unknown as Record<string, unknown>).cache_control = { type: "ephemeral" };
    break;
  }

  return result;
}

function convertContentBlock(block: ContentBlock): Anthropic.ContentBlockParam {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "image":
      return {
        type: "image",
        source: {
          type: "base64",
          media_type: block.source.media_type as Anthropic.Base64ImageSource["media_type"],
          data: block.source.data,
        },
      };
    case "local_image":
      throw new Error("local_image blocks must be materialized before Anthropic conversion");
    case "thinking":
      if (!block.signature) {
        throw new Error("Anthropic thinking blocks require signature");
      }
      return {
        type: "thinking",
        thinking: block.thinking,
        signature: block.signature,
      };
    case "tool_call":
      return {
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: block.input,
      };
  }
}

function convertTools(tools: ToolDefinition[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: {
      type: "object" as const,
      ...t.inputSchema,
    },
  }));
}

function mapToAssistantMessage(msg: Anthropic.Message, model: Model): AssistantMessage {
  const content: ContentBlock[] = msg.content.map((block): ContentBlock => {
    if (block.type === "text") {
      return { type: "text", text: block.text };
    } else if (block.type === "tool_use") {
      return {
        type: "tool_call",
        id: block.id,
        name: block.name,
        input: block.input as Record<string, unknown>,
      };
    } else if (block.type === "thinking") {
      return { type: "thinking", thinking: block.thinking, signature: block.signature };
    }
    return { type: "text", text: "" };
  });

  const usage: Usage = {
    inputTokens: msg.usage.input_tokens,
    outputTokens: msg.usage.output_tokens,
    cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: msg.usage.cache_creation_input_tokens ?? 0,
  };

  const stopReason = mapStopReason(msg.stop_reason);

  return {
    role: "assistant",
    content,
    model: model.id,
    usage,
    stopReason,
    timestamp: Date.now(),
  };
}

function mapStopReason(reason: string | null): StopReason {
  switch (reason) {
    case "end_turn":
      return "end_turn";
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    default:
      return "end_turn";
  }
}

// TODO: Track actual inputTokens for proactive compaction (D-compact)
export function classifyAnthropicError(err: unknown): ProviderError {
  if (err instanceof Anthropic.APIError) {
    const status = err.status;
    if (status === 429) {
      const retryAfter = parseRetryAfter(err.headers);
      return new ProviderError(err.message, "rate_limit", true, retryAfter, status, err);
    }
    if (status === 529) {
      return new ProviderError(err.message, "overloaded", true, undefined, status, err);
    }
    if (status === 400 && err.message.includes("context length")) {
      return new ProviderError(err.message, "context_overflow", false, undefined, status, err);
    }
    if (status === 401 || status === 403) {
      return new ProviderError(err.message, "auth", false, undefined, status, err);
    }
    return new ProviderError(err.message, "unknown", false, undefined, status, err);
  }
  if (isNetworkError(err)) {
    return new ProviderError(String(err), "network", true);
  }
  return new ProviderError(
    err instanceof Error ? err.message : String(err),
    "unknown",
    false,
    undefined,
    undefined,
    err instanceof Error ? err : undefined,
  );
}

function parseRetryAfter(headers?: Headers | Record<string, string | null | undefined>): number | undefined {
  if (!headers) return undefined;

  const getHeader = (name: string): string | undefined => {
    if (headers instanceof Headers) {
      return headers.get(name) ?? undefined;
    }
    const value = headers[name];
    return typeof value === "string" ? value : undefined;
  };

  const ms = getHeader("retry-after-ms");
  if (ms) {
    const parsedMs = Number.parseInt(ms, 10);
    if (Number.isFinite(parsedMs)) return parsedMs;
  }

  const s = getHeader("retry-after");
  if (s) {
    const parsedSeconds = Number.parseInt(s, 10);
    if (Number.isFinite(parsedSeconds)) return parsedSeconds * 1000;
  }

  return undefined;
}

function resolveAnthropicBaseUrl(baseUrl?: string): string {
  const resolved = (baseUrl ?? "https://api.anthropic.com").replace(/\/+$/, "");
  return resolved.endsWith("/v1") ? resolved : `${resolved}/v1`;
}

function resolveAnthropicSdkBaseUrl(baseUrl?: string): string {
  return (baseUrl ?? "https://api.anthropic.com").replace(/\/+$/, "");
}

interface AnthropicTextBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

function toAnthropicBlocks(sections: SystemSection[]): AnthropicTextBlock[] {
  return sections.map((s) => {
    let text: string;
    if (!s.tag) {
      text = s.content;
    } else {
      const attrs = s.tagAttributes
        ? Object.entries(s.tagAttributes)
            .map(([k, v]) => ` ${k}="${v}"`)
            .join("")
        : "";
      text = `<${s.tag}${attrs}>\n${s.content}\n</${s.tag}>`;
    }
    const block: AnthropicTextBlock = { type: "text", text };
    if (s.cacheControl === "ephemeral") {
      block.cache_control = { type: "ephemeral" };
    }
    return block;
  });
}

export function createAnthropicNativeCompaction(apiKey: string, baseUrl?: string): NativeCompactFn {
  const endpoint = `${resolveAnthropicBaseUrl(baseUrl)}/messages/compact`;
  return async (input) => {
    const body: Record<string, unknown> = {
      model: input.model.id,
      messages: await convertMessages(input.messages),
    };
    if (input.systemPrompt.length > 0) body.system = toAnthropicBlocks(input.systemPrompt);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: input.signal,
    });

    if (!response.ok) {
      if (response.status === 400 || response.status === 404 || response.status === 405 || response.status === 422) {
        return { status: "unsupported", reason: `status_${response.status}` };
      }
      throw new Error(`Anthropic native compaction failed (${response.status})`);
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const summary = typeof payload.summary === "string" ? payload.summary : undefined;
    if (!summary?.trim()) return { status: "unsupported", reason: "missing_summary" };
    return { status: "ok", summary };
  };
}
