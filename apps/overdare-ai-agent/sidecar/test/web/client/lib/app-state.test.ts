// @summary Tests for app-level reducer behavior extracted from App orchestrator

import { expect, test } from "bun:test";
import { appReducer } from "../../../../src/web/client/lib/app-state";
import { initialThreadState } from "../../../../src/web/client/lib/thread-store";
import { resolveDraftModel } from "../../../../src/web/client/lib/use-provider-manager";

test("late goal command replies cannot replace another thread's goal state", () => {
  const state = { ...initialThreadState, activeThreadId: "new", goalSequence: 2 };
  const next = appReducer(state, {
    type: "set_goal_snapshot",
    payload: { threadId: "old", goal: null, sequence: 100 },
  });
  expect(next).toBe(state);
});

test("a stale read of the same thread cannot roll back a newer goal notification", () => {
  const state = { ...initialThreadState, activeThreadId: "thread", goalSequence: 10 };
  const next = appReducer(state, {
    type: "hydrate",
    payload: {
      threadId: "thread",
      mode: "default",
      history: {
        cwd: "/tmp",
        items: [],
        errors: [],
        hasFollowUp: false,
        pendingSteers: [],
        entryCount: 0,
        isRunning: false,
        currentMode: "default",
        currentEffort: "medium",
        goal: null,
        goalSequence: 4,
      },
    },
  });
  expect(next.goalSequence).toBe(10);
});

test("set_threads keeps optimistic first message when server value is empty", () => {
  const seeded = {
    ...initialThreadState,
    threadList: [
      {
        id: "t1",
        path: "",
        cwd: "",
        created: "2026-01-01T00:00:00.000Z",
        modified: "2026-01-01T00:00:00.000Z",
        messageCount: 1,
        firstUserMessage: "hello optimistic",
      },
    ],
  };

  const next = appReducer(seeded, {
    type: "set_threads",
    payload: [
      {
        id: "t1",
        path: "",
        cwd: "",
        created: "2026-01-01T00:00:00.000Z",
        modified: "2026-01-02T00:00:00.000Z",
        messageCount: 1,
      },
    ],
  });

  expect(next.threadList[0]?.firstUserMessage).toBe("hello optimistic");
});

test("set_threads keeps optimistic thread not yet returned by server", () => {
  const seeded = {
    ...initialThreadState,
    threadList: [
      {
        id: "optimistic-only",
        path: "",
        cwd: "",
        created: "2026-01-01T00:00:00.000Z",
        modified: "2026-01-01T00:00:00.000Z",
        messageCount: 1,
        firstUserMessage: "just sent",
      },
      {
        id: "existing",
        path: "",
        cwd: "",
        created: "2026-01-01T00:00:00.000Z",
        modified: "2026-01-01T00:00:00.000Z",
        messageCount: 2,
        firstUserMessage: "older",
      },
    ],
  };

  const next = appReducer(seeded, {
    type: "set_threads",
    payload: [
      {
        id: "existing",
        path: "",
        cwd: "",
        created: "2026-01-01T00:00:00.000Z",
        modified: "2026-01-02T00:00:00.000Z",
        messageCount: 2,
        firstUserMessage: "older",
      },
    ],
  });

  expect(next.threadList.map((thread) => thread.id)).toEqual(["optimistic-only", "existing"]);
  expect(next.threadList[0]?.firstUserMessage).toBe("just sent");
});

test("set_threads drops stale legacy optimistic-like thread from top", () => {
  const seeded = {
    ...initialThreadState,
    threadList: [
      {
        id: "legacy-thread",
        path: "/repo/.diligent/sessions/legacy-thread.jsonl",
        cwd: "/repo",
        created: "2026-01-01T00:00:00.000Z",
        modified: "2026-01-03T00:00:00.000Z",
        messageCount: 5,
        firstUserMessage: "older discussion",
      },
      {
        id: "server-top",
        path: "/repo/.diligent/sessions/server-top.jsonl",
        cwd: "/repo",
        created: "2026-01-02T00:00:00.000Z",
        modified: "2026-01-02T00:00:00.000Z",
        messageCount: 2,
        firstUserMessage: "newer on server",
      },
    ],
  };

  const next = appReducer(seeded, {
    type: "set_threads",
    payload: [
      {
        id: "server-top",
        path: "/repo/.diligent/sessions/server-top.jsonl",
        cwd: "/repo",
        created: "2026-01-02T00:00:00.000Z",
        modified: "2026-01-02T00:00:00.000Z",
        messageCount: 2,
        firstUserMessage: "newer on server",
      },
    ],
  });

  expect(next.threadList.map((thread) => thread.id)).toEqual(["server-top"]);
});

