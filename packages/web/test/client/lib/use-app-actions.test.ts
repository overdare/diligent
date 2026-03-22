// @summary Tests for web app action helpers that decide which composer input state to clear on send

import { expect, mock, test } from "bun:test";
import { clearComposerInputAfterSend } from "../../../src/client/lib/use-app-actions";

test("clearComposerInputAfterSend clears draft input when sending first message from new conversation", () => {
  const clearThreadInput = mock(() => {});
  const clearDraftInput = mock(() => {});

  clearComposerInputAfterSend({
    activeThreadId: null,
    clearThreadInput,
    clearDraftInput,
  });

  expect(clearDraftInput).toHaveBeenCalledTimes(1);
  expect(clearThreadInput).not.toHaveBeenCalled();
});

test("clearComposerInputAfterSend clears active thread input for existing conversations", () => {
  const clearThreadInput = mock(() => {});
  const clearDraftInput = mock(() => {});

  clearComposerInputAfterSend({
    activeThreadId: "thread-1",
    clearThreadInput,
    clearDraftInput,
  });

  expect(clearThreadInput).toHaveBeenCalledWith("thread-1");
  expect(clearDraftInput).not.toHaveBeenCalled();
});
