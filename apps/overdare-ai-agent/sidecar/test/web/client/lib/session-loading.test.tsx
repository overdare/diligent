// @summary Regressions for usable startup and user navigation while session history is loading
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({ url: "http://localhost/" });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { afterAll, afterEach, expect, test } from "bun:test";
import type { SessionSummary, ThreadHistoryResponse, ThreadReadResponse } from "@diligent/protocol";
import { act, createElement, useCallback, useReducer, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { appReducer } from "../../../../src/web/client/lib/app-state";
import type { WebRpcClient } from "../../../../src/web/client/lib/rpc-client";
import { initialThreadState } from "../../../../src/web/client/lib/thread-store";
import { useAppBootstrap } from "../../../../src/web/client/lib/use-app-lifecycle";
import { useThreadManager } from "../../../../src/web/client/lib/use-thread-manager";

const mounted: Array<{ root: Root; container: HTMLDivElement }> = [];
const noop = () => {};
const asyncNoop = async () => {};
const history: ThreadReadResponse = {
  cwd: "/project",
  items: [],
  hasFollowUp: false,
  entryCount: 0,
  isRunning: false,
  currentEffort: "medium",
};
const recentHistory: ThreadHistoryResponse = {
  cwd: "/project",
  nextCursor: "older",
  items: [
    { type: "userMessage", itemId: "recent", message: { role: "user", content: "Recent conversation", timestamp: 1 } },
  ],
};
const latest: SessionSummary = {
  id: "latest",
  path: "/project/latest.jsonl",
  cwd: "/project",
  created: "2026-01-01T00:00:00.000Z",
  modified: "2026-01-02T00:00:00.000Z",
  messageCount: 1,
  firstUserMessage: "Previous conversation",
};

afterEach(async () => {
  for (const { root, container } of mounted.splice(0)) {
    await act(async () => root.unmount());
    container.remove();
  }
});
afterAll(() => void GlobalRegistrator.unregister());

async function renderBootstrap(path = "/", delayedRead = false, delayedResume = false, delayedInitialize = false) {
  window.history.replaceState(null, "", path);
  const listing = Promise.withResolvers<SessionSummary[]>();
  const reading = Promise.withResolvers<ThreadHistoryResponse>();
  const preparing = Promise.withResolvers<{ found: boolean; threadId: string }>();
  const initializing = Promise.withResolvers<unknown>();
  const requests: Array<{ method: string; params: unknown }> = [];
  const modelEvents: string[] = [];
  const setInitialModel = () => void modelEvents.push("defaults");
  const applySessionModel = async () => void modelEvents.push("session");
  let manager: {
    openThread: (threadId: string) => Promise<void>;
    startNewThread: () => Promise<void>;
    loadEarlierHistory: () => Promise<void>;
    isPreparingThread: boolean;
    historyError: string | null;
  };
  const activeThreadIdRef = { current: null as string | null };
  const rpcRef = {
    current: {
      initialize: async () =>
        delayedInitialize ? initializing.promise : { cwd: "/project", capabilities: { goals: true } },
      notify: noop,
      subscribe: async () => ({ subscriptionId: "subscription" }),
      unsubscribe: async () => {},
      // The remote consent sync never settles here: bootstrap must not depend on it.
      requestRaw: (method: string) => {
        requests.push({ method, params: {} });
        return Promise.withResolvers<unknown>().promise;
      },
      request: async (method: string, params: { threadId?: string; cursor?: string }) => {
        requests.push({ method, params });
        if (method === "thread/resume")
          return delayedResume ? preparing.promise : { found: true, threadId: params.threadId };
        if (method === "thread/history") {
          if (params.cursor)
            return {
              cwd: "/project",
              items: [
                {
                  type: "userMessage",
                  itemId: "old",
                  message: { role: "user", content: "Older conversation", timestamp: 0 },
                },
              ],
            };
          return delayedRead ? reading.promise : recentHistory;
        }
        if (method === "thread/read") return history;
        throw new Error(`Unexpected request: ${method}`);
      },
    } as unknown as WebRpcClient,
  };
  const listCalls = { count: 0 };
  const refreshThreadList = (() => {
    listCalls.count++;
    return listing.promise;
  }) as Parameters<typeof useAppBootstrap>[0]["refreshThreadList"];
  function Screen() {
    const [state, dispatch] = useReducer(appReducer, initialThreadState);
    const [providersReady, setProvidersReady] = useState(false);
    activeThreadIdRef.current = state.activeThreadId;
    const stateRef = useRef(state);
    stateRef.current = state;
    manager = useThreadManager({
      rpcRef,
      dispatch,
      activeThreadIdRef,
      stateRef,
      applySessionModel,
      resetDraftModel: noop,
      setEffortState: noop,
      setFastModeState: noop,
      activateThreadPrompts: noop,
      shelveThreadPrompts: noop,
      clearAttention: noop,
      closeModals: noop,
    });
    const refreshProviders = useCallback(async () => setProvidersReady(true), []);
    useAppBootstrap({
      connection: "connected",
      rpcRef,
      activeThreadIdRef,
      dispatch,
      setCwd: noop,
      setEffortState: noop,
      setFastModeState: noop,
      setSkills: noop,
      setRuntimeVersion: noop,
      setGoalsSupported: noop,
      setConsent: noop,
      setInitialModel,
      openThread: manager.openThread,
      refreshThreadList,
      refreshProviders,
    });
    return createElement(
      "div",
      null,
      createElement("textarea", { disabled: !providersReady, "aria-label": "Message" }),
      createElement("output", null, state.activeThreadId ?? "draft"),
      createElement(
        "section",
        null,
        state.items
          .filter((item) => item.kind === "user")
          .map((item) => item.text)
          .join(","),
      ),
      createElement(
        "span",
        { role: "status" },
        manager.isPreparingThread ? "preparing" : state.runtimeReady ? "ready" : "not ready",
      ),
      manager.historyError ? createElement("span", { role: "alert" }, manager.historyError) : null,
      createElement("button", { type: "button", onClick: () => void manager.startNewThread() }, "New conversation"),
    );
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => root.render(createElement(Screen)));
  return {
    container,
    listing,
    reading,
    preparing,
    initializing,
    requests,
    modelEvents,
    listCalls,
    manager: () => manager,
  };
}

test("the composer is ready while the initial session list is still pending", async () => {
  const { container, listing } = await renderBootstrap();
  expect(container.querySelector("textarea")!.disabled).toBe(false);
  expect(container.querySelector("output")!.textContent).toBe("draft");
  await act(async () => listing.resolve([latest]));
  expect(container.querySelector("output")!.textContent).toBe(latest.id);
});

test("starting a new conversation prevents a late automatic history restore", async () => {
  const { container, listing } = await renderBootstrap();
  await act(async () => {
    const button = container.querySelector("button")!;
    button.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    button.click();
  });
  await act(async () => listing.resolve([latest]));
  expect(container.querySelector("output")!.textContent).toBe("draft");
  expect(window.location.pathname).toBe("/");
});

test("typing while history is loading preserves the draft instead of opening the latest session", async () => {
  const { container, listing } = await renderBootstrap();
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
  });
  await act(async () => listing.resolve([latest]));
  expect(container.querySelector("output")!.textContent).toBe("draft");
});

