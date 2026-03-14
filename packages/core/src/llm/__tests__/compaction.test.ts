// @summary Tests for LLM-layer compaction — generateSummary, compactMessages, compact (native-first)
import { describe, expect, it } from "bun:test";
import { EventStream } from "@diligent/core/event-stream";
import type { Model, ProviderEvent, ProviderResult, StreamFunction } from "@diligent/core/llm/types";
import type { Message, UserMessage } from "@diligent/core/types";
import { compact, compactMessages, generateSummary } from "../compaction";

// --- Helper factories ---

function userMsg(text: string): UserMessage {
  return { role: "user", content: text, timestamp: Date.now() };
}

function assistantMsg(text: string): Message {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    model: "test",
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    stopReason: "end_turn",
    timestamp: Date.now(),
  };
}

const TEST_MODEL: Model = {
  id: "test-model",
  provider: "test",
  contextWindow: 100_000,
  maxOutputTokens: 40_000,
  supportsThinking: false,
};

const TEST_PROMPTS = {
  summarization: "Summarize the conversation succinctly.",
};

function makeStreamFn(summaryText: string): StreamFunction {
  return (_model, _context, _options) => {
    const message = assistantMsg(summaryText) as Extract<Message, { role: "assistant" }>;
    const stream = new EventStream<ProviderEvent, ProviderResult>(
      (event) => event.type === "done" || event.type === "error",
      (event) => {
        if (event.type === "done") return { message: event.message };
        throw (event as { type: "error"; error: Error }).error;
      },
    );
    queueMicrotask(() => {
      stream.push({ type: "start" });
      stream.push({ type: "done", stopReason: "end_turn", message });
    });
    return stream;
  };
}

// --- generateSummary ---

describe("generateSummary", () => {
  it("uses maxTokens derived from the reservePercent cap", async () => {
    const capturedOptions: Array<{ maxTokens?: number }> = [];
    const streamFunction: StreamFunction = (_model, _context, options) => {
      capturedOptions.push({ maxTokens: options.maxTokens });
      const message = assistantMsg("Summary text") as Extract<Message, { role: "assistant" }>;
      const stream = new EventStream<ProviderEvent, ProviderResult>(
        (event) => event.type === "done" || event.type === "error",
        (event) => {
          if (event.type === "done") return { message: event.message };
          throw (event as { type: "error"; error: Error }).error;
        },
      );
      queueMicrotask(() => {
        stream.push({ type: "start" });
        stream.push({ type: "done", stopReason: "end_turn", message });
      });
      return stream;
    };

    const summary = await generateSummary([userMsg("Please summarize")], streamFunction, TEST_MODEL, {
      reservePercent: 16,
      prompts: TEST_PROMPTS,
    });

    expect(summary).toBe("Summary text");
    expect(capturedOptions).toEqual([{ maxTokens: 16_000 }]);
  });
});

// --- compactMessages ---

describe("compactMessages", () => {
  it("produces a summary string", async () => {
    const messages: Message[] = [
      userMsg("first user message"),
      assistantMsg("first response"),
      userMsg("second user message"),
      assistantMsg("second response"),
    ];

    const result = await compactMessages(messages, makeStreamFn("## Goal\nTest compaction"), TEST_MODEL, {
      reservePercent: 16,
      prompts: TEST_PROMPTS,
    });

    expect(result).toBe("## Goal\nTest compaction");
  });
});

// --- compact (native-first) ---

describe("compact", () => {
  it("uses provider-native compaction when adapter succeeds", async () => {
    const result = await compact({
      model: { ...TEST_MODEL, provider: "openai" },
      messages: [userMsg("hello"), assistantMsg("world")],
      systemPrompt: [{ label: "test", content: "test" }],
      config: {
        reservePercent: 16,
        nativeRegistry: (p) => (p === "openai" ? async () => ({ status: "ok", summary: "native summary" }) : undefined),
      },
    });

    expect(result).toBe("native summary");
  });

  it("falls back to local compaction when native path is unsupported", async () => {
    const result = await compact({
      model: { ...TEST_MODEL, provider: "openai" },
      messages: [userMsg("hello"), assistantMsg("world")],
      systemPrompt: [{ label: "test", content: "test" }],
      config: {
        reservePercent: 16,
        nativeRegistry: (p) =>
          p === "openai" ? async () => ({ status: "unsupported", reason: "not_available" }) : undefined,
      },
      streamFn: makeStreamFn("local summary"),
    });

    expect(result).toBe("local summary");
  });

  it("skips native when lookup returns undefined for provider", async () => {
    const result = await compact({
      model: { ...TEST_MODEL, provider: "openai" },
      messages: [userMsg("hello"), assistantMsg("world")],
      systemPrompt: [],
      config: { reservePercent: 16, nativeRegistry: () => undefined },
      streamFn: makeStreamFn("local only"),
    });

    expect(result).toBe("local only");
  });
});
