// @summary Regression coverage for interrupted steering restoration and draft merging
import { expect, test } from "bun:test";
import { appReducer } from "../../../../src/web/client/lib/app-state";
import {
  DRAFT_INPUT_KEY,
  EMPTY_COMPOSER_DRAFT,
  restoreInterruptedSteers,
} from "../../../../src/web/client/lib/composer-state";
import { initialThreadState } from "../../../../src/web/client/lib/thread-store";

test("interruption restores only unconsumed steers in event order", () => {
  let state = {
    ...initialThreadState,
    activeThreadId: "t1",
    pendingSteers: [
      { id: "a", content: "consumed" },
      { id: "b", content: "waiting" },
    ],
  };
  const event = {
    type: "steering_injected" as const,
    messageCount: 1,
    steerIds: ["a"],
    messages: [{ role: "user" as const, content: "consumed", timestamp: 1 }],
  };
  state = appReducer(state, {
    type: "notification",
    payload: {
      notification: { method: "agent/event", params: { threadId: "t1", turnId: "turn1", event } },
      events: [event],
    },
  });
  state = appReducer(state, {
    type: "notification",
    payload: { notification: { method: "turn/interrupted", params: { threadId: "t1", turnId: "turn1" } }, events: [] },
  });
  expect(state.pendingSteers).toEqual([]);
  expect(state.composerDrafts.t1.text).toBe("waiting");
});

test("restoration merges all text, contexts, and images before existing composer input", () => {
  const image = { type: "local_image" as const, path: "reference.png", mediaType: "image/png" as const };
  const merged = restoreInterruptedSteers(EMPTY_COMPOSER_DRAFT, [
    {
      id: "a",
      content: "<AttachedContext>\n- Instance: Name=Part; ClassType=Part; GUID=guid-1\n</AttachedContext>\nfirst",
      attachments: [image],
    },
    { id: "b", content: "second", attachments: [image] },
  ]);
  expect(merged.text).toBe("first\n\nsecond");
  expect(merged.contextItems).toHaveLength(1);
  expect(merged.images.map(({ webUrl, ...attachment }) => attachment)).toEqual([image, image]);
});

test("interrupt without pending input does not schedule composer restoration", () => {
  const initial = { ...initialThreadState, activeThreadId: "t1" };
  const next = appReducer(initial, {
    type: "notification",
    payload: { notification: { method: "turn/interrupted", params: { threadId: "t1", turnId: "turn1" } }, events: [] },
  });
  expect(next.composerDrafts).toBe(initial.composerDrafts);
});

test("interrupted notification atomically restores the composer and clears the pending queue", () => {
  const original = {
    ...initialThreadState,
    activeThreadId: "t1",
    pendingSteers: [{ id: "s1", content: "guidance" }],
    composerDrafts: { t1: { text: "draft", contextItems: [], images: [] } },
  };
  const action = {
    type: "notification" as const,
    payload: {
      notification: { method: "turn/interrupted" as const, params: { threadId: "t1", turnId: "turn1" } },
      events: [],
    },
  };
  const next = appReducer(original, action);
  expect(next.pendingSteers).toEqual([]);
  expect(next.composerDrafts.t1.text).toBe("guidance\n\ndraft");
  expect(original.composerDrafts.t1.text).toBe("draft");
  expect(appReducer(original, action)).toEqual(next);
  expect(appReducer(next, action).composerDrafts).toBe(next.composerDrafts);
});

test("clearing draft text preserves saved thread drafts and draft attachments", () => {
  const image = { type: "local_image" as const, path: "a.png", mediaType: "image/png" as const, webUrl: "a.png" };
  const original = {
    ...initialThreadState,
    composerDrafts: {
      [DRAFT_INPUT_KEY]: { ...EMPTY_COMPOSER_DRAFT, text: "draft", images: [image] },
      t1: { ...EMPTY_COMPOSER_DRAFT, text: "saved" },
    },
  };
  const next = appReducer(original, { type: "composer_text", payload: { threadId: DRAFT_INPUT_KEY, text: "" } });
  expect(next.composerDrafts[DRAFT_INPUT_KEY].text).toBe("");
  expect(next.composerDrafts[DRAFT_INPUT_KEY].images).toEqual([image]);
  expect(next.composerDrafts.t1).toBe(original.composerDrafts.t1);
});

test("composer selections accumulate and deduplicate while retaining text, images and other threads", () => {
  const item = (GUID: string) => ({
    kind: "instance" as const,
    source: "studiorpc" as const,
    Name: GUID,
    ClassType: "Part",
    GUID,
  });
  const original = {
    ...initialThreadState,
    composerDrafts: {
      t1: { ...EMPTY_COMPOSER_DRAFT, text: "draft", contextItems: [item("a")] },
      t2: { ...EMPTY_COMPOSER_DRAFT, text: "other" },
    },
  };
  let state = appReducer(original, {
    type: "composer_context",
    payload: { threadId: "t1", items: [item("b"), item("c")] },
  });
  state = appReducer(state, { type: "composer_context", payload: { threadId: "t1", items: [item("b")] } });
  expect(state.composerDrafts.t1.contextItems.map((value) => value.Name)).toEqual(["a", "b", "c"]);
  expect(state.composerDrafts.t1.text).toBe("draft");
  expect(state.composerDrafts.t2).toBe(original.composerDrafts.t2);
  state = appReducer(state, { type: "composer_context", payload: { threadId: "t1", items: [] } });
  expect(state.composerDrafts.t1.contextItems).toEqual([]);
});

test("image updaters see prior composer actions in the same batch", () => {
  const first = { type: "local_image" as const, path: "a.png", mediaType: "image/png" as const, webUrl: "a.png" };
  const second = { ...first, path: "b.png", webUrl: "b.png" };
  const initial = appReducer(initialThreadState, {
    type: "composer_images",
    payload: { threadId: "t1", images: [first] },
  });
  const next = appReducer(initial, {
    type: "composer_images",
    payload: { threadId: "t1", images: (previous) => [...previous, second] },
  });
  expect(next.composerDrafts.t1.images).toEqual([first, second]);
  expect(initial.composerDrafts.t1.images).toEqual([first]);
});

test("new thread reset preserves composer drafts", () => {
  const state = appReducer(initialThreadState, {
    type: "composer_text",
    payload: { threadId: "t1", text: "saved draft" },
  });
  expect(appReducer(state, { type: "reset_draft", payload: { mode: "default" } }).composerDrafts).toBe(
    state.composerDrafts,
  );
});

test("context removal affects only the selected item and unchanged text is a no-op", () => {
  const item = (GUID: string) => ({
    kind: "instance" as const,
    source: "studiorpc" as const,
    Name: GUID,
    ClassType: "Part",
    GUID,
  });
  const initial = appReducer(initialThreadState, {
    type: "composer_context",
    payload: { threadId: "t1", items: [item("a"), item("b")] },
  });
  const next = appReducer(initial, {
    type: "composer_remove_context",
    payload: { threadId: "t1", itemKey: "instance:a" },
  });
  expect(next.composerDrafts.t1.contextItems.map((value) => value.Name)).toEqual(["b"]);
  expect(appReducer(next, { type: "composer_text", payload: { threadId: "t1", text: "" } })).toBe(next);
  expect(
    appReducer(initialThreadState, { type: "composer_context", payload: { threadId: "missing", items: [] } }),
  ).toBe(initialThreadState);
});
