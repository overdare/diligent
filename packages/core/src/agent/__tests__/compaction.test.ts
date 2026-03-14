// @summary Tests for agent-layer compaction helpers — token estimation, shouldCompact, selectForCompaction
import { afterEach, describe, expect, it } from "bun:test";
import { EventStream } from "@diligent/core/event-stream";
import { configureCompactionRegistry, resetCompactionRegistry } from "@diligent/core/llm/compaction";
import type { Model, ProviderEvent, ProviderResult, StreamFunction } from "@diligent/core/llm/types";
import { resolveMaxTokens } from "@diligent/core/llm/types";
import type { Message, UserMessage } from "@diligent/core/types";
import {
  buildMessagesFromCompaction,
  estimateTokens,
  runCompaction,
  selectForCompaction,
  shouldCompact,
  splitCompactionMessages,
} from "../compaction";
import { AgentStream } from "../types";

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

function toolResultMsg(toolCallId: string, toolName: string, output: string): Message {
  return {
    role: "tool_result",
    toolCallId,
    toolName,
    output,
    isError: false,
    timestamp: Date.now(),
  };
}

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

function userContent(msg: Message): string {
  if (msg.role !== "user") return "";
  return typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
}

const TEST_MODEL: Model = {
  id: "test-model",
  provider: "test",
  contextWindow: 100_000,
  maxOutputTokens: 40_000,
  supportsThinking: false,
};

// --- estimateTokens ---

describe("estimateTokens", () => {
  it("estimates tokens for simple user message", () => {
    const messages: Message[] = [userMsg("hello world")]; // 11 chars → ceil(11/4) = 3
    expect(estimateTokens(messages)).toBe(3);
  });

  it("estimates tokens for assistant message", () => {
    const messages: Message[] = [assistantMsg("hello world")]; // 11 chars → 3
    expect(estimateTokens(messages)).toBe(3);
  });

  it("estimates tokens for tool result", () => {
    const output = "a".repeat(100); // 100 chars → 25
    const messages: Message[] = [toolResultMsg("tc1", "bash", output)];
    expect(estimateTokens(messages)).toBe(25);
  });

  it("returns 0 for empty messages", () => {
    expect(estimateTokens([])).toBe(0);
  });

  it("accumulates across multiple messages", () => {
    const messages: Message[] = [
      userMsg("a".repeat(40)), // 40 chars → 10
      assistantMsg("b".repeat(80)), // 80 chars → 20
      toolResultMsg("tc1", "bash", "c".repeat(120)), // 120 chars → 30
    ];
    expect(estimateTokens(messages)).toBe(60);
  });

  it("handles thinking blocks", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "a".repeat(40) },
          { type: "text", text: "b".repeat(40) },
        ],
        model: "test",
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        stopReason: "end_turn",
        timestamp: Date.now(),
      },
    ];
    expect(estimateTokens(messages)).toBe(20); // (40+40)/4
  });
});

describe("resolveMaxTokens", () => {
  it("returns the model output limit when it is smaller than the buffered context", () => {
    expect(resolveMaxTokens({ ...TEST_MODEL, maxOutputTokens: 5_000 }, 16)).toBe(5_000);
  });

  it("returns the buffered context when it is smaller than the model output limit", () => {
    expect(resolveMaxTokens(TEST_MODEL, 16)).toBe(16_000);
  });
});

// --- shouldCompact ---

// estimateTokens uses chars/4; this helper builds messages with exactly the given token count
function msgsWithTokens(tokens: number) {
  return [{ role: "user" as const, content: "x".repeat(tokens * 4), timestamp: 0 }];
}

describe("shouldCompact", () => {
  const RESERVE_PERCENT = 16; // 16% of 200k = 32000 tokens reserved

  it("returns false below threshold", () => {
    expect(shouldCompact(msgsWithTokens(100_000), 200_000, RESERVE_PERCENT)).toBe(false);
    expect(shouldCompact(msgsWithTokens(50_000), 200_000, RESERVE_PERCENT)).toBe(false);
  });

  it("returns true when tokens exceed threshold", () => {
    expect(shouldCompact(msgsWithTokens(190_000), 200_000, RESERVE_PERCENT)).toBe(true);
    expect(shouldCompact(msgsWithTokens(168_001), 200_000, RESERVE_PERCENT)).toBe(true);
  });

  it("handles edge case: exactly at threshold", () => {
    // threshold = 200000 - floor(200000 * 0.16) = 200000 - 32000 = 168000
    expect(shouldCompact(msgsWithTokens(168_000), 200_000, RESERVE_PERCENT)).toBe(false);
    expect(shouldCompact(msgsWithTokens(168_001), 200_000, RESERVE_PERCENT)).toBe(true);
  });
});

