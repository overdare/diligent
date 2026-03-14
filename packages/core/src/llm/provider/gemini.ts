// @summary Gemini provider implementation with thinking support and content conversion
import type { FunctionDeclaration } from "@google/genai";
import { GoogleGenAI } from "@google/genai";
import { EventStream } from "../../event-stream";
import type { AssistantMessage, ContentBlock, Message, StopReason, Usage } from "../../types";
import { isNetworkError } from "../errors";
import { flattenSections } from "../system-sections";
import { normalizeThinkingEffort } from "../thinking-effort";
import type {
  Model,
  ProviderEvent,
  ProviderResult,
  StreamContext,
  StreamFunction,
  StreamOptions,
  ToolDefinition,
} from "../types";
import { ProviderError } from "../types";

export function createGeminiStream(apiKey: string, baseUrl?: string): StreamFunction {
  const client = new GoogleGenAI({
    apiKey,
    ...(baseUrl ? { httpOptions: { baseUrl } } : {}),
  });

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
        const defaultBudgets = { low: 2_048, medium: 8_192, high: 16_384, max: 24_576 };
        const budgetKey = effort === "none" ? "low" : effort;
        const budgetTokens = model.supportsThinking
          ? (model.thinkingBudgets?.[budgetKey] ?? defaultBudgets[budgetKey])
          : undefined;
        const useThinking = model.supportsThinking && budgetTokens;

        const responseStream = await client.models.generateContentStream({
          model: model.id,
          contents: convertToGeminiContents(context.messages),
          config: {
            ...(context.systemPrompt.length > 0 ? { systemInstruction: flattenSections(context.systemPrompt) } : {}),
            ...(context.tools.length > 0 ? { tools: convertToGeminiTools(context.tools) } : {}),
            ...(options.maxTokens !== undefined ? { maxOutputTokens: options.maxTokens } : {}),
            ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
            ...(useThinking ? { thinkingConfig: { thinkingBudget: budgetTokens } } : {}),
          },
        });

        stream.push({ type: "start" });

        const textBlocks: ContentBlock[] = [];
        const toolCallBlocks: ContentBlock[] = [];
        let toolCallCounter = 0;
        let currentText = "";
        let currentThinking = "";
        let stopReason: StopReason = "end_turn";
        let usageMeta: { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;

        for await (const chunk of responseStream) {
          if (options.signal?.aborted) break;

          if (chunk.usageMetadata) {
            usageMeta = chunk.usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number };
          }

          const candidate = chunk.candidates?.[0] as Record<string, unknown> | undefined;
          const finishReason = candidate?.finishReason as string | undefined;
          if (finishReason) {
            stopReason = mapGeminiStopReason(finishReason);
          }

          const parts = (candidate?.content as { parts?: unknown[] } | undefined)?.parts ?? [];
          for (const rawPart of parts) {
            const part = rawPart as {
              text?: string;
              thought?: boolean;
              functionCall?: { name: string; args?: Record<string, unknown> };
            };

            if (part.thought && part.text) {
              stream.push({ type: "thinking_delta", delta: part.text });
              currentThinking += part.text;
            } else if (part.text) {
              stream.push({ type: "text_delta", delta: part.text });
              currentText += part.text;
            } else if (part.functionCall) {
              const toolId = `gemini-${part.functionCall.name}-${++toolCallCounter}`;
              const input = (part.functionCall.args ?? {}) as Record<string, unknown>;
              stream.push({ type: "tool_call_start", id: toolId, name: part.functionCall.name });
              stream.push({ type: "tool_call_end", id: toolId, name: part.functionCall.name, input });
              toolCallBlocks.push({ type: "tool_call", id: toolId, name: part.functionCall.name, input });
            }
          }
        }

        if (options.signal?.aborted) return;

        if (currentThinking) {
          stream.push({ type: "thinking_end", thinking: currentThinking });
          textBlocks.unshift({ type: "thinking", thinking: currentThinking });
        }
        if (currentText) {
          stream.push({ type: "text_end", text: currentText });
          textBlocks.push({ type: "text", text: currentText });
        }

        const contentBlocks: ContentBlock[] = [...textBlocks, ...toolCallBlocks];

        const usage: Usage = {
          inputTokens: usageMeta?.promptTokenCount ?? 0,
          outputTokens: usageMeta?.candidatesTokenCount ?? 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        };

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
      } catch (err) {
        stream.push({ type: "error", error: classifyGeminiError(err) });
      }
    })();

    return stream;
  };
}

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

type GeminiContent = { role: string; parts: GeminiPart[] };

function convertToGeminiContents(messages: Message[]): GeminiContent[] {
  const result: GeminiContent[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      const text =
        typeof msg.content === "string"
          ? msg.content
          : msg.content
              .filter((b) => b.type === "text")
              .map((b) => (b as { type: "text"; text: string }).text)
              .join("\n");
      result.push({ role: "user", parts: [{ text }] });
    } else if (msg.role === "assistant") {
      const parts: GeminiPart[] = [];
      for (const block of msg.content) {
        if (block.type === "text") {
          parts.push({ text: block.text });
        } else if (block.type === "tool_call") {
          parts.push({ functionCall: { name: block.name, args: block.input } });
        }
        // Skip thinking blocks — not needed in conversation history
      }
      if (parts.length > 0) {
        result.push({ role: "model", parts });
      }
    } else if (msg.role === "tool_result") {
      result.push({
        role: "user",
        parts: [{ functionResponse: { name: msg.toolName, response: { output: msg.output } } }],
      });
    }
  }

  return result;
}

function convertToGeminiTools(tools: ToolDefinition[]): { functionDeclarations: FunctionDeclaration[] }[] {
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: { type: "object", ...t.inputSchema } as unknown as FunctionDeclaration["parameters"],
      })),
    },
  ];
}

function mapGeminiStopReason(finishReason: string): StopReason {
  switch (finishReason) {
    case "STOP":
      return "end_turn";
    case "MAX_TOKENS":
      return "max_tokens";
    case "SAFETY":
    case "RECITATION":
    case "BLOCKLIST":
    case "PROHIBITED_CONTENT":
    case "SPII":
      return "error";
    default:
      return "end_turn";
  }
}

// TODO: Track actual inputTokens for proactive compaction (D-compact)
export function classifyGeminiError(err: unknown): ProviderError {
  if (err instanceof Error) {
    const msg = err.message;
    const errObj = err as unknown as Record<string, unknown>;
    const httpStatus = (errObj.status as number | undefined) ?? (errObj.code as number | undefined);

    if (httpStatus === 429) {
      return new ProviderError(msg, "rate_limit", true, undefined, httpStatus, err);
    }
    if (httpStatus === 529) {
      return new ProviderError(msg, "overloaded", true, undefined, httpStatus, err);
    }
    if (httpStatus === 401 || httpStatus === 403) {
      return new ProviderError(msg, "auth", false, undefined, httpStatus, err);
    }
    if (isGeminiContextOverflow(msg)) {
      return new ProviderError(msg, "context_overflow", false, undefined, httpStatus, err);
    }
    if (isNetworkError(err)) {
      return new ProviderError(msg, "network", true, undefined, undefined, err);
    }
    return new ProviderError(msg, "unknown", false, undefined, httpStatus, err);
  }
  return new ProviderError(String(err), "unknown", false);
}

function isGeminiContextOverflow(message: string): boolean {
  const patterns = [/token count.*exceeds/i, /context.*too long/i, /input.*too long/i, /exceeds.*token limit/i];
  return patterns.some((p) => p.test(message));
}
