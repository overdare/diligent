// @summary Test-goal coverage requires declared targets and actual observed action effects.
import { expect, test } from "bun:test";
import { createCoverageTracker } from "../../../../../src/tools/studiorpc/tools/playtest/coverage";
import { parsePlaytestFrame } from "../../../../../src/tools/studiorpc/tools/playtest/frame";

const frame = (extra: Record<string, unknown> = {}) =>
  parsePlaytestFrame({
    protocolVersion: 1,
    harnessId: "sample",
    revision: 1,
    gameTimeSeconds: 1,
    state: {},
    actions: [],
    ...extra,
  });

test("a successful game without a declared test inventory does not imply coverage", () => {
  const c = createCoverageTracker();
  c.observe(frame());
  c.event({ type: "terminal", atMs: 1, outcome: "success" });
  expect(c.summary()).toMatchObject({ status: "not_declared", totalTargets: 0, coveredTargets: 0 });
  expect(c.summary().percentage).toBeUndefined();
});

test("availability, choice, input completion and confirmed effect remain separate", () => {
  const c = createCoverageTracker();
  c.observe(
    frame({
      coverage: {
        targets: [
          { id: "jump", kind: "action", description: "Jump raises the player" },
          { id: "landing", kind: "state", description: "Player lands" },
        ],
      },
      actions: [
        {
          id: "a1",
          coverageKey: "jump",
          description: "Jump",
          events: [{ type: "key", key: "Space", action: "press" }],
        },
      ],
    }),
  );
  c.event({ type: "model_choice", atMs: 1, coverageKey: "jump" });
  c.event({ type: "action_dispatch", atMs: 2, coverageKey: "jump" });
  c.event({ type: "input_reply", atMs: 3, coverageKey: "jump", status: "completed" });
  expect(c.summary()).toMatchObject({ coveredTargets: 0, status: "partial" });
  expect(c.summary().targets[0]).toMatchObject({
    offeredFrames: 1,
    selected: 1,
    dispatched: 1,
    completed: 1,
    status: "completed_unverified",
  });
  c.event({
    type: "action_result",
    atMs: 4,
    coverageKey: "jump",
    observed: true,
    inputStatus: "completed",
    expectations: [{ passed: false }],
  });
  expect(c.summary().coveredTargets).toBe(0);
  c.event({
    type: "action_result",
    atMs: 5,
    coverageKey: "jump",
    observed: true,
    inputStatus: "completed",
    expectations: [{ passed: true }],
  });
  c.observe(
    frame({
      coverage: {
        targets: [
          { id: "jump", kind: "action", description: "Jump raises the player" },
          { id: "landing", kind: "state", description: "Player lands" },
        ],
        observed: ["landing"],
      },
    }),
  );
  expect(c.summary()).toMatchObject({ status: "complete", coveredTargets: 2, totalTargets: 2, percentage: 100 });
  expect(c.summary().targets[0]).toMatchObject({ effectsConfirmed: 1, effectsFailed: 1 });
});

test("an action without an effect assertion is not credited by input alone", () => {
  const c = createCoverageTracker();
  c.observe(frame({ coverage: { targets: [{ id: "fire", kind: "action", description: "Fire hits target" }] } }));
  c.event({
    type: "action_result",
    atMs: 2,
    coverageKey: "fire",
    observed: true,
    inputStatus: "completed",
    expectations: [],
  });
  expect(c.summary().coveredTargets).toBe(0);
});

test("unknown targets and action hits reported as mere observations are rejected", () => {
  const c = createCoverageTracker();
  expect(() =>
    c.observe(
      frame({ coverage: { targets: [{ id: "jump", kind: "action", description: "Jump" }], observed: ["jump"] } }),
    ),
  ).toThrow(/action.*effect/i);
  expect(() => c.observe(frame({ coverage: { targets: [], observed: ["invented"] } }))).toThrow(/undeclared/i);
});

test("numeric Luau coverage arrays are decoded and changing a target meaning is rejected", () => {
  const c = createCoverageTracker();
  c.observe(
    frame({
      coverage: {
        targets: { "1": { id: "phase.playing", kind: "state", description: "Playing" } },
        observed: { "1": "phase.playing" },
      },
    }),
  );
  expect(c.summary().coveredTargets).toBe(1);
  expect(() =>
    c.observe(frame({ coverage: { targets: [{ id: "phase.playing", kind: "event", description: "Playing" }] } })),
  ).toThrow(/changed/i);
});