// --- selectForCompaction ---

describe("selectForCompaction", () => {
  it("returns empty for empty messages", () => {
    const result = selectForCompaction([], 1000);
    expect(result.recentUserMessages).toEqual([]);
    expect(result.messagesToSummarize).toEqual([]);
  });

  it("collects all user messages when within budget", () => {
    const messages: Message[] = [userMsg("hello"), assistantMsg("hi"), userMsg("how are you?"), assistantMsg("fine")];
    const result = selectForCompaction(messages, 100_000);
    expect(result.recentUserMessages).toHaveLength(2);
    expect(userContent(result.recentUserMessages[0])).toBe("hello");
    expect(userContent(result.recentUserMessages[1])).toBe("how are you?");
    expect(result.messagesToSummarize).toHaveLength(4);
  });

  it("selects most recent messages when budget exceeded", () => {
    const longText = "x".repeat(400); // 100 tokens each
    const messages: Message[] = [
      userMsg(`${longText}1`),
      assistantMsg("resp1"),
      userMsg(`${longText}2`),
      assistantMsg("resp2"),
      userMsg("short"),
    ];
    // Budget of 150 tokens → can fit ~1.5 messages → most recent first
    const result = selectForCompaction(messages, 150);
    expect(result.recentUserMessages.length).toBeGreaterThanOrEqual(1);
    const lastMsg = result.recentUserMessages[result.recentUserMessages.length - 1];
    expect(userContent(lastMsg)).toBe("short");
  });

  it("truncates overlong individual messages", () => {
    const longText = "x".repeat(500); // 125 tokens
    const messages: Message[] = [userMsg(longText)];
    // Budget of 50 tokens = 200 chars max
    const result = selectForCompaction(messages, 50);
    expect(result.recentUserMessages).toHaveLength(1);
    expect(userContent(result.recentUserMessages[0])).toContain("[... truncated]");
    expect(userContent(result.recentUserMessages[0]).length).toBeLessThan(longText.length);
  });

  it("returns messages in chronological order", () => {
    const messages: Message[] = [
      userMsg("first"),
      assistantMsg("resp"),
      userMsg("second"),
      assistantMsg("resp"),
      userMsg("third"),
    ];
    const result = selectForCompaction(messages, 100_000);
    expect(result.recentUserMessages).toHaveLength(3);
    expect(userContent(result.recentUserMessages[0])).toBe("first");
    expect(userContent(result.recentUserMessages[1])).toBe("second");
    expect(userContent(result.recentUserMessages[2])).toBe("third");
  });
});

describe("runCompaction", () => {
  afterEach(() => resetCompactionRegistry());

  it("always rebuilds summary as a user turn, including native summaries", async () => {
    const messages: Message[] = [userMsg("first"), assistantMsg("reply"), userMsg("second")];
    const stream = new AgentStream();
    configureCompactionRegistry((p) =>
      p === "openai" ? async () => ({ status: "ok", summary: "native summary" }) : undefined,
    );
    const result = await runCompaction({
      messages,
      model: { ...TEST_MODEL, provider: "openai" },
      systemPrompt: [],
      compactionConfig: {
        reservePercent: 16,
        keepRecentTokens: 50,
      },
      streamFn: makeStreamFn("unused summary"),
      stream,
    });

    expect(result.messages).toHaveLength(3);
    expect(userContent(result.messages[0])).toBe("first");
    expect(userContent(result.messages[1])).toBe("second");
    expect(result.messages[2]?.role).toBe("user");
    const summaryMessage = result.messages[2];
    expect(summaryMessage?.role).toBe("user");
    expect(
      summaryMessage && summaryMessage.role === "user" && typeof summaryMessage.content === "string"
        ? summaryMessage.content
        : "",
    ).toContain("native summary");
  });
});

describe("splitCompactionMessages", () => {
  it("extracts recent user tail and summary from canonical compacted messages", () => {
    const compacted = buildMessagesFromCompaction(
      [
        { role: "user", content: "tail 1", timestamp: 1 },
        { role: "user", content: "tail 2", timestamp: 2 },
      ],
      "summary body",
      3,
    );

    const result = splitCompactionMessages(compacted);
    expect(result.recentUserMessages).toHaveLength(2);
    expect(userContent(result.recentUserMessages[0])).toBe("tail 1");
    expect(userContent(result.recentUserMessages[1])).toBe("tail 2");
    expect(result.summary).toBe("summary body");
  });
});
