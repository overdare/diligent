// @summary Progressive TUI history, discovery, and navigation race regressions
import { expect, mock, test } from "bun:test";
import type { SessionSummary, ThreadHistoryResponse, ThreadItem } from "@diligent/protocol";
import { ChatView } from "../../src/tui/components/chat-view";
import { ListPicker } from "../../src/tui/components/list-picker";
import type { AppServerRpcClient } from "../../src/tui/rpc-client";
import { createThreadManager } from "../../src/tui/thread-manager";

const user = (id: string, text = id): ThreadItem => ({
  type: "userMessage",
  itemId: id,
  message: { role: "user", content: text, timestamp: 1 },
});
const page = (items: ThreadItem[], nextCursor?: string): ThreadHistoryResponse => ({
  cwd: "/project",
  items,
  nextCursor,
});
const session = (id: string): SessionSummary => ({ id, path: id, cwd: "/project", created: id, modified: id });
function setup(request: (method: string, params: unknown) => Promise<unknown>) {
  const historyShown = Promise.withResolvers<void>();
  const chat = new ChatView({ requestRender: () => {} });
  const showHistory = mock((history: ThreadHistoryResponse, reset: boolean) => {
    chat.setHistory(history, reset);
    historyShown.resolve();
  });
  const showProgress = mock((_message: string) => {});
  let current: string | null = null;
  const manager = createThreadManager({
    getRpcClient: () => ({ request }) as unknown as AppServerRpcClient,
    getCurrentMode: () => "default",
    getCurrentFastMode: () => false,
    setCurrentThreadId: (id) => {
      current = id;
    },
    updateStatusBar: () => {},
    showHistory,
    showProgress,
  });
  return { manager, chat, showHistory, showProgress, historyShown: historyShown.promise, current: () => current };
}

test("renders recent history and older pages while runtime preparation is unresolved", async () => {
  const resume = Promise.withResolvers<unknown>();
  const request = mock(async (method: string, params: unknown) => {
    if (method === "thread/history") {
      const older = typeof params === "object" && params !== null && "cursor" in params;
      return older ? page([user("older")]) : page([user("recent")], "earlier");
    }
    if (method === "thread/resume") return resume.promise;
    if (method === "thread/subscribe") return { subscriptionId: "subscription" };
    if (method === "thread/read") return { items: [], currentEffort: "medium" };
    throw new Error(method);
  });
  const { manager, chat, historyShown } = setup(request);
  const opening = manager.resumeThread("thread");
  await historyShown;
  expect(chat.getHistoryComponent().render(80).join("\n")).toContain("recent");
  expect(manager.isReady()).toBe(false);
  await manager.loadOlderHistory();
  const transcript = chat.getHistoryComponent().render(80).join("\n");
  expect(transcript).toContain("older");
  expect(transcript).toContain("recent");
  resume.resolve({ found: true, threadId: "thread" });
  await opening;
  expect(manager.isReady()).toBe(true);
});

test("a late selected page cannot replace a newer session", async () => {
  const old = Promise.withResolvers<unknown>();
  const { manager, current, showHistory } = setup(async (method) => {
    if (method === "thread/history") return old.promise;
    if (method === "thread/start") return { threadId: "new" };
    if (method === "thread/subscribe") return { subscriptionId: "s" };
    throw new Error(method);
  });
  const opening = manager.resumeThread("old");
  await manager.startNewThread();
  old.resolve(page([user("old")]));
  await opening;
  expect(current()).toBe("new");
  expect(showHistory.mock.calls).toHaveLength(1);
  expect(showHistory.mock.calls[0][0].items).toEqual([]);
  expect(manager.isReady()).toBe(true);
});

test("discovery publishes every batch including an empty intermediate page", async () => {
  const last = Promise.withResolvers<unknown>();
  let calls = 0;
  const { manager } = setup(async () => {
    calls++;
    if (calls === 1) return { data: [session("a")], nextCursor: "two" };
    if (calls === 2) return { data: [], nextCursor: "three" };
    return last.promise;
  });
  const batches: string[][] = [];
  const firstBatches = Promise.withResolvers<void>();
  const listing = manager.listThreads((threads) => {
    batches.push(threads.map((thread) => thread.id));
    if (batches.length === 2) firstBatches.resolve();
  });
  await firstBatches.promise;
  expect(batches).toEqual([["a"], ["a"]]);
  last.resolve({ data: [session("z")] });
  await listing;
  expect(batches.at(-1)).toEqual(["z", "a"]);
});

test("history errors remain visible and do not silently start another thread", async () => {
  const request = mock(async () => {
    throw new Error("history unavailable");
  });
  const { manager, showProgress } = setup(request);
  expect(await manager.resumeThread("broken")).toBeNull();
  expect(manager.isReady()).toBe(false);
  expect(showProgress.mock.calls.flat().join("\n")).toContain("history unavailable");
  expect(request).toHaveBeenCalledTimes(1);
});

test("older pages keep the realtime transcript and offer /older while more history exists", () => {
  const chat = new ChatView({ requestRender: () => {} });
  chat.setHistory(page([user("recent", "recent message")], "older"), true);
  chat.addUserMessage("live message");
  chat.setHistory(page([user("previous", "previous message")]), false);
  const text = chat.getHistoryComponent().render(80).join("\n");
  expect(text).toContain("Earlier history available: /older");
  expect(text).toContain("live message");
  expect(text).toContain("previous message");
});

test("a progressive picker keeps the user's selection as newer batches reorder rows", () => {
  const result = mock((_value: string | null) => {});
  const picker = new ListPicker({ title: "Sessions", items: [{ label: "a", value: "a" }] }, result);
  picker.setItems([
    { label: "z", value: "z" },
    { label: "a", value: "a" },
  ]);
  expect(picker.render(80).join("\n")).toContain("z");
  picker.handleInput("\r");
  expect(result).toHaveBeenCalledWith("a");
});