test("set_threads hides empty pre-message conversations", () => {
  const next = appReducer(initialThreadState, {
    type: "set_threads",
    payload: [
      {
        id: "empty-thread",
        path: "/repo/.diligent/sessions/empty-thread.jsonl",
        cwd: "/repo",
        created: "2026-01-02T00:00:00.000Z",
        modified: "2026-01-02T00:00:00.000Z",
        messageCount: 0,
      },
      {
        id: "active-thread",
        path: "/repo/.diligent/sessions/active-thread.jsonl",
        cwd: "/repo",
        created: "2026-01-01T00:00:00.000Z",
        modified: "2026-01-03T00:00:00.000Z",
        messageCount: 3,
        firstUserMessage: "hello",
      },
    ],
  });

  expect(next.threadList.map((thread) => thread.id)).toEqual(["active-thread"]);
});

test("optimistic_thread prepends a new thread when absent", () => {
  const next = appReducer(initialThreadState, {
    type: "optimistic_thread",
    payload: { threadId: "t-new", message: "first message" },
  });

  expect(next.threadList[0]?.id).toBe("t-new");
  expect(next.threadList[0]?.firstUserMessage).toBe("first message");
  expect(next.threadList[0]?.messageCount).toBe(1);
});

test("optimistic_thread updates existing thread missing first message", () => {
  const seeded = {
    ...initialThreadState,
    threadList: [
      {
        id: "t1",
        path: "",
        cwd: "",
        created: "2026-01-01T00:00:00.000Z",
        modified: "2026-01-01T00:00:00.000Z",
        messageCount: 0,
      },
    ],
  };

  const next = appReducer(seeded, {
    type: "optimistic_thread",
    payload: { threadId: "t1", message: "seeded now" },
  });

  expect(next.threadList).toHaveLength(1);
  expect(next.threadList[0]?.firstUserMessage).toBe("seeded now");
});

test("bind_user_message_id updates only the matching optimistic request", () => {
  const withFailedRequest = appReducer(initialThreadState, {
    type: "local_user",
    payload: { id: "local-failed", text: "blocked", images: [] },
  });
  const withSuccessfulRequest = appReducer(withFailedRequest, {
    type: "local_user",
    payload: { id: "local-success", text: "accepted", images: [] },
  });

  const next = appReducer(withSuccessfulRequest, {
    type: "bind_user_message_id",
    payload: { renderItemId: "local-success", messageId: "persistent-success" },
  });

  const users = next.items.filter((item) => item.kind === "user");
  expect(users[0]?.kind === "user" ? users[0].messageId : undefined).toBeUndefined();
  expect(users[1]?.kind === "user" ? users[1].messageId : undefined).toBe("persistent-success");
});

test("reset_draft clears active thread and items but preserves thread list", () => {
  const seeded = {
    ...initialThreadState,
    activeThreadId: "t1",
    activeThreadCwd: "/repo",
    mode: "plan" as const,
    items: [
      {
        id: "local-user-1",
        kind: "user" as const,
        text: "hello",
        images: [],
        timestamp: 1,
      },
    ],
    threadList: [
      {
        id: "t1",
        path: "",
        cwd: "/repo",
        created: "2026-01-01T00:00:00.000Z",
        modified: "2026-01-01T00:00:00.000Z",
        messageCount: 1,
        firstUserMessage: "hello",
      },
    ],
  };

  const next = appReducer(seeded, {
    type: "reset_draft",
    payload: { mode: "execute" },
  });

  expect(next.activeThreadId).toBeNull();
  expect(next.items).toEqual([]);
  expect(next.mode).toBe("execute");
  expect(next.threadList).toEqual(seeded.threadList);
});

test("hydrate prefers restored thread mode from thread/read history", () => {
  const next = appReducer(
    {
      ...initialThreadState,
      mode: "default",
    },
    {
      type: "hydrate",
      payload: {
        threadId: "thread-1",
        mode: "default",
        history: {
          cwd: "/repo",
          items: [],
          hasFollowUp: false,
          entryCount: 1,
          isRunning: false,
          currentMode: "plan",
          currentEffort: "medium",
          currentModel: "gpt-5",
        },
      },
    },
  );

  expect(next.activeThreadId).toBe("thread-1");
  expect(next.mode).toBe("plan");
});

test("hydrate resets mode when switching from a plan thread to a default thread", () => {
  const next = appReducer(
    {
      ...initialThreadState,
      activeThreadId: "plan-thread",
      activeThreadCwd: "/repo",
      mode: "plan",
    },
    {
      type: "hydrate",
      payload: {
        threadId: "default-thread",
        mode: "default",
        history: {
          cwd: "/repo",
          items: [],
          hasFollowUp: false,
          entryCount: 1,
          isRunning: false,
          currentMode: "default",
          currentEffort: "medium",
          currentModel: "gpt-5",
        },
      },
    },
  );

  expect(next.activeThreadId).toBe("default-thread");
  expect(next.mode).toBe("default");
});

