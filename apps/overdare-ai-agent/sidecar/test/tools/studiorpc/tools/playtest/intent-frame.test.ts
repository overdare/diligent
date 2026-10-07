import { describe, expect, test } from "bun:test";
import { parsePlaytestFrame } from "../../../../../src/tools/studiorpc/tools/playtest/frame";

function legacyAction(id: string) {
  return {
    id,
    description: `Step ${id}`,
    events: [{ type: "wait", durationMs: 50 }],
  };
}

function intentAction(id: string, intentId: string, completeWhen: unknown[] | Record<string, unknown> = []) {
  return {
    ...legacyAction(id),
    intent: {
      id: intentId,
      description: `Goal ${intentId}`,
      validityKey: "round-2:delivery",
      completeWhen,
    },
  };
}

function frame(actions: unknown[]) {
  return {
    protocolVersion: 1,
    harnessId: "intent-test",
    revision: 1,
    gameTimeSeconds: 3,
    state: { inventory: 2 },
    actions,
  };
}

describe("playtest intent frame contract", () => {
  test("decodes intent metadata and normalizes Luau numeric-key completion arrays in numeric order", () => {
    const action = intentAction("physical-step", "deliver-current-load", {
      "2": { key: "inventory.count", op: "equals", value: 0 },
      "1": { key: "delivery.revision", op: "increase" },
    });
    const parsed = parsePlaytestFrame(JSON.stringify(frame([action])));

    expect(parsed.actions[0]?.id).toBe("physical-step");
    expect(parsed.actions[0]?.intent).toEqual({
      id: "deliver-current-load",
      description: "Goal deliver-current-load",
      validityKey: "round-2:delivery",
      completeWhen: [
        { key: "delivery.revision", op: "increase" },
        { key: "inventory.count", op: "equals", value: 0 },
      ],
    });
  });

  test("rejects duplicate intent IDs in one frame", () => {
    expect(() =>
      parsePlaytestFrame(
        JSON.stringify(
          frame([
            intentAction("north-step", "visit-room-a", [{ key: "roomId", op: "equals", value: "A" }]),
            intentAction("north-step-2", "visit-room-a", [{ key: "roomId", op: "equals", value: "A" }]),
          ]),
        ),
      ),
    ).toThrow(/duplicate intent id/i);
  });

  test("rejects a frame that mixes intent-tagged and legacy actions", () => {
    expect(() =>
      parsePlaytestFrame(
        JSON.stringify(
          frame([
            intentAction("west-step", "deliver", [{ key: "deposit.revision", op: "increase" }]),
            legacyAction("wait"),
          ]),
        ),
      ),
    ).toThrow(/mix|all actions/i);
  });

  test("requires at least one completion criterion for an intent", () => {
    expect(() => parsePlaytestFrame(JSON.stringify(frame([intentAction("step", "goal-empty", [])])))).toThrow(
      /completeWhen|at least 1/i,
    );
  });

  test("allows an empty action frame and legacy-only actions", () => {
    expect(parsePlaytestFrame(JSON.stringify(frame([]))).actions).toEqual([]);
    expect(parsePlaytestFrame(JSON.stringify(frame([legacyAction("observe")]))).actions[0]?.intent).toBeUndefined();
  });

  test("rejects a non-record decisionState projection", () => {
    expect(() => parsePlaytestFrame(JSON.stringify({ ...frame([]), decisionState: ["not", "a", "record"] }))).toThrow(
      /Invalid playtest frame: decisionState/i,
    );
  });
});
