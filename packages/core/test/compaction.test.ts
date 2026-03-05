// @summary Tests for session compaction and token estimation
import { describe, expect, it } from "bun:test";
import {
  estimateTokens,
  extractFileOperations,
  findRecentUserMessages,
  formatFileOperations,
  isSummaryMessage,
  SUMMARY_PREFIX,
  shouldCompact,
} from "../src/session/compaction";
import type { SessionEntry } from "../src/session/types";
import type { Message } from "../src/types";

// --- Helper factories ---

function userMsg(text: string): Message {
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

function assistantWithToolCall(
  text: string,
  toolCallId: string,
  toolName: string,
  input: Record<string, unknown>,
): Message {
  return {
    role: "assistant",
    content: [
      { type: "text", text },
      { type: "tool_call", id: toolCallId, name: toolName, input },
    ],
    model: "test",
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    stopReason: "tool_use",
    timestamp: Date.now(),
  };
}

function msgEntry(id: string, parentId: string | null, msg: Message): SessionEntry {
  return { type: "message", id, parentId, timestamp: new Date().toISOString(), message: msg };
}

// --- Tests ---

describe("estimateTokens", () => {
  it("estimates tokens for simple user message", () => {
    const messages = [userMsg("hello world")]; // 11 chars → ceil(11/4) = 3
    expect(estimateTokens(messages)).toBe(3);
  });

  it("estimates tokens for assistant message", () => {
    const messages = [assistantMsg("hello world")]; // 11 chars → 3
    expect(estimateTokens(messages)).toBe(3);
  });

  it("estimates tokens for tool result", () => {
    const output = "a".repeat(100); // 100 chars → 25
    const messages = [toolResultMsg("tc1", "bash", output)];
    expect(estimateTokens(messages)).toBe(25);
  });

  it("returns 0 for empty messages", () => {
    expect(estimateTokens([])).toBe(0);
  });

  it("accumulates across multiple messages", () => {
    const messages = [
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

  it("handles tool call blocks in assistant message", () => {
    const messages = [assistantWithToolCall("hi", "tc1", "bash", { command: "ls -la" })];
    // "hi" = 2 chars, tool_call: JSON.stringify({command:"ls -la"}) + "bash" = ~24 chars
    const tokens = estimateTokens(messages);
    expect(tokens).toBeGreaterThan(0);
  });
});

describe("shouldCompact", () => {
  const RESERVE = Math.floor(200_000 * 0.16); // 32000

  it("returns true when tokens exceed threshold", () => {
    expect(shouldCompact(100_000, 200_000, RESERVE)).toBe(false);
    expect(shouldCompact(190_000, 200_000, RESERVE)).toBe(true);
    expect(shouldCompact(168_001, 200_000, RESERVE)).toBe(true); // just above boundary
  });

  it("returns false when tokens are below threshold", () => {
    expect(shouldCompact(50_000, 200_000, RESERVE)).toBe(false);
  });

  it("handles edge case: exactly at threshold", () => {
    // threshold = 200000 - 32000 = 168000
    expect(shouldCompact(168_000, 200_000, RESERVE)).toBe(false);
    expect(shouldCompact(168_001, 200_000, RESERVE)).toBe(true);
  });
});

describe("isSummaryMessage", () => {
  it("returns true for summary-prefixed user message", () => {
    const msg = userMsg(`${SUMMARY_PREFIX}\n\nSome summary content`);
    expect(isSummaryMessage(msg)).toBe(true);
  });

  it("returns false for regular user message", () => {
    expect(isSummaryMessage(userMsg("hello world"))).toBe(false);
  });

  it("returns false for non-user message", () => {
    expect(isSummaryMessage(assistantMsg("some text"))).toBe(false);
  });

  it("returns false for user message with non-string content", () => {
    const msg: Message = {
      role: "user",
      content: [{ type: "text", text: SUMMARY_PREFIX }],
      timestamp: Date.now(),
    };
    expect(isSummaryMessage(msg)).toBe(false);
  });
});

describe("findRecentUserMessages", () => {
  it("returns empty for empty entries", () => {
    const result = findRecentUserMessages([], 1000);
    expect(result.recentUserMessages).toEqual([]);
    expect(result.entriesToSummarize).toEqual([]);
  });

  it("collects all user messages when within budget", () => {
    const entries: SessionEntry[] = [
      msgEntry("a1", null, userMsg("hello")),
      msgEntry("a2", "a1", assistantMsg("hi")),
      msgEntry("a3", "a2", userMsg("how are you?")),
      msgEntry("a4", "a3", assistantMsg("fine")),
    ];
    const result = findRecentUserMessages(entries, 100_000);
    expect(result.recentUserMessages).toHaveLength(2);
    expect(result.recentUserMessages[0].content as string).toBe("hello");
    expect(result.recentUserMessages[1].content as string).toBe("how are you?");
    expect(result.entriesToSummarize).toHaveLength(4);
  });

  it("selects most recent messages when budget exceeded", () => {
    const longText = "x".repeat(400); // 100 tokens each
    const entries: SessionEntry[] = [
      msgEntry("a1", null, userMsg(`${longText}1`)),
      msgEntry("a2", "a1", assistantMsg("resp1")),
      msgEntry("a3", "a2", userMsg(`${longText}2`)),
      msgEntry("a4", "a3", assistantMsg("resp2")),
      msgEntry("a5", "a4", userMsg("short")),
    ];
    // Budget of 150 tokens → can fit ~1.5 messages → most recent first
    const result = findRecentUserMessages(entries, 150);
    expect(result.recentUserMessages.length).toBeGreaterThanOrEqual(1);
    // Most recent should be included
    const lastMsg = result.recentUserMessages[result.recentUserMessages.length - 1];
    expect(lastMsg.content as string).toBe("short");
  });

  it("starts after last compaction", () => {
    const entries: SessionEntry[] = [
      msgEntry("a1", null, userMsg("old message")),
      msgEntry("a2", "a1", assistantMsg("old response")),
      {
        type: "compaction",
        id: "c1",
        parentId: "a2",
        timestamp: new Date().toISOString(),
        summary: "Previous summary",
        recentUserMessages: [],
        tokensBefore: 5000,
        tokensAfter: 1000,
        details: { readFiles: [], modifiedFiles: [] },
      },
      msgEntry("a3", "c1", userMsg("new message")),
      msgEntry("a4", "a3", assistantMsg("new response")),
    ];
    const result = findRecentUserMessages(entries, 100_000);
    // Should only summarize entries after compaction
    expect(result.entriesToSummarize).toHaveLength(2);
    expect(result.recentUserMessages).toHaveLength(1);
    expect(result.recentUserMessages[0].content as string).toBe("new message");
  });

  it("filters summary messages to prevent accumulation", () => {
    const entries: SessionEntry[] = [
      msgEntry("a1", null, userMsg(`${SUMMARY_PREFIX}\nOld summary content`)),
      msgEntry("a2", "a1", assistantMsg("response")),
      msgEntry("a3", "a2", userMsg("real question")),
    ];
    const result = findRecentUserMessages(entries, 100_000);
    // Should NOT include the summary message
    expect(result.recentUserMessages).toHaveLength(1);
    expect(result.recentUserMessages[0].content as string).toBe("real question");
  });

  it("truncates overlong individual messages", () => {
    const longText = "x".repeat(500); // 125 tokens
    const entries: SessionEntry[] = [msgEntry("a1", null, userMsg(longText))];
    // Budget of 50 tokens = 200 chars max
    const result = findRecentUserMessages(entries, 50);
    expect(result.recentUserMessages).toHaveLength(1);
    expect(result.recentUserMessages[0].content as string).toContain("[... truncated]");
    expect((result.recentUserMessages[0].content as string).length).toBeLessThan(longText.length);
  });

  it("returns messages in chronological order", () => {
    const entries: SessionEntry[] = [
      msgEntry("a1", null, userMsg("first")),
      msgEntry("a2", "a1", assistantMsg("resp")),
      msgEntry("a3", "a2", userMsg("second")),
      msgEntry("a4", "a3", assistantMsg("resp")),
      msgEntry("a5", "a4", userMsg("third")),
    ];
    const result = findRecentUserMessages(entries, 100_000);
    expect(result.recentUserMessages).toHaveLength(3);
    expect(result.recentUserMessages[0].content as string).toBe("first");
    expect(result.recentUserMessages[1].content as string).toBe("second");
    expect(result.recentUserMessages[2].content as string).toBe("third");
  });
});

describe("extractFileOperations", () => {
  it("extracts read operations", () => {
    const messages: Message[] = [
      assistantWithToolCall("Reading file", "tc1", "read", { file_path: "/src/index.ts" }),
      toolResultMsg("tc1", "read", "file contents here"),
    ];
    const details = extractFileOperations(messages);
    expect(details.readFiles).toEqual(["/src/index.ts"]);
    expect(details.modifiedFiles).toEqual([]);
  });

  it("extracts write operations", () => {
    const messages: Message[] = [
      assistantWithToolCall("Writing file", "tc1", "write", { file_path: "/src/new.ts" }),
      toolResultMsg("tc1", "write", "File written"),
    ];
    const details = extractFileOperations(messages);
    expect(details.readFiles).toEqual([]);
    expect(details.modifiedFiles).toEqual(["/src/new.ts"]);
  });

  it("extracts edit operations", () => {
    const messages: Message[] = [
      assistantWithToolCall("Editing", "tc1", "edit", { file_path: "/src/mod.ts" }),
      toolResultMsg("tc1", "edit", "File edited"),
    ];
    const details = extractFileOperations(messages);
    expect(details.modifiedFiles).toEqual(["/src/mod.ts"]);
  });

  it("deduplicates file paths", () => {
    const messages: Message[] = [
      assistantWithToolCall("Read 1", "tc1", "read", { file_path: "/src/a.ts" }),
      toolResultMsg("tc1", "read", "contents"),
      assistantWithToolCall("Read 2", "tc2", "read", { file_path: "/src/a.ts" }),
      toolResultMsg("tc2", "read", "contents again"),
    ];
    const details = extractFileOperations(messages);
    expect(details.readFiles).toEqual(["/src/a.ts"]);
  });

  it("merges with previous compaction details", () => {
    const messages: Message[] = [
      assistantWithToolCall("Read", "tc1", "read", { file_path: "/src/new.ts" }),
      toolResultMsg("tc1", "read", "contents"),
    ];
    const previous = { readFiles: ["/src/old.ts"], modifiedFiles: ["/src/mod.ts"] };
    const details = extractFileOperations(messages, previous);
    expect(details.readFiles).toContain("/src/old.ts");
    expect(details.readFiles).toContain("/src/new.ts");
    expect(details.modifiedFiles).toContain("/src/mod.ts");
  });

  it("returns empty for messages without file operations", () => {
    const messages: Message[] = [userMsg("hello"), assistantMsg("hi")];
    const details = extractFileOperations(messages);
    expect(details.readFiles).toEqual([]);
    expect(details.modifiedFiles).toEqual([]);
  });
});

describe("formatFileOperations", () => {
  it("formats both read and modified files", () => {
    const result = formatFileOperations({
      readFiles: ["/src/a.ts", "/src/b.ts"],
      modifiedFiles: ["/src/c.ts"],
    });
    expect(result).toContain("## Files Read");
    expect(result).toContain("- /src/a.ts");
    expect(result).toContain("- /src/b.ts");
    expect(result).toContain("## Files Modified");
    expect(result).toContain("- /src/c.ts");
  });

  it("returns empty string for no file operations", () => {
    const result = formatFileOperations({ readFiles: [], modifiedFiles: [] });
    expect(result).toBe("");
  });

  it("handles only read files", () => {
    const result = formatFileOperations({ readFiles: ["/src/a.ts"], modifiedFiles: [] });
    expect(result).toContain("## Files Read");
    expect(result).not.toContain("## Files Modified");
  });
});
