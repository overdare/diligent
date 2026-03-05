// @summary Tests for thread-state reducer behavior over item lifecycle notifications
import { expect, test } from "bun:test";
import { ProtocolNotificationAdapter } from "@diligent/core/client";
import type { DiligentServerNotification } from "@diligent/protocol";
import { hydrateFromThreadRead, initialThreadState, reduceServerNotification } from "../src/client/lib/thread-store";

function reduce(state: typeof initialThreadState, notification: DiligentServerNotification) {
  const adapter = adapterInstance;
  const events = adapter.toAgentEvents(notification);
  return reduceServerNotification(state, notification, events);
}

// Shared adapter instance for tests that need stateful item tracking
let adapterInstance: ProtocolNotificationAdapter;

function resetAdapter() {
  adapterInstance = new ProtocolNotificationAdapter();
}

// Reset before each test sequence
resetAdapter();

test("merges item started/delta/completed into single assistant item", () => {
  resetAdapter();
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

  const a = reduce(initialThreadState, started);
  const b = reduce(a, delta);
  const c = reduce(b, completed);

  const assistant = c.items.find((item) => item.kind === "assistant");
  expect(assistant).toBeDefined();
  expect(assistant && assistant.kind === "assistant" ? assistant.text : "").toBe("hello");
});

test("ignores duplicate started item events", () => {
  resetAdapter();
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

  const a = reduce(initialThreadState, started);
  const b = reduce(a, started);

  expect(a.items.length).toBe(1);
  expect(b.items.length).toBe(1);
});

test("creates a new assistant item when same itemId appears in a new turn", () => {
  resetAdapter();
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

  const completedTurn1: DiligentServerNotification = {
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
          timestamp: 1,
        },
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

  const s1 = reduce(initialThreadState, startedTurn1);
  const s2 = reduce(s1, deltaTurn1);
  const s3 = reduce(s2, completedTurn1);
  const s4 = reduce(s3, startedTurn2);
  const s5 = reduce(s4, deltaTurn2);

  const assistants = s5.items.filter((item) => item.kind === "assistant");
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

test("hydrateFromThreadRead shows running sub-agent as running when parent isRunning and not yet waited", () => {
  const hydrated = hydrateFromThreadRead(initialThreadState, {
    messages: [
      {
        role: "assistant",
        content: [
          {
            type: "tool_call",
            id: "tc-spawn-1",
            name: "spawn_agent",
            input: { description: "do work" },
          },
        ],
        model: "x",
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        stopReason: "tool_use",
        timestamp: 100,
      },
      {
        role: "tool_result",
        toolCallId: "tc-spawn-1",
        toolName: "spawn_agent",
        output: JSON.stringify({ agent_id: "agent-0001", nickname: "Cleo" }),
        isError: false,
        timestamp: 101,
      },
    ],
    childSessions: [
      {
        sessionId: "ses-child-1",
        agentId: "agent-0001",
        nickname: "Cleo",
        description: "do work",
        messages: [],
        created: "2026-03-04T10:00:00Z",
      },
    ],
    isRunning: true,
    hasFollowUp: false,
    entryCount: 2,
  });

  const collab = hydrated.items.find((item) => item.kind === "collab" && item.eventType === "spawn");
  expect(collab).toBeDefined();
  expect(collab && collab.kind === "collab" ? collab.status : "").toBe("running");
});

test("hydrateFromThreadRead shows completed sub-agent after wait result", () => {
  const hydrated = hydrateFromThreadRead(initialThreadState, {
    messages: [
      {
        role: "assistant",
        content: [
          {
            type: "tool_call",
            id: "tc-spawn-1",
            name: "spawn_agent",
            input: { description: "do work" },
          },
        ],
        model: "x",
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        stopReason: "tool_use",
        timestamp: 100,
      },
      {
        role: "tool_result",
        toolCallId: "tc-spawn-1",
        toolName: "spawn_agent",
        output: JSON.stringify({ agent_id: "agent-0001", nickname: "Cleo" }),
        isError: false,
        timestamp: 101,
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool_call",
            id: "tc-wait-1",
            name: "wait",
            input: { ids: ["agent-0001"] },
          },
        ],
        model: "x",
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        stopReason: "tool_use",
        timestamp: 102,
      },
      {
        role: "tool_result",
        toolCallId: "tc-wait-1",
        toolName: "wait",
        output: JSON.stringify({
          status: { "agent-0001": { kind: "completed", output: "done" } },
          timed_out: false,
        }),
        isError: false,
        timestamp: 103,
      },
    ],
    childSessions: [
      {
        sessionId: "ses-child-1",
        agentId: "agent-0001",
        nickname: "Cleo",
        description: "do work",
        messages: [
          {
            role: "assistant",
            content: [{ type: "text", text: "I finished the work." }],
            model: "x",
            usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
            stopReason: "end_turn",
            timestamp: 102,
          },
        ],
        created: "2026-03-04T10:00:00Z",
      },
    ],
    isRunning: true,
    hasFollowUp: false,
    entryCount: 4,
  });

  const spawn = hydrated.items.find((item) => item.kind === "collab" && item.eventType === "spawn");
  expect(spawn).toBeDefined();
  expect(spawn && spawn.kind === "collab" ? spawn.status : "").toBe("completed");

  // Should also have childMessages from child session
  expect(spawn && spawn.kind === "collab" ? spawn.childMessages : []).toEqual(["I finished the work."]);
});

