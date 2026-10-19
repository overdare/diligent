// @summary Frame contract tolerance for Luau numbers and actor maps, check limits and oversize diagnostics.
import { describe, expect, test } from "bun:test";
import {
  MAX_FRAME_JSON_BYTES,
  parseMultiplayerActors,
  parsePlaytestFrame,
} from "../../../../../src/tools/studiorpc/tools/playtest/frame";

function baseFrame(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: 1,
    harnessId: "sample",
    revision: 1,
    gameTimeSeconds: 1,
    state: {},
    actions: [],
    ...overrides,
  };
}

function actor(actorId: string, x: number, actions: unknown[] = []) {
  return {
    actorId,
    userId: `user-${actorId}`,
    position: { x, y: 0, z: 0 },
    state: {},
    decisionState: {},
    actions,
    progress: { sequence: 0 },
  };
}

describe("playtest frame tolerance and limits", () => {
  test("fractional input durations computed in Luau are rounded instead of failing the run", () => {
    const parsed = parsePlaytestFrame(
      baseFrame({
        actions: [
          {
            id: "approach",
            description: "Walk toward the target",
            events: [
              { type: "key", key: "W", action: "press", durationMs: 1234.6 },
              { type: "look", yawDegrees: 30, timeoutMs: 450.2 },
            ],
          },
        ],
      }),
    );
    expect(parsed.actions[0]!.events).toEqual([
      { type: "key", key: "W", action: "press", durationMs: 1235 },
      { type: "look", yawDegrees: 30, timeoutMs: 450 },
    ]);
  });

  test("two-player actors may be keyed by actorId but not by unrelated keys", () => {
    const step = {
      id: "step",
      description: "Step",
      events: [{ type: "key", key: "D", action: "press", durationMs: 99.5 }],
    };
    const keyed = parsePlaytestFrame(
      baseFrame({
        state: { multiplayerActors: { Player1: actor("Player1", 5), Player0: actor("Player0", 0, [step]) } },
      }),
    );
    const actors = parseMultiplayerActors(keyed);
    expect(actors.map((entry) => entry.actorId)).toEqual(["Player0", "Player1"]);
    expect(actors[0]!.actions[0]!.events[0]).toMatchObject({ durationMs: 100 });

    expect(() =>
      parsePlaytestFrame(
        baseFrame({ state: { multiplayerActors: { red: actor("Player0", 0), blue: actor("Player1", 5) } } }),
      ),
    ).toThrow(/non-array key/);
  });

  test("checks reject duplicate ids and verdict details that are really histories", () => {
    expect(() =>
      parsePlaytestFrame(
        baseFrame({
          checks: [
            { id: "cp01", basis: "requirement", status: "pending" },
            { id: "cp01", basis: "requirement", status: "pass" },
          ],
        }),
      ),
    ).toThrow(/duplicate check id cp01/);
    expect(() =>
      parsePlaytestFrame(
        baseFrame({
          checks: [
            {
              id: "cp02",
              basis: "requirement",
              status: "pass",
              detail: { samples: Array.from({ length: 600 }, (_, i) => i * 1.5) },
            },
          ],
        }),
      ),
    ).toThrow(/check detail must be at most/);
  });

  test("an oversized frame names its largest sections", () => {
    const huge = "x".repeat(MAX_FRAME_JSON_BYTES);
    expect(() => parsePlaytestFrame(JSON.stringify(baseFrame({ state: { proofs: huge, phase: "carry" } })))).toThrow(
      /largest sections: state\.proofs=\d+/,
    );
  });
});
