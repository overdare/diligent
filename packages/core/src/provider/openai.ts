// @summary OpenAI provider implementation with streaming, tools, and error classification
import OpenAI from "openai";
import { EventStream } from "../event-stream";
import { isNetworkError } from "./errors";
import { buildTools, convertMessages, handleResponsesAPIEvents, isContextOverflow } from "./openai-shared";
import { flattenSections } from "./system-sections";
import type { Model, ProviderEvent, ProviderResult, StreamContext, StreamFunction, StreamOptions } from "./types";
import { ProviderError } from "./types";

export function createOpenAIStream(apiKey: string, baseUrl?: string): StreamFunction {
  const client = new OpenAI({ apiKey, baseURL: baseUrl });

  return (model: Model, context: StreamContext, options: StreamOptions): EventStream<ProviderEvent, ProviderResult> => {
    const stream = new EventStream<ProviderEvent, ProviderResult>(
      (event) => event.type === "done" || event.type === "error",
      (event) => {
        if (event.type === "done") return { message: event.message };
        throw (event as { type: "error"; error: Error }).error;
      },
    );

    (async () => {
      try {
        const useReasoning = model.supportsThinking;
        const effort = options.effort ?? "high";
        // OpenAI only supports low/medium/high; map "max" → "high"
        const openaiEffort = effort === "max" ? "high" : effort;

        const openaiStream = await client.responses.create(
          {
            model: model.id,
            instructions: flattenSections(context.systemPrompt),
            input: convertMessages(context.messages),
            ...(context.tools.length > 0 && {
              tools: buildTools(context.tools, false) as unknown as Array<{
                type: "function";
                name: string;
                description: string;
                parameters: Record<string, unknown>;
                strict: boolean | null;
              }>,
            }),
            ...(options.maxTokens !== undefined && { max_output_tokens: options.maxTokens }),
            ...(options.temperature !== undefined && { temperature: options.temperature }),
            ...(useReasoning && {
              reasoning: { effort: openaiEffort, summary: "auto" },
              include: ["reasoning.encrypted_content"],
            }),
            stream: true,
          },
          ...(options.signal ? [{ signal: options.signal }] : []),
        );

        stream.push({ type: "start" });

        await handleResponsesAPIEvents(
          openaiStream as unknown as AsyncIterable<Record<string, unknown>>,
          stream,
          model,
          options.signal,
        );
      } catch (err) {
        stream.push({ type: "error", error: classifyOpenAIError(err) });
      }
    })();

    return stream;
  };
}

export function classifyOpenAIError(err: unknown): ProviderError {
  if (err instanceof OpenAI.APIError) {
    const status = err.status;
    if (status === 429) {
      const retryAfter = parseRetryAfterFromHeaders(err.headers);
      return new ProviderError(err.message, "rate_limit", true, retryAfter, status, err);
    }
    if (status === 529) {
      return new ProviderError(err.message, "overloaded", true, undefined, status, err);
    }
    if (status === 400 && isContextOverflow(err.message)) {
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

function parseRetryAfterFromHeaders(headers: Headers | undefined): number | undefined {
  if (!headers) return undefined;
  const ms = headers.get("retry-after-ms");
  if (ms) return Number.parseInt(ms, 10);
  const s = headers.get("retry-after");
  if (s) return Number.parseInt(s, 10) * 1000;
  return undefined;
}
