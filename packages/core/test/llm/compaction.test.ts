// @summary Tests for LLM-layer compaction — generateSummary, compactMessages, compact (native-first)
import { describe, expect, it, jest } from "bun:test";
import { EventStream } from "@diligent/core/event-stream";
import type { Message, UserMessage } from "@diligent/core/message-contract";
import type {
  Model,
  ProviderEvent,
  ProviderResult,
  StreamContext,
  StreamFunction,
} from "@diligent/core/provider-contract";
import { ProviderError, ProviderErrorType } from "@diligent/core/provider-contract";
import {
  CompactionTimeoutError,
  compact,
  compactMessages,
  generateSummary,
  LOCAL_SUMMARY_TIMEOUT_MS,
  NATIVE_COMPACTION_MIN_INPUT_TOKENS,
  SUMMARY_TOOL_OUTPUT_MAX_BYTES,
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

function makeFailingStream(): EventStream<ProviderEvent, ProviderResult> {
  return new EventStream<ProviderEvent, ProviderResult>(
    (event) => event.type === "done" || event.type === "error",
    (event) => {
      if (event.type === "error") throw event.error;
      throw new Error(`Unexpected terminal event: ${event.type}`);
    },
  );
}

/** Overflows the context window for the first `overflowingCalls` requests, then summarizes. */
function makeOverflowingStreamFn(overflowingCalls: number): StreamFunction & { contexts: StreamContext[] } {
  const contexts: StreamContext[] = [];
  const summarize = makeStreamFn("trimmed summary");
  const streamFn: StreamFunction = (model, context, options) => {
    contexts.push(context);
    if (contexts.length > overflowingCalls) return summarize(model, context, options);
    const stream = makeFailingStream();
    const error = new ProviderError("context too long", ProviderErrorType.ContextOverflow, false);
    queueMicrotask(() => stream.push({ type: "error", error }));
    return stream;
  };
  return Object.assign(streamFn, { contexts });
}

function rejectOnAbort(signal: AbortSignal | undefined): Promise<never> {
  const { promise, reject } = Promise.withResolvers<never>();
  signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
  return promise;
}

function toolCallMsg(toolCallId: string, input: Record<string, unknown> = { path: `${toolCallId}.ts` }): Message {
  return {
    role: "assistant",
    content: [{ type: "tool_call", id: toolCallId, name: "read", input }],
    model: { provider: "anthropic", modelId: "test" },
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    stopReason: "tool_use",
    timestamp: Date.now(),
  };
}

function toolResultMsg(toolCallId: string, output: string): Message {
  return { role: "tool_result", toolCallId, toolName: "read", output, isError: false, timestamp: Date.now() };
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

  it("drops the oldest message groups and retries when the request overflows the context window", async () => {
    // The tool call alone covers the trim target, so the cut must still take its result along.
    const messages: Message[] = [
      userMsg("start"),
      toolCallMsg("call-1", { content: "c".repeat(4_000) }),
      toolResultMsg("call-1", "written"),
      userMsg("next"),
      assistantMsg("latest answer"),
    ];
    const streamFn = makeOverflowingStreamFn(1);

    const result = await compactMessages(messages, streamFn, TEST_MODEL, { reservePercent: 16 });

    expect(result).toBe("trimmed summary");
    expect(streamFn.contexts).toHaveLength(2);
    const retried = streamFn.contexts[1]?.messages ?? [];
    expect(retried[0]).toMatchObject({
      role: "user",
      content: expect.stringContaining("3 oldest messages were omitted"),
    });
    expect(retried.slice(1, 3)).toEqual([messages[3], messages[4]]);
    expect(retried.some((message) => message.role === "tool_result")).toBe(false);
  });

  it("keeps pinned leading messages when trimming after an overflow", async () => {
    const previousSummary = userMsg("previous summary");
    const messages: Message[] = [
      previousSummary,
      userMsg("x".repeat(4_000)),
      assistantMsg("old answer"),
      userMsg("newest request"),
    ];
    const streamFn = makeOverflowingStreamFn(1);

    await compactMessages(messages, streamFn, TEST_MODEL, { reservePercent: 16, pinnedMessageCount: 1 });

    expect(streamFn.contexts[1]?.messages).toEqual([
      previousSummary,
      expect.objectContaining({ role: "user", content: expect.stringContaining("1 oldest message was omitted") }),
      messages[2],
      messages[3],
    ]);
  });

  it("surfaces the overflow once only the newest message group is left", async () => {
    const streamFn = makeOverflowingStreamFn(Number.POSITIVE_INFINITY);

    await expect(
      compactMessages([userMsg("only request"), assistantMsg("answer")], streamFn, TEST_MODEL, { reservePercent: 16 }),
    ).rejects.toThrow("context too long");
    expect(streamFn.contexts).toHaveLength(2);
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
    jest.useFakeTimers();
    try {
      let nativeSignal: AbortSignal | undefined;
      const pending = compact({
        model: { ...TEST_MODEL, provider: "openai" },
        messages: [userMsg("hello")],
        systemPrompt: [],
        config: { reservePercent: 16, timeoutMs: 30_000 },
        llmCompactionFn: (nativeInput) => {
          nativeSignal = nativeInput.signal;
          return rejectOnAbort(nativeInput.signal);
        },
        streamFn: makeStreamFn("local summary"),
      });
      jest.advanceTimersByTime(30_000);

      expect(await pending).toEqual({ mode: "local", displaySummary: "local summary" });
      expect(nativeSignal?.aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
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
      llmCompactionFn: (nativeInput) => rejectOnAbort(nativeInput.signal),
      streamFn: (model, context, options) => {
        localCalls += 1;
        return makeStreamFn("local summary")(model, context, options);
      },
    });
    controller.abort(new Error("aborted by user"));

    await expect(pending).rejects.toThrow("aborted by user");
    expect(localCalls).toBe(0);
  });

  it("reports a stalled local summarization as a compaction timeout", async () => {
    jest.useFakeTimers();
    try {
      const pending = compact({
        model: TEST_MODEL,
        messages: [userMsg("hello")],
        systemPrompt: [],
        config: { reservePercent: 16 },
        streamFn: (_model, _context, options) => {
          const stream = makeFailingStream();
          options.signal?.addEventListener(
            "abort",
            () => stream.push({ type: "error", error: new ProviderError("Aborted", ProviderErrorType.Unknown, false) }),
            { once: true },
          );
          return stream;
        },
      });
      jest.advanceTimersByTime(LOCAL_SUMMARY_TIMEOUT_MS);

      const error = await pending.catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(CompactionTimeoutError);
      expect(error).toMatchObject({
        stage: "local",
        message: `Local summarization timed out after ${LOCAL_SUMMARY_TIMEOUT_MS}ms`,
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it("shortens large tool outputs for local summarization but sends them in full to native compaction", async () => {
    const largeOutput = `${"h".repeat(10_000)}${"t".repeat(10_000)}`;
    const messages: Message[] = [
      userMsg("read both files"),
      toolCallMsg("call-1"),
      toolResultMsg("call-1", largeOutput),
      toolCallMsg("call-2"),
      toolResultMsg("call-2", "small output"),
    ];
    const nativeOutputs: string[] = [];
    const localOutputs: string[] = [];

    await compact({
      model: { ...TEST_MODEL, provider: "openai" },
      messages,
      systemPrompt: [],
      config: { reservePercent: 16 },
      llmCompactionFn: async (nativeInput) => {
        for (const message of nativeInput.messages) {
          if (message.role === "tool_result") nativeOutputs.push(message.output);
        }
        return { status: "unsupported", reason: "status_404" };
      },
      streamFn: (model, context, options) => {
        for (const message of context.messages) {
          if (message.role === "tool_result") localOutputs.push(message.output);
        }
        return makeStreamFn("local summary")(model, context, options);
      },
    });

    expect(nativeOutputs).toEqual([largeOutput, "small output"]);
    expect(localOutputs[0]).toStartWith("h");
    expect(localOutputs[0]).toEndWith("t");
    expect(localOutputs[0]).toContain("bytes omitted");
    expect(localOutputs[0]?.length).toBeLessThan(SUMMARY_TOOL_OUTPUT_MAX_BYTES + 100);
    expect(localOutputs[1]).toBe("small output");
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