test("a deep-linked conversation restores without waiting for the sidebar", async () => {
  const { container, listing } = await renderBootstrap("/selected");
  expect(container.querySelector("output")!.textContent).toBe("selected");
  expect(container.querySelector("textarea")!.disabled).toBe(false);
  await act(async () => listing.resolve([latest]));
  expect(container.querySelector("output")!.textContent).toBe("selected");
});

test("a deep-linked conversation loads while initialize is pending and its model lands after the defaults", async () => {
  const { container, initializing, requests, modelEvents } = await renderBootstrap("/selected", false, false, true);
  expect(container.querySelector("section")!.textContent).toBe("Recent conversation");
  expect(requests.map((request) => request.method)).toContain("thread/resume");
  expect(modelEvents).toEqual([]);
  expect(container.querySelector('[role="status"]')!.textContent).toBe("preparing");
  await act(async () => initializing.resolve({ cwd: "/project", capabilities: { goals: true } }));
  expect(modelEvents).toEqual(["defaults", "session"]);
  expect(container.querySelector('[role="status"]')!.textContent).toBe("ready");
});

test("a deep-linked conversation reads its first page before the sidebar scan starts", async () => {
  const { container, reading, listCalls } = await renderBootstrap("/selected", true);
  expect(listCalls.count).toBe(0);
  await act(async () => reading.resolve(recentHistory));
  expect(container.querySelector("section")!.textContent).toBe("Recent conversation");
  expect(listCalls.count).toBe(1);
});

test("the sidebar scan still starts when the first history page fails", async () => {
  const { reading, listCalls } = await renderBootstrap("/selected", true);
  await act(async () => reading.reject(new Error("History unavailable")));
  expect(listCalls.count).toBe(1);
});

test("a draft without a deep link lists sessions immediately to find the latest", async () => {
  const { listCalls } = await renderBootstrap("/", false, false, true);
  expect(listCalls.count).toBe(1);
});

test("a late history read cannot replace a new draft", async () => {
  const { container, listing, reading } = await renderBootstrap("/selected", true);
  await act(async () => {
    const button = container.querySelector("button")!;
    button.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    button.click();
    window.history.replaceState(null, "", "/");
  });
  await act(async () => {
    reading.resolve(recentHistory);
    listing.resolve([latest]);
  });
  expect(container.querySelector("output")!.textContent).toBe("draft");
  expect(window.location.pathname).toBe("/");
});

