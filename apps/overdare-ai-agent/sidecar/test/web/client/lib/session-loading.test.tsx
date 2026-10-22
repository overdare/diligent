// @summary Regressions for usable startup and user navigation while session history is loading
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register({ url: "http://localhost/" });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { afterAll, afterEach, expect, test } from "bun:test";
import type { SessionSummary, ThreadReadResponse } from "@diligent/protocol";
import { act, createElement, useCallback, useReducer, useState } from "react";
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

async function renderBootstrap(path = "/", delayedRead = false) {
  window.history.replaceState(null, "", path);
  const listing = Promise.withResolvers<SessionSummary[]>();
  const reading = Promise.withResolvers<ThreadReadResponse>();
  const activeThreadIdRef = { current: null as string | null };
  const rpcRef = {
    current: {
      initialize: async () => ({ cwd: "/project", capabilities: { goals: true } }),
      notify: noop,
      request: async (method: string, params: { threadId?: string }) => {
        if (method === "thread/resume") {
          if (!params.threadId) await listing.promise;
          return { found: true, threadId: params.threadId ?? latest.id };
        }
        if (method === "thread/read") return delayedRead ? reading.promise : history;
        throw new Error(`Unexpected request: ${method}`);
      },
    } as unknown as WebRpcClient,
  };
  const refreshThreadList = (() => listing.promise) as Parameters<typeof useAppBootstrap>[0]["refreshThreadList"];
  function Screen() {
    const [state, dispatch] = useReducer(appReducer, initialThreadState);
    const [providersReady, setProvidersReady] = useState(false);
    activeThreadIdRef.current = state.activeThreadId;
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
      setInitialModel: noop,
      applySessionModel: asyncNoop,
      refreshThreadList,
      refreshProviders,
    });
    return createElement(
      "div",
      null,
      createElement("textarea", { disabled: !providersReady, "aria-label": "Message" }),
      createElement("output", null, state.activeThreadId ?? "draft"),
      createElement(
        "button",
        { type: "button", onClick: () => dispatch({ type: "reset_draft", payload: { mode: "default" } }) },
        "New conversation",
      ),
    );
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => root.render(createElement(Screen)));
  return { container, listing, reading };
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

test("a late history read cannot replace a new draft", async () => {
  const { container, listing, reading } = await renderBootstrap("/selected", true);
  await act(async () => {
    const button = container.querySelector("button")!;
    button.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    button.click();
    window.history.replaceState(null, "", "/");
  });
  await act(async () => {
    reading.resolve(history);
    listing.resolve([latest]);
  });
  expect(container.querySelector("output")!.textContent).toBe("draft");
  expect(window.location.pathname).toBe("/");
});

async function renderThreadList() {
  const requests: Array<ReturnType<typeof Promise.withResolvers<{ data: SessionSummary[] }>>> = [];
  const rpcRef = {
    current: {
      request: () => {
        const pending = Promise.withResolvers<{ data: SessionSummary[] }>();
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
