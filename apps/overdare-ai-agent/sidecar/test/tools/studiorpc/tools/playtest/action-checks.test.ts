// @summary Action validity compares guard meaning while permitting updated descriptions and physical steps.
import { expect, test } from "bun:test";
import { actionStillValid } from "../../../../../src/tools/studiorpc/tools/playtest/action-checks";
import {
  type PlaytestAction,
  type PlaytestFrame,
  parsePlaytestFrame,
} from "../../../../../src/tools/studiorpc/tools/playtest/frame";

function frame(action: Partial<PlaytestAction> = {}): PlaytestFrame {
  return parsePlaytestFrame({
    protocolVersion: 1,
    harnessId: "sample",
    revision: 1,
    gameTimeSeconds: 10,
    state: {},
    actions: [
      {
        id: "approach",
        description: "Approach the drawer",
        validityKey: "step-v1",
        events: [{ type: "wait", durationMs: 10 }],
        intent: {
          id: "inspect",
          description: "Inspect the drawer",
          validityKey: "drawer-v1",
          completeWhen: [{ key: "opened", op: "equals", value: true }],
        },
        ...action,
      },
    ],
  });
}

const before = frame();
const intent = before.actions[0].intent!;

test("an intent remains valid across physical steps and description changes", () => {
  const after = frame({
    id: "open",
    validityKey: "step-v2",
    description: "Open now",
    intent: {
      ...intent,
      description: "Updated description",
      completeWhen: [{ value: true, op: "equals", key: "opened" }],
    },
  });
  expect(actionStillValid(before, after, "inspect", true)).toBe(true);
});

test.each([
  { ...intent, validityKey: "different-drawer" },
  { ...intent, completeWhen: [{ key: "opened", op: "equals" as const, value: false }] },
])("changing intent guard meaning invalidates a pending choice: %j", (changed) => {
  expect(actionStillValid(before, frame({ intent: changed }), "inspect", true)).toBe(false);
});

test("switching action kinds or losing an intent cannot preserve a choice", () => {
  const legacy = frame({ intent: undefined });
  expect(actionStillValid(before, legacy, "approach")).toBe(false);
  expect(actionStillValid(legacy, before, "approach")).toBe(false);
  expect(actionStillValid(before, legacy, "inspect", true)).toBe(false);
  expect(actionStillValid(legacy, legacy, "approach", true)).toBe(false);
});

test("legacy action guards are checked independently of event or description updates", () => {
  const legacy = frame({ intent: undefined });
  expect(actionStillValid(legacy, frame({ intent: undefined, description: "Updated" }), "approach")).toBe(true);
  expect(actionStillValid(legacy, frame({ intent: undefined, validityKey: "expired" }), "approach")).toBe(false);
});

test("an unchanged guard cannot authorize an expired, missing or terminal action", () => {
  expect(actionStillValid(before, frame({ expiresAtGameTime: 10 }), "inspect", true)).toBe(false);
  expect(actionStillValid(before, frame({ expiresAtGameTime: 10.1 }), "inspect", true)).toBe(true);
  expect(actionStillValid(before, { ...before, actions: [] }, "inspect", true)).toBe(false);
  expect(actionStillValid(before, { ...before, terminal: { outcome: "success" } }, "inspect", true)).toBe(false);
});
