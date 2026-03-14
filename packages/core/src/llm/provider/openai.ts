// @summary OpenAI provider implementation with streaming, tools, and error classification
import OpenAI from "openai";
import { EventStream } from "../../event-stream";
import { isNetworkError } from "../errors";
import type { NativeCompactFn } from "./native-compaction";
import { flattenSections } from "../system-sections";
import { normalizeThinkingEffort } from "../thinking-effort";
import type {
  Model,
  ProviderEvent,
  ProviderResult,
  StreamContext,
  StreamFunction,
  StreamOptions,
} from "../types";
import { ProviderError } from "../types";
import { buildResponsesRequestBody, convertMessages, extractCompactionSummary, handleResponsesAPIEvents, isContextOverflow } from "./openai-shared";

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
    if (options.signal) stream.attachSignal(options.signal);

    (async () => {
      try {
        const useReasoning = model.supportsThinking;
        const effort = normalizeThinkingEffort(options.effort);
        const requestBody = await buildResponsesRequestBody({
          model: model.id,
          systemInstructions: flattenSections(context.systemPrompt),
          messages: context.messages,
          tools: context.tools,
          strictTools: false,
          sessionId: context.sessionId,
          promptCacheRetention: "24h",
          maxTokens: options.maxTokens,
          temperature: options.temperature,
          useReasoning,
          effort,
        });
        const openaiStream = await client.responses.create(
          requestBody,
          ...(options.signal ? [{ signal: options.signal }] : []),
        );

        stream.push({ type: "start" });

        await handleResponsesAPIEvents(
          openaiStream as unknown as AsyncIterable<Record<string, unknown>>,
          stream,
          model,
          options.signal,
          context.messages.length,
          context.sessionId,
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

const OPENAI_BASE_URL = "https://api.openai.com/v1";

function resolveOpenAIBaseUrl(baseUrl?: string): string {
  const resolved = (baseUrl ?? OPENAI_BASE_URL).replace(/\/+$/, "");
  return resolved.endsWith("/v1") ? resolved : `${resolved}/v1`;
}

export function createOpenAINativeCompaction(apiKey: string, baseUrl?: string): NativeCompactFn {
  const compactEndpoint = `${resolveOpenAIBaseUrl(baseUrl)}/responses/compact`;
  return async (input) => {
    const body: Record<string, unknown> = {
      model: input.model.id,
      input: await convertMessages(input.messages),
    };
    if (input.systemPrompt.length > 0) body.instructions = flattenSections(input.systemPrompt);

    const response = await fetch(compactEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: input.signal,
    });

    if (!response.ok) {
      if (response.status === 400 || response.status === 404 || response.status === 405) {
        return { status: "unsupported", reason: `status_${response.status}` };
      }
      throw new Error(`OpenAI native compaction failed (${response.status})`);
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const summary = extractCompactionSummary(payload);
    if (!summary?.trim()) return { status: "unsupported", reason: "missing_summary" };
    return { status: "ok", summary };
  };
}

function parseRetryAfterFromHeaders(headers: Headers | undefined): number | undefined {
  if (!headers) return undefined;
  const ms = headers.get("retry-after-ms");
  if (ms) return Number.parseInt(ms, 10);
  const s = headers.get("retry-after");
  if (s) return Number.parseInt(s, 10) * 1000;
  return undefined;
}