test("consume_first_pending_steer removes head entry only", () => {
  const seeded = {
    ...initialThreadState,
    pendingSteers: [
      { id: "s1", content: "a" },
      { id: "s2", content: "b" },
      { id: "s3", content: "c" },
    ],
  };

  const next = appReducer(seeded, { type: "consume_first_pending_steer" });

  expect(next.pendingSteers.map((steer) => steer.content)).toEqual(["b", "c"]);
});

test("cancel_pending_steer removes the selected queued steer", () => {
  const seeded = {
    ...initialThreadState,
    pendingSteers: [
      { id: "s1", content: "a" },
      { id: "s2", content: "b" },
      { id: "s3", content: "c" },
    ],
  };

  const next = appReducer(seeded, { type: "cancel_pending_steer", payload: { steerId: "s2" } });

  expect(next.pendingSteers.map((steer) => steer.content)).toEqual(["a", "c"]);
});

test("update_pending_steer replaces the selected queued steer", () => {
  const seeded = {
    ...initialThreadState,
    pendingSteers: [
      { id: "s1", content: "a" },
      { id: "s2", content: "b" },
      { id: "s3", content: "c" },
    ],
  };

  const next = appReducer(seeded, {
    type: "update_pending_steer",
    payload: { steerId: "s2", content: "updated" },
  });

  expect(next.pendingSteers.map((steer) => steer.content)).toEqual(["a", "updated", "c"]);
});

test("local_steer queues steer text without creating a local user item", () => {
  const next = appReducer(initialThreadState, {
    type: "local_steer",
    payload: { id: "s1", content: "adjust plan" },
  });

  expect(next.pendingSteers).toEqual([{ id: "s1", content: "adjust plan" }]);
  expect(next.items).toEqual([]);
});

test("compaction_error clears compacting state", () => {
  const next = appReducer(
    {
      ...initialThreadState,
      isCompacting: true,
    },
    { type: "compaction_error" },
  );

  expect(next.isCompacting).toBe(false);
});

test("resolveDraftModel preserves the current user-selected model when available", () => {
  const next = resolveDraftModel({
    initialModel: { provider: "openai", modelId: "gpt-5" },
    currentModel: { provider: "anthropic", modelId: "claude-sonnet" },
    availableModels: [
      { modelId: "claude-sonnet", provider: "anthropic" },
      { modelId: "gpt-5", provider: "openai" },
    ],
  });

  expect(next).toEqual({ provider: "anthropic", modelId: "claude-sonnet" });
});

test("resolveDraftModel falls back to initial model when current model is unavailable", () => {
  const next = resolveDraftModel({
    initialModel: { provider: "openai", modelId: "gpt-5" },
    currentModel: { provider: "anthropic", modelId: "claude-sonnet" },
    availableModels: [{ modelId: "gpt-5", provider: "openai" }],
  });

  expect(next).toEqual({ provider: "openai", modelId: "gpt-5" });
});

test("resolveDraftModel prefers the runtime default over catalog order", () => {
  const next = resolveDraftModel({
    initialModel: { provider: "openai", modelId: "gpt-5.6-sol" },
    currentModel: undefined,
    availableModels: [
      { modelId: "gpt-5.6-terra", provider: "openai" },
      { modelId: "gpt-5.6-sol", provider: "openai" },
    ],
  });

  expect(next).toEqual({ provider: "openai", modelId: "gpt-5.6-sol" });
});

test("empty first pages retain their older cursor and exhausted cursors do not return on refresh", () => {
  let state = appReducer(initialThreadState, { type: "select_history", payload: { threadId: "thread" } });
  state = appReducer(state, {
    type: "history_page",
    payload: { threadId: "thread", page: { cwd: "/project", items: [], nextCursor: "ancestor" } },
  });
  expect(state.runtimeReady).toBe(false);
  expect(state.historyCursor).toBe("ancestor");
  state = appReducer(state, {
    type: "history_page",
    payload: { threadId: "thread", older: true, page: { cwd: "/project", items: [] } },
  });
  expect(state.historyCursor).toBeUndefined();
  state = appReducer(state, {
    type: "history_page",
    payload: { threadId: "thread", page: { cwd: "/project", items: [], nextCursor: "ancestor" } },
  });
  expect(state.historyCursor).toBeUndefined();
});

