// @summary Tests for InputDock Enter-key action selection and shift+tab mode cycling

import { expect, test } from "bun:test";
import { getComposerEnterAction, shouldCycleModeOnKey } from "../../../../src/web/client/components/InputDock";

test("does not send on Enter when composer cannot send", () => {
  expect(
    getComposerEnterAction({
      hasBlockingPrompt: false,
      isBusy: false,
      canSend: false,
      canSteer: false,
      isUploadingImages: false,
      hasProvider: true,
    }),
  ).toBe("none");
});

test("does not steer on Enter when steering is unavailable", () => {
  expect(
    getComposerEnterAction({
      hasBlockingPrompt: false,
      isBusy: true,
      canSend: false,
      canSteer: false,
      isUploadingImages: false,
      hasProvider: true,
    }),
  ).toBe("none");
});

test("blocks Enter while prompt UI is pending", () => {
  expect(
    getComposerEnterAction({
      hasBlockingPrompt: true,
      isBusy: false,
      canSend: true,
      canSteer: true,
      isUploadingImages: false,
      hasProvider: true,
    }),
  ).toBe("none");
});

test("allows Enter only when the matching action is available", () => {
  expect(
    getComposerEnterAction({
      hasBlockingPrompt: false,
      isBusy: false,
      canSend: true,
      canSteer: false,
      isUploadingImages: false,
      hasProvider: true,
    }),
  ).toBe("send");

  expect(
    getComposerEnterAction({
      hasBlockingPrompt: false,
      isBusy: true,
      canSend: false,
      canSteer: true,
      isUploadingImages: false,
      hasProvider: true,
    }),
  ).toBe("steer");
});

test("shift+tab cycles the mode", () => {
  expect(shouldCycleModeOnKey({ key: "Tab", shiftKey: true, hasBlockingPrompt: false })).toBe(true);
});

test("plain Tab is left to the slash menu and focus traversal", () => {
  expect(shouldCycleModeOnKey({ key: "Tab", shiftKey: false, hasBlockingPrompt: false })).toBe(false);
});

test("other shifted keys are not mode switches", () => {
  expect(shouldCycleModeOnKey({ key: "Enter", shiftKey: true, hasBlockingPrompt: false })).toBe(false);
});

// A blocking prompt owns the keyboard, so Tab must still reach the approval controls.
test("shift+tab does not cycle while a blocking prompt is open", () => {
  expect(shouldCycleModeOnKey({ key: "Tab", shiftKey: true, hasBlockingPrompt: true })).toBe(false);
});
