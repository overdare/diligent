// @summary Tests for LLM-layer compaction — generateSummary, compactMessages, compact (native-first)
import { describe, expect, it } from "bun:test";
import { EventStream } from "@diligent/core/event-stream";
import type { Message, UserMessage } from "@diligent/core/message-contract";
import type { Model, ProviderEvent, ProviderResult, StreamFunction } from "@diligent/core/provider-contract";
import {
  compact,
  compactMessages,
  generateSummary,
  NATIVE_COMPACTION_MIN_INPUT_TOKENS,
} from "../../src/llm/compaction";
import type { NativeCompactFn } from "../../src/llm/provider/native-compaction";

// --- Helper factories ---

function userMsg(text: string): UserMessage {
  return { role: "user", content: text, timestamp: Date.now() };
}

function assistantMsg(text: string): Message {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    model: { provider: "anthropic", modelId: "test" },
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    stopReason: "end_turn",
    timestamp: Date.now(),
  };
}

const TEST_MODEL: Model = {
  modelId: "test-model",
  provider: "anthropic",
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
      messages: [userMsg("x".repeat(NATIVE_COMPACTION_MIN_INPUT_TOKENS * 4))],
      systemPrompt: [{ label: "test", content: "test" }],
      config: {
        reservePercent: 16,
      },
      llmCompactionFn: async () => ({ status: "ok", summary: "native summary" }),
    });

    expect(result).toEqual({ mode: "native", displaySummary: "native summary", compactionSummary: undefined });
  });

  it("falls back to local summarization when native compaction reports unsupported", async () => {
    // "unsupported" means the provider endpoint is unavailable (404/405) or returned no usable
    // summary — a capability signal, not a conversation failure. Throwing here turned a missing
    // endpoint into a fatal turn error with no recovery path.
    const result = await compact({
      model: { ...TEST_MODEL, provider: "openai" },
      messages: [userMsg("x".repeat(NATIVE_COMPACTION_MIN_INPUT_TOKENS * 4))],
      systemPrompt: [{ label: "test", content: "test" }],
      config: {
        reservePercent: 16,
      },
      llmCompactionFn: async () => ({ status: "unsupported", reason: "not_available" }),
      streamFn: makeStreamFn("local summary"),
    });

    expect(result.mode).toBe("local");
    expect(result.displaySummary).toBe("local summary");
  });

  it("skips native compaction for a model the same adapter already reported unsupported", async () => {
    let nativeCalls = 0;
    const llmCompactionFn: NativeCompactFn = async () => {
      nativeCalls += 1;
      return { status: "unsupported", reason: "status_404" };
    };
    const input = {
      model: { ...TEST_MODEL, provider: "openai" as const },
      messages: [userMsg("hello")],
      systemPrompt: [],
      config: { reservePercent: 16 },
      llmCompactionFn,
      streamFn: makeStreamFn("local summary"),
    };

    await compact(input);
    const second = await compact(input);
    await compact({ ...input, model: { ...input.model, modelId: "other-model" } });

    expect(second).toEqual({ mode: "local", displaySummary: "local summary" });
    expect(nativeCalls).toBe(2);
  });

  it("falls back to local summarization when native compaction exceeds timeoutMs", async () => {
    let nativeSignal: AbortSignal | undefined;
    const result = await compact({
      model: { ...TEST_MODEL, provider: "openai" },
      messages: [userMsg("hello")],
      systemPrompt: [],
      config: { reservePercent: 16, timeoutMs: 10 },
      llmCompactionFn: (nativeInput) =>
        new Promise((_resolve, reject) => {
          nativeSignal = nativeInput.signal;
          nativeInput.signal?.addEventListener("abort", () => reject(nativeInput.signal?.reason), { once: true });
        }),
      streamFn: makeStreamFn("local summary"),
    });

    expect(nativeSignal?.aborted).toBe(true);
    expect(result).toEqual({ mode: "local", displaySummary: "local summary" });
  });

  it("does not fall back to local summarization when the caller aborts native compaction", async () => {
    const controller = new AbortController();
    let localCalls = 0;
    const pending = compact({
      model: { ...TEST_MODEL, provider: "openai" },
      messages: [userMsg("hello")],
      systemPrompt: [],
      config: { reservePercent: 16 },
      signal: controller.signal,
      llmCompactionFn: (nativeInput) =>
        new Promise((_resolve, reject) => {
          nativeInput.signal?.addEventListener("abort", () => reject(new Error("aborted by user")), { once: true });
        }),
      streamFn: (model, context, options) => {
        localCalls += 1;
        return makeStreamFn("local summary")(model, context, options);
      },
    });
    controller.abort();

    await expect(pending).rejects.toThrow("aborted by user");
    expect(localCalls).toBe(0);
  });

  it("skips native when lookup returns undefined for provider", async () => {
    const result = await compact({
      model: { ...TEST_MODEL, provider: "openai" },
      messages: [userMsg("hello"), assistantMsg("world")],
      systemPrompt: [],
      config: { reservePercent: 16 },
      llmCompactionFn: undefined,
      streamFn: makeStreamFn("local only"),
    });

    expect(result).toEqual({ mode: "local", displaySummary: "local only" });
  });

  it("uses native compaction even below the old shared threshold when adapter exists", async () => {
    let nativeCalls = 0;
    const result = await compact({
      model: { ...TEST_MODEL, provider: "openai" },
      messages: [userMsg("hello"), assistantMsg("world")],
      systemPrompt: [{ label: "test", content: "test" }],
      config: {
        reservePercent: 16,
      },
      llmCompactionFn: async () => {
        nativeCalls += 1;
        return { status: "ok", summary: "native summary" };
      },
      streamFn: makeStreamFn("local summary"),
    });

    expect(nativeCalls).toBe(1);
    expect(result).toEqual({ mode: "native", displaySummary: "native summary", compactionSummary: undefined });
  });

  it("forwards compactionSummary to native compaction", async () => {
    let capturedSummary: Record<string, unknown> | undefined;

    await compact({
      model: { ...TEST_MODEL, provider: "openai" },
      messages: [userMsg("follow up")],
      systemPrompt: [{ label: "test", content: "test" }],
      compactionSummary: { type: "compaction", encrypted_content: "opaque" },
      config: {
        reservePercent: 16,
      },
      llmCompactionFn: async (input) => {
        capturedSummary = input.compactionSummary;
        return { status: "ok", compactionSummary: { type: "compaction", encrypted_content: "next" } };
      },
    });

    expect(capturedSummary).toEqual({ type: "compaction", encrypted_content: "opaque" });
  });
});