test("turn/interrupted settles in-flight thinking and streaming tool items", () => {
  resetAdapter();

  // Simulate: assistant thinking is in-flight (thinkingDone=false, no text yet)
  const itemStarted: DiligentServerNotification = {
    method: "item/started",
    params: {
      threadId: "t1",
      turnId: "turn1",
      item: {
        type: "agentMessage",
        itemId: "msg1",
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
  const thinkingDelta: DiligentServerNotification = {
    method: "item/delta",
    params: {
      threadId: "t1",
      turnId: "turn1",
      itemId: "msg1",
      delta: { type: "messageThinking", itemId: "msg1", delta: "hmm..." },
    },
  };
  const toolStarted: DiligentServerNotification = {
    method: "item/started",
    params: {
      threadId: "t1",
      turnId: "turn1",
      item: {
        type: "toolCall",
        itemId: "tool1",
        toolCallId: "tc1",
        toolName: "bash",
        input: { cmd: "sleep 10" },
      },
    },
  };

  let state = reduce({ ...initialThreadState, activeThreadId: "t1", threadStatus: "busy" }, itemStarted);
  state = reduce(state, thinkingDelta);
  state = reduce(state, toolStarted);

  // Verify in-flight state before interrupt
  const thinkingBefore = state.items.find((i) => i.kind === "assistant");
  expect(thinkingBefore && thinkingBefore.kind === "assistant" ? thinkingBefore.thinkingDone : true).toBe(false);
  const toolBefore = state.items.find((i) => i.kind === "tool");
  expect(toolBefore && toolBefore.kind === "tool" ? toolBefore.status : "done").toBe("streaming");
  expect(state.threadStatus).toBe("busy");

  // Now send turn/interrupted
  const interrupted: DiligentServerNotification = {
    method: "turn/interrupted",
    params: { threadId: "t1", turnId: "turn1" },
  };
  const after = reduce(state, interrupted);

  // threadStatus should be idle
  expect(after.threadStatus).toBe("idle");
  // assistant thinking should be settled
  const thinkingAfter = after.items.find((i) => i.kind === "assistant");
  expect(thinkingAfter && thinkingAfter.kind === "assistant" ? thinkingAfter.thinkingDone : false).toBe(true);
  // tool should be done
  const toolAfter = after.items.find((i) => i.kind === "tool");
  expect(toolAfter && toolAfter.kind === "tool" ? toolAfter.status : "streaming").toBe("done");
  // itemSlots should be cleared
  expect(Object.keys(after.itemSlots).length).toBe(0);
});

test("hydrateFromThreadRead shows completed sub-agent when parent is not running", () => {
  const hydrated = hydrateFromThreadRead(initialThreadState, {
    messages: [
      {
        role: "assistant",
        content: [
          {
            type: "tool_call",
            id: "tc-spawn-1",
            name: "spawn_agent",
            input: { description: "do work" },
          },
        ],
        model: "x",
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        stopReason: "tool_use",
        timestamp: 100,
      },
      {
        role: "tool_result",
        toolCallId: "tc-spawn-1",
        toolName: "spawn_agent",
        output: JSON.stringify({ agent_id: "agent-0001", nickname: "Cleo" }),
        isError: false,
        timestamp: 101,
      },
    ],
    childSessions: [
      {
        sessionId: "ses-child-1",
        agentId: "agent-0001",
        nickname: "Cleo",
        description: "do work",
        messages: [],
        created: "2026-03-04T10:00:00Z",
      },
    ],
    isRunning: false,
    hasFollowUp: false,
    entryCount: 2,
  });

  const collab = hydrated.items.find((item) => item.kind === "collab" && item.eventType === "spawn");
  expect(collab).toBeDefined();
  expect(collab && collab.kind === "collab" ? collab.status : "").toBe("completed");
});
