// @summary Deterministic fake provider streams for the app-server e2e suite

import type { ProviderEvent, ProviderResult } from "@diligent/core/provider-contract";
import type { ContentBlock } from "@diligent/protocol";
import type { StreamFunction } from "@diligent/runtime";
import { EventStream } from "@diligent/runtime";

export interface ToolCallSpec {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Creates a StreamFunction that emits a simple text response.
 */
export function createSimpleStream(text: string): StreamFunction {
  return () => {
    const stream = new EventStream<ProviderEvent, ProviderResult>(
      (e) => e.type === "done",
      (e) => ({ message: (e as Extract<ProviderEvent, { type: "done" }>).message }),
    );
    queueMicrotask(() => {
      stream.push({ type: "start" });
      stream.push({ type: "text_delta", delta: text });
      stream.push({
        type: "done",
        stopReason: "end_turn",
        message: {
          role: "assistant",
          content: [{ type: "text", text }],
          model: { provider: "anthropic", modelId: "claude-sonnet-5" },
          usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
          stopReason: "end_turn",
          timestamp: Date.now(),
        },
      });
    });
    return stream as never;
  };
}

/**
 * Creates a StreamFunction that emits tool calls on the first invocation,
 * then a final text response on subsequent invocations.
 */
export function createToolUseStream(
  toolCalls: ToolCallSpec[],
  finalText: string,
  leadingText?: string,
): StreamFunction {
  let callCount = 0;
  return () => {
    const stream = new EventStream<ProviderEvent, ProviderResult>(
      (e) => e.type === "done",
      (e) => ({ message: (e as Extract<ProviderEvent, { type: "done" }>).message }),
    );
    const iteration = callCount++;
    queueMicrotask(() => {
      stream.push({ type: "start" });
      if (iteration === 0 && toolCalls.length > 0) {
        if (leadingText) stream.push({ type: "text_delta", delta: leadingText });
        // First call: emit tool calls
        for (const tc of toolCalls) {
          stream.push({ type: "tool_call_start", id: tc.id, name: tc.name });
          stream.push({ type: "tool_call_end", id: tc.id, name: tc.name, input: tc.input });
        }
        stream.push({
          type: "done",
          stopReason: "tool_use",
          message: {
            role: "assistant",
            content: [
              ...(leadingText ? [{ type: "text" as const, text: leadingText }] : []),
              ...toolCalls.map((tc) => ({
                type: "tool_call" as const,
                id: tc.id,
                name: tc.name,
                input: tc.input,
              })),
            ],
            model: { provider: "anthropic", modelId: "claude-sonnet-5" },
            usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
            stopReason: "tool_use",
            timestamp: Date.now(),
          },
        });
      } else {
        // Subsequent calls: emit final text
        stream.push({ type: "text_delta", delta: finalText });
        stream.push({
          type: "done",
          stopReason: "end_turn",
          message: {
            role: "assistant",
            content: [{ type: "text", text: finalText }],
            model: { provider: "anthropic", modelId: "claude-sonnet-5" },
            usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
            stopReason: "end_turn",
            timestamp: Date.now(),
          },
        });
      }
    });
    return stream as never;
  };
}

/** Deliver a synthetic answer, then cite its runtime-observed source when completing a goal. */
export function createGoalCompletionStream(evidence: string, finalText = "Done"): StreamFunction {
  const inspect = createToolUseStream([{ id: "inspect-goal", name: "get_goal", input: {} }], finalText, finalText);
  let finish: StreamFunction | undefined;
  let calls = 0;
  return (...args) => {
    if (calls++ === 0) return inspect(...args);
    if (!finish) {
      const result = [...args[1].messages]
        .reverse()
        .find((message) => message.role === "tool_result" && message.toolCallId === "inspect-goal");
      if (!result || result.role !== "tool_result") throw new Error("Missing goal evidence response");
      const snapshot = JSON.parse(result.output);
      const source = snapshot.evidenceSources?.findLast((item: { kind: string }) => item.kind === "answer");
      finish = createToolUseStream(
        [
          {
            id: "done",
            name: "update_goal",
            input: {
              status: "complete",
              evidence,
              verification: [
                { requirement: "Deliver the requested answer", sourceId: source?.id ?? "missing", quote: finalText },
              ],
            },
          },
        ],
        finalText,
      );
    }
    return finish(...args);
  };
}

/**
 * Creates a StreamFunction that emits text deltas slowly (for interrupt testing).
 */
export function createSlowStream(text: string, delayMs: number): StreamFunction {
  return (_model, _context, options) => {
    const stream = new EventStream<ProviderEvent, ProviderResult>(
      (e) => e.type === "done",
      (e) => ({ message: (e as Extract<ProviderEvent, { type: "done" }>).message }),
    );
    (async () => {
      stream.push({ type: "start" });
      for (const char of text) {
        await new Promise((r) => setTimeout(r, delayMs));
        if (options.signal?.aborted) {
          const error = new Error("Aborted");
          error.name = "AbortError";
          stream.error(error);
          return;
        }
        stream.push({ type: "text_delta", delta: char });
      }
      stream.push({
        type: "done",
        stopReason: "end_turn",
        message: {
          role: "assistant",
          content: [{ type: "text", text }],
          model: { provider: "anthropic", modelId: "claude-sonnet-5" },
          usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
          stopReason: "end_turn",
          timestamp: Date.now(),
        },
      });
    })();
    return stream as never;
  };
}

/**
 * Creates a StreamFunction that emits provider-native web tool content blocks
 * (provider_tool_use, web_search_result, web_fetch_result) followed by a text response.
 */
export function createProviderNativeWebStream(finalText: string): StreamFunction {
  const providerToolUse: ContentBlock = {
    type: "provider_tool_use",
    id: "ptu-1",
    provider: "anthropic",
    name: "web_search",
    input: { type: "search", query: "test query" },
  };

  const webSearchResult: ContentBlock = {
    type: "web_search_result",
    toolUseId: "ptu-1",
    provider: "anthropic",
    results: [{ url: "https://example.com", title: "Example", snippet: "Example snippet" }],
  };

  const webFetchResult: ContentBlock = {
    type: "web_fetch_result",
    toolUseId: "ptu-1",
    provider: "anthropic",
    url: "https://example.com",
    document: { mimeType: "text/html", title: "Example Page", text: "Page content" },
  };

  return () => {
    const stream = new EventStream<ProviderEvent, ProviderResult>(
      (e) => e.type === "done",
      (e) => ({ message: (e as Extract<ProviderEvent, { type: "done" }>).message }),
    );
    queueMicrotask(() => {
      stream.push({ type: "start" });
      stream.push({ type: "content_block", block: providerToolUse });
      stream.push({ type: "content_block", block: webSearchResult });
      stream.push({ type: "content_block", block: webFetchResult });
      stream.push({ type: "text_delta", delta: finalText });
      stream.push({
        type: "done",
        stopReason: "end_turn",
        message: {
          role: "assistant",
          content: [providerToolUse, webSearchResult, webFetchResult, { type: "text", text: finalText }],
          model: { provider: "anthropic", modelId: "claude-sonnet-5" },
          usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
          stopReason: "end_turn",
          timestamp: Date.now(),
        },
      });
    });
    return stream as never;
  };
}