async function renderThreadList() {
  const requests: PromiseWithResolvers<{ data: SessionSummary[]; nextCursor?: string }>[] = [];
  const rpcRef = {
    current: {
      request: () => {
        const pending = Promise.withResolvers<{ data: SessionSummary[]; nextCursor?: string }>();
        requests.push(pending);
        return pending.promise;
      },
    } as unknown as WebRpcClient,
  };
  const activeThreadIdRef = { current: null };
  let manager: ReturnType<typeof useThreadManager>;
  function Screen() {
    const [state, dispatch] = useReducer(appReducer, { ...initialThreadState, threadList: [latest] });
    manager = useThreadManager({
      rpcRef,
      dispatch,
      activeThreadIdRef,
      applySessionModel: asyncNoop,
      resetDraftModel: noop,
      setEffortState: noop,
      setFastModeState: noop,
      activateThreadPrompts: noop,
      shelveThreadPrompts: noop,
      clearAttention: noop,
      closeModals: noop,
    });
    return createElement(
      "div",
      null,
      createElement("output", null, state.threadList.map((thread) => thread.id).join(",")),
      createElement("span", { role: "status" }, manager.isLoadingThreads ? "loading" : "ready"),
      manager.threadListError ? createElement("span", { role: "alert" }, manager.threadListError) : null,
    );
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => root.render(createElement(Screen)));
  return { container, requests, refresh: () => manager.refreshThreadList() };
}

test("a stale list response cannot overwrite a newer refresh", async () => {
  const { container, requests, refresh } = await renderThreadList();
  let first: Promise<unknown>;
  let second: Promise<unknown>;
  await act(async () => {
    first = refresh();
    second = refresh();
  });
  expect(container.querySelector('[role="status"]')!.textContent).toBe("loading");
  await act(async () => {
    requests[1].resolve({ data: [{ ...latest, id: "newer" }] });
    await second;
  });
  expect(container.querySelector("output")!.textContent).toBe("newer");
  await act(async () => {
    requests[0].resolve({ data: [latest] });
    await first;
  });
  expect(container.querySelector("output")!.textContent).toBe("newer");
  expect(container.querySelector('[role="status"]')!.textContent).toBe("ready");
});

test("a failed refresh keeps the previous list and exposes a local error", async () => {
  const { container, requests, refresh } = await renderThreadList();
  let pending: Promise<unknown>;
  await act(async () => {
    pending = refresh();
  });
  await act(async () => {
    requests[0].reject(new Error("Storage unavailable"));
    await pending;
  });
  expect(container.querySelector("output")!.textContent).toBe(latest.id);
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(container.querySelector('[role="status"]')!.textContent).toBe("ready");
});

test("recent and earlier history are visible before a deferred runtime resume completes", async () => {
  const { container, preparing, manager, requests } = await renderBootstrap("/selected", false, true);
  expect(container.querySelector("section")!.textContent).toBe("Recent conversation");
  expect(container.querySelector('[role="status"]')!.textContent).toBe("preparing");
  expect(requests.some((request) => request.method === "thread/read")).toBe(false);
  await act(async () => manager().loadEarlierHistory());
  expect(container.querySelector("section")!.textContent).toBe("Older conversation,Recent conversation");
  await act(async () => preparing.resolve({ found: true, threadId: "selected" }));
  expect(container.querySelector('[role="status"]')!.textContent).toBe("ready");
  expect(requests.find((request) => request.method === "thread/read")?.params).toEqual({
    threadId: "selected",
    includeItems: false,
  });
});

test("preparation completing after New cannot overwrite the new draft", async () => {
  const { container, preparing, manager } = await renderBootstrap("/selected", false, true);
  await act(async () => manager().startNewThread());
  await act(async () => preparing.resolve({ found: true, threadId: "selected" }));
  expect(container.querySelector("output")!.textContent).toBe("draft");
  expect(container.querySelector("section")!.textContent).toBe("");
});

test("history failures remain visible rather than leaving an empty loading state", async () => {
  const { container, reading } = await renderBootstrap("/selected", true);
  await act(async () => reading.reject(new Error("History unavailable")));
  expect(container.querySelector('[role="alert"]')!.textContent).toContain("History unavailable");
  expect(container.querySelector('[role="status"]')!.textContent).toBe("not ready");
});

test("list batches are visible before the final page, including empty discovery batches", async () => {
  const { container, requests, refresh } = await renderThreadList();
  let pending: Promise<unknown>;
  await act(async () => {
    pending = refresh();
  });
  await act(async () => requests[0].resolve({ data: [{ ...latest, messageCount: undefined }], nextCursor: "two" }));
  expect(container.querySelector("output")!.textContent).toBe("latest");
  expect(container.querySelector('[role="status"]')!.textContent).toBe("loading");
  await act(async () => requests[1].resolve({ data: [], nextCursor: "three" }));
  expect(container.querySelector("output")!.textContent).toBe("latest");
  await act(async () => {
    requests[2].resolve({ data: [{ ...latest, id: "newest", modified: "2026-02-01T00:00:00.000Z" }] });
    await pending;
  });
  expect(container.querySelector("output")!.textContent).toBe("newest,latest");
});