test("older tool starts enrich completed results while preserving new realtime messages", () => {
  let state = appReducer(initialThreadState, { type: "select_history", payload: { threadId: "thread" } });
  state = appReducer(state, {
    type: "history_page",
    payload: {
      threadId: "thread",
      page: {
        cwd: "/project",
        nextCursor: "older",
        items: [
          {
            type: "toolCall",
            itemId: "tool:one",
            toolCallId: "one",
            toolName: "read",
            input: {},
            output: "complete output",
            timestamp: 20,
          },
        ],
      },
    },
  });
  state = appReducer(state, { type: "local_user", payload: { id: "local", text: "new draft message", images: [] } });
  state = appReducer(state, {
    type: "history_page",
    payload: {
      threadId: "thread",
      older: true,
      page: {
        cwd: "/project",
        items: [
          {
            type: "toolCall",
            itemId: "tool:one",
            toolCallId: "one",
            toolName: "read",
            input: { path: "file.ts" },
            startedAt: 10,
            timestamp: 10,
          },
        ],
      },
    },
  });
  const tools = state.items.filter((item) => item.kind === "tool");
  expect(tools).toHaveLength(1);
  expect(tools[0].inputText).toContain("file.ts");
  expect(tools[0].outputText).toBe("complete output");
  expect(state.items.at(-1)).toMatchObject({ kind: "user", text: "new draft message" });
});

test("older pages keep unchanged items as the same objects so their rows skip rendering", () => {
  const tool = (id: string, timestamp: number) => ({
    type: "toolCall" as const,
    itemId: `tool:${id}`,
    toolCallId: id,
    toolName: "read",
    input: { path: `${id}.ts` },
    output: `${id} output`,
    startedAt: timestamp,
    timestamp,
  });
  let state = appReducer(initialThreadState, { type: "select_history", payload: { threadId: "thread" } });
  state = appReducer(state, {
    type: "history_page",
    payload: {
      threadId: "thread",
      page: {
        cwd: "/project",
        nextCursor: "older",
        items: [
          tool("recent", 20),
          { type: "userMessage", itemId: "user", message: { role: "user", content: "hello", timestamp: 21 } },
        ],
      },
    },
  });
  const before = state.items;
  state = appReducer(state, {
    type: "history_page",
    payload: { threadId: "thread", older: true, page: { cwd: "/project", items: [tool("old", 10)] } },
  });
  expect(state.items).toHaveLength(3);
  expect(state.items[1]).toBe(before[0]);
  expect(state.items[2]).toBe(before[1]);
});

test("metadata and recent refreshes preserve earlier history and reject another selection", () => {
  let state = appReducer(initialThreadState, { type: "select_history", payload: { threadId: "thread" } });
  const item = {
    type: "userMessage" as const,
    itemId: "old",
    message: { role: "user" as const, content: "earlier", timestamp: 1 },
  };
  state = appReducer(state, {
    type: "history_page",
    payload: { threadId: "thread", page: { cwd: "/project", items: [item] } },
  });
  state = appReducer(state, {
    type: "thread_metadata",
    payload: {
      threadId: "thread",
      history: {
        cwd: "/project",
        items: [],
        hasFollowUp: false,
        entryCount: 100,
        isRunning: false,
        currentEffort: "medium",
      },
    },
  });
  state = appReducer(state, {
    type: "history_page",
    payload: { threadId: "thread", page: { cwd: "/project", items: [] } },
  });
  expect(state.items).toHaveLength(1);
  expect(state.runtimeReady).toBe(true);
  expect(
    appReducer(state, { type: "history_page", payload: { threadId: "other", page: { cwd: "/other", items: [] } } }),
  ).toBe(state);
});

test("a disjoint recent refresh keeps the missing interval reachable through older pages", () => {
  const item = (timestamp: number) => ({
    type: "userMessage" as const,
    itemId: `message-${timestamp}`,
    message: { role: "user" as const, content: `Message ${timestamp}`, timestamp },
  });
  let state = appReducer(initialThreadState, { type: "select_history", payload: { threadId: "thread" } });
  state = appReducer(state, {
    type: "history_page",
    payload: { threadId: "thread", page: { cwd: "/project", items: [item(1)] } },
  });
  state = appReducer(state, {
    type: "history_page",
    payload: { threadId: "thread", page: { cwd: "/project", items: [item(3)], nextCursor: "missing-interval" } },
  });
  expect(state.historyCursor).toBe("missing-interval");
  state = appReducer(state, {
    type: "history_page",
    payload: { threadId: "thread", older: true, page: { cwd: "/project", items: [item(1), item(2)] } },
  });
  expect(state.historyItems.map((entry) => entry.itemId)).toEqual(["message-1", "message-2", "message-3"]);
  expect(state.historyCursor).toBeUndefined();
});
