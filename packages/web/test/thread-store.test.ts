// @summary Tests for thread-state reducer behavior over item lifecycle notifications
import { expect, test } from "bun:test";
import type { DiligentServerNotification } from "@diligent/protocol";
import { hydrateFromThreadRead, initialThreadState, reduceServerNotification } from "../src/client/lib/thread-store";

test("merges item started/delta/completed into single assistant item", () => {
  const started: DiligentServerNotification = {
    method: "item/started",
    params: {
      threadId: "t1",
      turnId: "turn1",
      item: {
        type: "agentMessage",
        itemId: "item1",
        message: {
          role: "assistant",
          content: [],
          model: "x",
          usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
          stopReason: "end_turn",
          timestamp: 1,
        },
      },
    },
  };

  const delta: DiligentServerNotification = {
    method: "item/delta",
    params: {
      threadId: "t1",
      turnId: "turn1",
      itemId: "item1",
      delta: {
        type: "messageText",
        itemId: "item1",
        delta: "hello",
      },
    },
  };

  const completed: DiligentServerNotification = {
    method: "item/completed",
    params: {
      threadId: "t1",
      turnId: "turn1",
      item: {
        type: "agentMessage",
        itemId: "item1",
        message: {
          role: "assistant",
          content: [],
          model: "x",
          usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
          stopReason: "end_turn",
          timestamp: 2,
        },
      },
    },
  };

  const a = reduceServerNotification(initialThreadState, started);
  const b = reduceServerNotification(a, delta);
  const c = reduceServerNotification(b, completed);

  const assistant = c.items.find((item) => item.kind === "assistant");
  expect(assistant).toBeDefined();
  expect(assistant && assistant.kind === "assistant" ? assistant.text : "").toBe("hello");
});

test("ignores duplicate started item events", () => {
  const started: DiligentServerNotification = {
    method: "item/started",
    params: {
      threadId: "t1",
      turnId: "turn1",
      item: {
        type: "toolCall",
        itemId: "tool1",
        toolCallId: "tool1",
        toolName: "bash",
        input: { cmd: "ls" },
      },
    },
  };

  const a = reduceServerNotification(initialThreadState, started);
  const b = reduceServerNotification(a, started);

  expect(a.items.length).toBe(1);
  expect(b.items.length).toBe(1);
});

test("creates a new assistant item when same itemId appears in a new turn", () => {
  const startedTurn1: DiligentServerNotification = {
    method: "item/started",
    params: {
      threadId: "t1",
      turnId: "turn1",
      item: {
        type: "agentMessage",
        itemId: "item1",
        message: {
          role: "assistant",
          content: [],
          model: "x",
          usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
          stopReason: "end_turn",
          timestamp: 1,
        },
      },
    },
  };

  const deltaTurn1: DiligentServerNotification = {
    method: "item/delta",
    params: {
      threadId: "t1",
      turnId: "turn1",
      itemId: "item1",
      delta: {
        type: "messageText",
        itemId: "item1",
        delta: "first",
      },
    },
  };

  const startedTurn2: DiligentServerNotification = {
    method: "item/started",
    params: {
      threadId: "t1",
      turnId: "turn2",
      item: {
        type: "agentMessage",
        itemId: "item1",
        message: {
          role: "assistant",
          content: [],
          model: "x",
          usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
          stopReason: "end_turn",
          timestamp: 2,
        },
      },
    },
  };

  const deltaTurn2: DiligentServerNotification = {
    method: "item/delta",
    params: {
      threadId: "t1",
      turnId: "turn2",
      itemId: "item1",
      delta: {
        type: "messageText",
        itemId: "item1",
        delta: "second",
      },
    },
  };

  const s1 = reduceServerNotification(initialThreadState, startedTurn1);
  const s2 = reduceServerNotification(s1, deltaTurn1);
  const s3 = reduceServerNotification(s2, startedTurn2);
  const s4 = reduceServerNotification(s3, deltaTurn2);

  const assistants = s4.items.filter((item) => item.kind === "assistant");
  expect(assistants.length).toBe(2);
  expect(assistants[0] && assistants[0].kind === "assistant" ? assistants[0].text : "").toBe("first");
  expect(assistants[1] && assistants[1].kind === "assistant" ? assistants[1].text : "").toBe("second");
});

test("hydrateFromThreadRead restores tool_call input and merges matching tool_result output", () => {
  const hydrated = hydrateFromThreadRead(initialThreadState, {
    messages: [
      {
        role: "assistant",
        content: [
          { type: "tool_call", id: "tc-read-1", name: "read", input: { file_path: "/repo/src/app.ts" } },
          { type: "text", text: "Reading file" },
        ],
        model: "x",
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        stopReason: "tool_use",
        timestamp: 100,
      },
      {
        role: "tool_result",
        toolCallId: "tc-read-1",
        toolName: "read",
        output: "1| const x = 1;",
        isError: false,
        timestamp: 101,
      },
    ],
    hasFollowUp: false,
    entryCount: 2,
  });

  const tool = hydrated.items.find((item) => item.kind === "tool" && item.toolCallId === "tc-read-1");
  expect(tool && tool.kind === "tool" ? tool.toolName : "").toBe("read");
  expect(tool && tool.kind === "tool" ? tool.inputText : "").toContain("file_path");
  expect(tool && tool.kind === "tool" ? tool.outputText : "").toContain("const x = 1");
});

test("hydrateFromThreadRead keeps tool_result even without prior tool_call block", () => {
  const hydrated = hydrateFromThreadRead(initialThreadState, {
    messages: [
      {
        role: "tool_result",
        toolCallId: "tc-ls-1",
        toolName: "ls",
        output: "src/\nREADME.md",
        isError: false,
        timestamp: 200,
      },
    ],
    hasFollowUp: false,
    entryCount: 1,
  });

  const tool = hydrated.items.find((item) => item.kind === "tool" && item.toolCallId === "tc-ls-1");
  expect(tool).toBeDefined();
  expect(tool && tool.kind === "tool" ? tool.toolName : "").toBe("ls");
  expect(tool && tool.kind === "tool" ? tool.outputText : "").toContain("README.md");
});
