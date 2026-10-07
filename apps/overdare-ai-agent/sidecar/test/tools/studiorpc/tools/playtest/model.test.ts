// @summary Verifies native Laya payloads and fail-closed decisions without asserting model quality.
import { expect, test } from "bun:test";
import { createLayaChooser } from "../../../../../src/tools/studiorpc/tools/playtest/model";

test("native choice requests contain the actual candidate catalog and reject unavailable answers", async () => {
  let sent: Record<string, unknown> | undefined;
  const chooser = createLayaChooser({
    url: "http://localhost:11436/api/decide",
    model: "synthetic",
    goal: "play",
    fetch: async (_url, init) => {
      sent = JSON.parse(String(init?.body));
      return Response.json({ answers: { action: { choice: "missing" } } });
    },
  });
  await expect(
    chooser.choose(
      { state: { ammo: 3 } } as never,
      [
        { id: "fire", description: "Fire" },
        { id: "reload", description: "Reload" },
      ] as never,
      new AbortController().signal,
    ),
  ).rejects.toThrow(/unavailable/);
  expect(sent?.model).toBe("synthetic");
  expect(sent?.state).toEqual({ goal: "play", game: { ammo: 3 } });
  expect(sent?.questions).toEqual({
    action: { type: "choice", instructions: expect.any(String), criteria: { fire: "Fire", reload: "Reload" } },
  });
  expect(sent?.state).not.toHaveProperty("controller");
});

test("uses strategic intent IDs and keeps active intent context separate from game facts", async () => {
  let sent: Record<string, unknown> | undefined;
  const chooser = createLayaChooser({
    url: "http://localhost:11436/api/decide",
    model: "synthetic",
    goal: "deliver current cargo",
    fetch: async (_url, init) => {
      sent = JSON.parse(String(init?.body));
      return Response.json({ answers: { action: { choice: "deliver-current-load" } } });
    },
  });
  const frame = { state: { inventory: { count: 2 }, consoleDistance: 7 } } as never;
  const candidates = [
    { id: "deliver-current-load", description: "Return west and deposit the two carried items." },
    { id: "collect-room-a-first", description: "Visit the safe known room and add one visible item before deposit." },
  ];
  const context = {
    activeIntent: { id: "deliver-current-load", elapsedMs: 1_250 },
    recentActions: [{ actionId: "move-forward", result: "effect_unconfirmed" as const }],
  };

  const choice = await chooser.choose(frame, candidates, new AbortController().signal, context);

  expect(choice.actionId).toBe("deliver-current-load");
  expect(sent?.state).toEqual({
    goal: "deliver current cargo",
    game: { inventory: { count: 2 }, consoleDistance: 7 },
    controller: context,
  });
  expect(sent?.questions).toEqual({
    action: {
      type: "choice",
      instructions: expect.any(String),
      criteria: {
        "deliver-current-load": "Return west and deposit the two carried items.",
        "collect-room-a-first": "Visit the safe known room and add one visible item before deposit.",
      },
    },
  });
});

test("sends decisionState as the model view without mutating verification state", async () => {
  let sent: Record<string, unknown> | undefined;
  const chooser = createLayaChooser({
    url: "http://localhost:11436/api/decide",
    model: "synthetic",
    goal: "deliver current cargo",
    fetch: async (_url, init) => {
      sent = JSON.parse(String(init?.body));
      return Response.json({ answers: { action: { choice: "deliver-current-load" } } });
    },
  });
  const verificationState = {
    inventoryCount: 2,
    serverSnapshotRevision: 410,
    rawFeedbackArchive: Array.from({ length: 100 }, (_, index) => `event-${index}`),
  };
  const frame = {
    state: verificationState,
    decisionState: { carried: 2, capacity: 5, distanceToConsole: 7 },
  } as never;
  const choice = await chooser.choose(
    frame,
    [{ id: "deliver-current-load", description: "Walk to the console and deposit two items." }],
    new AbortController().signal,
  );

  expect(choice.actionId).toBe("deliver-current-load");
  expect(sent?.state).toEqual({
    goal: "deliver current cargo",
    game: { carried: 2, capacity: 5, distanceToConsole: 7 },
  });
  expect(frame.state).toEqual({
    inventoryCount: 2,
    serverSnapshotRevision: 410,
    rawFeedbackArchive: Array.from({ length: 100 }, (_, index) => `event-${index}`),
  });
});

test("a truncated state never produces a dispatchable choice", async () => {
  const chooser = createLayaChooser({
    url: "http://localhost/api/decide",
    model: "synthetic",
    goal: "play",
    fetch: async () => Response.json({ state_truncated: true, answers: { action: { choice: "fire" } } }),
  });
  await expect(
    chooser.choose(
      { state: {} } as never,
      [
        { id: "fire", description: "Fire" },
        { id: "wait", description: "Wait" },
      ] as never,
      new AbortController().signal,
    ),
  ).rejects.toThrow(/truncat/i);
});

test("warming loads the model without fabricated game state", async () => {
  let body: unknown;
  const chooser = createLayaChooser({
    url: "http://localhost/api/decide",
    model: "synthetic",
    goal: "play",
    fetch: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json({ done_reason: "load" });
    },
  });
  await chooser.warm(new AbortController().signal);
  expect(body).toEqual({ model: "synthetic", keep_alive: -1 });
});
