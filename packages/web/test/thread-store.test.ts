// @summary Tests for thread-state reducer behavior over item lifecycle notifications
import { expect, test } from "bun:test";
import type { DiligentServerNotification } from "@diligent/protocol";
import { initialThreadState, reduceServerNotification } from "../src/client/lib/thread-store";

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
