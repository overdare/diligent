// @summary Tests for thread read snapshot assembly

import { describe, expect, test } from "bun:test";
import { buildThreadReadItems } from "../../src/app-server/thread-read-builder";

describe("buildThreadReadItems", () => {
  test("keeps assistant text readable when its persisted model card has been retired", () => {
    const items = buildThreadReadItems([
      {
        type: "message",
        id: "old-assistant",
        timestamp: "2024-01-01T00:00:00.000Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Previously saved answer" }],
          model: { provider: "anthropic", modelId: "retired-history-model" },
          usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
          stopReason: "end_turn",
          timestamp: 1704067200000,
        },
      },
    ]);
    expect(items).toMatchObject([
      {
        type: "agentMessage",
        itemId: "old-assistant",
        message: { content: [{ type: "text", text: "Previously saved answer" }] },
      },
    ]);
    expect(items[0]).not.toHaveProperty("cost", expect.any(Number));
  });

  test("preserves presentable context injections as context snapshot items", () => {
    const items = buildThreadReadItems([
      {
        type: "context",
        id: "ctx-1",
        timestamp: "2026-07-16T00:00:00.000Z",
        source: "studiorpc-studio-changes",
        presentation: { kind: "studio-changes", title: "Studio changes detected", content: "Added: Ramp" },
      },
    ]);

    expect(items).toEqual([
      {
        type: "contextMessage",
        itemId: "ctx-1",
        source: "studiorpc-studio-changes",
        presentation: { kind: "studio-changes", title: "Studio changes detected", content: "Added: Ramp" },
        timestamp: Date.parse("2026-07-16T00:00:00.000Z"),
      },
    ]);
  });

  test("preserves tool result metadata on tool call snapshots", () => {
    const items = buildThreadReadItems([
      {
        type: "message",
        id: "assistant-1",
        timestamp: "2026-07-02T00:00:00.000Z",
        message: {
          role: "assistant",
          content: [{ type: "tool_call", id: "tc_1", name: "glob", input: { pattern: "**/*", path: "/" } }],
          model: { provider: "anthropic", modelId: "claude-sonnet-5" },
          usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
          stopReason: "tool_use",
          timestamp: 100,
        },
      },
      {
        type: "message",
        id: "tool-1",
        timestamp: "2026-07-02T00:00:01.000Z",
        message: {
          role: "tool_result",
          toolCallId: "tc_1",
          toolName: "glob",
          output: "Error: refusing to glob the filesystem root: /",
          isError: true,
          timestamp: 110,
          metadata: {
            error: true,
            status: {
              kind: "invalid_scope",
              code: "filesystem_root",
              path: "/",
              retryable: false,
              actionable: true,
            },
          },
        },
      },
    ]);

    const toolItem = items.find((item) => item.type === "toolCall" && item.output);
    expect(toolItem).toMatchObject({
      type: "toolCall",
      toolCallId: "tc_1",
      metadata: {
        error: true,
        status: { kind: "invalid_scope", code: "filesystem_root", path: "/" },
      },
    });
  });

  test("places code mode nested calls with the call that dispatched them, not the result that carried them", () => {
    const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 };
    const model = { provider: "anthropic" as const, modelId: "claude-sonnet-5" };
    const nested = (toolCallId: string, parentToolCallId?: string) => ({
      toolCallId,
      ...(parentToolCallId ? { parentToolCallId } : {}),
      toolName: "read",
      input: {},
      output: toolCallId,
      isError: false,
      startedAt: 100,
      durationMs: 1,
    });
    const assistant = (id: string, toolCallId: string, name: string, timestamp: number) => ({
      type: "message" as const,
      id,
      timestamp: "2026-10-29T00:00:00.000Z",
      message: {
        role: "assistant" as const,
        content: [{ type: "tool_call" as const, id: toolCallId, name, input: {} }],
        model,
        usage,
        stopReason: "tool_use" as const,
        timestamp,
      },
    });
    const result = (id: string, toolCallId: string, toolName: string, nestedCalls: unknown[], timestamp: number) => ({
      type: "message" as const,
      id,
      timestamp: "2026-10-29T00:00:00.000Z",
      message: {
        role: "tool_result" as const,
        toolCallId,
        toolName,
        output: "",
        isError: false,
        timestamp,
        metadata: { codeMode: { cellId: "1", status: "running", nestedCalls } },
      },
    });

    const items = buildThreadReadItems([
      assistant("a-1", "tc-exec", "exec", 100),
      result("r-1", "tc-exec", "exec", [nested("tc-exec#1", "tc-exec")], 110),
      assistant("a-2", "tc-wait", "exec_wait", 120),
      // The cell ran tc-exec#2 in the background after tc-exec yielded; tc-wait carries its record.
      result(
        "r-2",
        "tc-wait",
        "exec_wait",
        [nested("tc-exec#2", "tc-exec"), nested("tc-wait#1", "tc-wait"), nested("legacy")],
        130,
      ),
    ]);

    const tools = items.flatMap((item) =>
      item.type === "toolCall" ? [`${item.toolCallId}<${item.parentToolCallId ?? ""}`] : [],
    );
    expect(tools).toEqual([
      "tc-exec<",
      "tc-exec<",
      "tc-exec#1<tc-exec",
      "tc-exec#2<tc-exec",
      "tc-wait<",
      "tc-wait<",
      "tc-wait#1<tc-wait",
      "legacy<tc-wait",
    ]);
  });
});
