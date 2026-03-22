// @summary Tests for web thread manager helpers that manage draft composer input entries

import { expect, test } from "bun:test";
import { clearDraftThreadInput, DRAFT_INPUT_KEY } from "../../../src/client/lib/use-thread-manager";

test("clearDraftThreadInput removes only the draft composer entry", () => {
  const next = clearDraftThreadInput({
    [DRAFT_INPUT_KEY]: "stale draft",
    "thread-1": "keep this",
  });

  expect(next).toEqual({
    "thread-1": "keep this",
  });
});

test("clearDraftThreadInput returns same object when no draft entry exists", () => {
  const original = { "thread-1": "keep this" };
  const next = clearDraftThreadInput(original);

  expect(next).toBe(original);
});
