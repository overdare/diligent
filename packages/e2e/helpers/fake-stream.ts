// @summary Deterministic fake StreamFunction factories for protocol-level e2e tests

import type { ProviderEvent, ProviderResult, StreamFunction } from "@diligent/core";
import { EventStream } from "@diligent/core";

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
          model: "fake",
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
export function createToolUseStream(toolCalls: ToolCallSpec[], finalText: string): StreamFunction {
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
            content: toolCalls.map((tc) => ({
              type: "tool_call" as const,
              id: tc.id,
              name: tc.name,
              input: tc.input,
            })),
            model: "fake",
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
            model: "fake",
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

/**
 * Creates a StreamFunction that emits text deltas slowly (for interrupt testing).
 */
export function createSlowStream(text: string, delayMs: number): StreamFunction {
  return () => {
    const stream = new EventStream<ProviderEvent, ProviderResult>(
      (e) => e.type === "done",
      (e) => ({ message: (e as Extract<ProviderEvent, { type: "done" }>).message }),
    );
    (async () => {
      stream.push({ type: "start" });
      for (const char of text) {
        await new Promise((r) => setTimeout(r, delayMs));
        stream.push({ type: "text_delta", delta: char });
      }
      stream.push({
        type: "done",
        stopReason: "end_turn",
        message: {
          role: "assistant",
          content: [{ type: "text", text }],
          model: "fake",
          usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
          stopReason: "end_turn",
          timestamp: Date.now(),
        },
      });
    })();
    return stream as never;
  };
}
