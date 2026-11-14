// @summary Tests for SessionStateStore committed and pending visibility behavior

import { describe, expect, test } from "bun:test";
import type { SessionEntry } from "@diligent/runtime/session";
import { SessionStateStore } from "@diligent/runtime/session";

function makeMessageEntry(id: string, parentId: string | null, content: string): SessionEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: new Date().toISOString(),
    message: {
      role: "user",
      content,
      timestamp: Date.now(),
    },
  };
}

describe("SessionStateStore", () => {
  test("exposes committed state and path entries", () => {
    const store = new SessionStateStore();
    const root = makeMessageEntry("a1", null, "hello");
    const child = makeMessageEntry("a2", "a1", "next");

    store.appendCommitted([root, child]);

    expect(store.getCommittedLeafId()).toBe("a2");
    expect(store.getCommittedEntries()).toHaveLength(2);
    expect(store.getPathEntries().map((entry) => entry.id)).toEqual(["a1", "a2"]);
  });

  test("pending entries affect visible state without mutating committed state", () => {
    const store = new SessionStateStore();
    const root = makeMessageEntry("a1", null, "hello");
    const pending = makeMessageEntry("a2", "a1", "draft");

    store.appendCommitted([root]);
    store.setPending([pending], pending.id);

    expect(store.getCommittedEntries()).toHaveLength(1);
    expect(store.getVisibleState().entries.map((entry) => entry.id)).toEqual(["a1", "a2"]);
    expect(store.entryCount).toBe(2);

    store.clearPending();
    expect(store.getVisibleState().entries.map((entry) => entry.id)).toEqual(["a1"]);
    expect(store.entryCount).toBe(1);
  });
});
