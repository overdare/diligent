// @summary Two real-client bindings, independent provider choices, retained macros and owned cleanup.
import { describe, expect, test } from "bun:test";
import { createDecisionProvider } from "../../../../../src/tools/studiorpc/tools/playtest/decision-provider";
import {
  type PlaytestFrame,
  parseMultiplayerActors,
  parsePlaytestFrame,
  projectActorFrame,
} from "../../../../../src/tools/studiorpc/tools/playtest/frame";
import {
  invokeServerPlaytest,
  invokeServerTool,
} from "../../../../../src/tools/studiorpc/tools/playtest/invoke-server";
import { bindActors } from "../../../../../src/tools/studiorpc/tools/playtest/multiplayer";
import { type PlaytestEvent, runPlaytest } from "../../../../../src/tools/studiorpc/tools/playtest/runtime";
import { runParams } from "../../../../../src/tools/studiorpc/tools/playtest/tool-shared";

class Clock {
  time = 0;
  now() {
    return this.time;
  }
  async sleep(ms: number, signal?: AbortSignal) {
    signal?.throwIfAborted();
    this.time += ms;
    await new Promise((resolve) => setTimeout(resolve, 1));
    signal?.throwIfAborted();
  }
}
function fixture(
  options: {
    ambiguous?: boolean;
    native?: boolean;
    replacement?: boolean;
    singleton?: boolean;
    readyDelay?: boolean;
    peerNoProgress?: boolean;
    rootOnly?: boolean;
  } = {},
) {
  const clock = new Clock();
  const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const events: PlaytestEvent[] = [];
  let running = false;
  let session = "owned-2";
  let revision = 0;
  const receipts = [0, 0];
  const validity = ["initial", "initial"];
  const clients = [
    { clientId: "real-peer", injectable: true, targeted: false, ...(options.native ? { userId: "user-1" } : {}) },
    { clientId: "real-main", injectable: true, targeted: true, ...(options.native ? { userId: "user-0" } : {}) },
  ];
  const status = () => ({ running, pieSessionId: running ? session : undefined, clients: running ? clients : [] });
  const snapshot = (): PlaytestFrame => ({
    protocolVersion: 1,
    harnessId: "two-actors",
    revision,
    gameTimeSeconds: revision / 10,
    ready: !options.readyDelay || revision > 2,
    state: {
      receipts: 99999,
      mainOnlySecret: "not-peer-state",
      ...(!options.readyDelay || revision > 2
        ? {
            multiplayerActors: [0, 1].map((i) => ({
              actorId: `Player${i}`,
              userId: `user-${i}`,
              position: { x: options.ambiguous ? 0 : i * 1000, y: 84, z: 0 },
              state: {
                receipts: receipts[i],
                owner: `user-${i}`,
                carriedUnit: `exact-unit-${i}`,
                cameraYaw: i * 90,
                units: "cm",
              },
              decisionState: { self: `Player${i}`, receipts: receipts[i], cameraYaw: i * 90, units: "cm" },
              progress: { sequence: options.peerNoProgress && i === 1 ? 0 : receipts[i] },
              ...(receipts[i] >= 2 && !options.rootOnly
                ? { terminal: { outcome: "success", reason: `Player${i} own receipts complete` } }
                : {}),
              actions:
                receipts[i] >= 2
                  ? []
                  : ["target-a", "target-b"].slice(0, options.singleton ? 1 : 2).map((id) => ({
                      id: receipts[i] === 0 ? "approach-" + id : "attack-" + id,
                      description: `Current physical step for ${id}`,
                      coverageKey: "receipt",
                      validityKey: validity[i],
                      intent: {
                        id,
                        description: `Approach and attack ${id}`,
                        validityKey: validity[i],
                        completeWhen: [{ key: "receipts", op: "equals", value: 2 }],
                      },
                      events:
                        receipts[i] === 0
                          ? [
                              { type: "key", key: i === 0 ? "W" : "D", action: "down" },
                              { type: "wait", durationMs: 50 },
                              { type: "key", key: i === 0 ? "W" : "D", action: "up" },
                            ]
                          : [
                              {
                                type: "pointerButton",
                                button: "left",
                                action: "press",
                                position: { x: 0.886, y: 0.8 },
                                durationMs: 30,
                              },
                            ],
                      expectations: [
                        { key: "receipts", op: "increase" },
                        { key: "owner", op: "equals", value: `user-${i}` },
                      ],
                    })),
            })),
          }
        : {}),
    },
    coverage: {
      targets: [{ id: "receipt", kind: "action", description: "Actor-local receipt and unchanged ownership" }],
    },
    actions: [],
    ...(options.rootOnly && receipts.every((n) => n >= 2)
      ? { terminal: { outcome: "success", reason: "authoritative combatDrop + transfer + gateBlock" } as const }
      : {}),
  });
  const rpc = async (method: string, params?: Record<string, unknown>, rpcOptions?: { signal?: AbortSignal }) => {
    rpcOptions?.signal?.throwIfAborted();
    calls.push({ method, params });
    if (method === "game.pie.status") return status();
    if (method === "game.play") {
      expect(params?.numberOfPlayer).toBe(2);
      running = true;
      return {};
    }
    if (method === "game.stop") {
      running = false;
      return {};
    }
    if (method === "game.character.read") {
      expect(params?.pieSessionId).toBe("owned-2");
      const i = params?.clientId === "real-main" ? 0 : 1;
      return {
        clientId: params?.clientId,
        character: { CFrame: { Position: { X: options.native ? 90000 : i * 1000, Y: 84, Z: 0 } } },
      };
    }
    if (method === "game.observe") {
      expect(params?.clientId).toBeUndefined();
      revision++;
      return {
        character: { data: { clientId: "real-main", mainOnlySecret: "never-in-peer" } },
        instances: {
          data: { instances: [{ name: "SharedFrame", Value: { Type: "String", String: JSON.stringify(snapshot()) } }] },
        },
      };
    }
    if (method === "game.input.inject") {
      expect(params?.pieSessionId).toBe("owned-2");
      const i = params?.clientId === "real-main" ? 0 : params?.clientId === "real-peer" ? 1 : -1;
      expect(i).not.toBe(-1);
      if (!(options.peerNoProgress && i === 1)) receipts[i]++;
      if (options.replacement) session = "replacement-not-owned";
      return { status: "completed" };
    }
    throw new Error(method);
  };
  const runOptions = {
    callRpc: rpc as never,
    clock,
    numberOfPlayer: 2 as const,
    goal: "shared goal",
    actorGoals: { Player0: "purchase then defend", Player1: "steal then lock" },
    harnessId: "two-actors",
    frameName: "SharedFrame",
    maxDurationMs: 40000,
    startupTimeoutMs: 5000,
    stuckTimeoutMs: 0,
    intentDecisionIntervalMs: 30000,
    onEvent: (event: PlaytestEvent) => events.push(event),
  };
  return { clock, calls, events, receipts, validity, snapshot, status, runOptions, rpc };
}

describe("multi-client playtest", () => {
  test("long dual episodes and explicit bounded batches validate without changing single-player limits", async () => {
    const args = {
      harnessName: "two-actors",
      goal: "test",
      numberOfPlayer: 2 as const,
      maxDurationMs: 900000,
      maxPhysicalBatchDurationMs: 5000,
    };
    expect(runParams.safeParse(args).success).toBe(true);
    expect(runParams.safeParse({ ...args, maxDurationMs: 900001 }).success).toBe(false);
    expect(runParams.safeParse({ ...args, maxPhysicalBatchDurationMs: 5001 }).success).toBe(false);
    expect(runParams.safeParse({ ...args, maxPhysicalBatchDurationMs: 4999.5 }).success).toBe(false);
    expect(runParams.safeParse({ ...args, numberOfPlayer: 1 }).success).toBe(false);
    const f = fixture();
    const result = await runPlaytest({
      ...f.runOptions,
      maxDurationMs: 900000,
      maxPhysicalBatchDurationMs: 5000,
      choose: async () => ({ actionId: "target-a" }),
    });
    expect(result.outcome).toBe("success");
    const rejected = fixture();
    await expect(
      runPlaytest({ ...rejected.runOptions, maxDurationMs: 900001, choose: async () => ({ actionId: "target-a" }) }),
    ).rejects.toThrow("maxDurationMs");
    await expect(
      runPlaytest({
        ...rejected.runOptions,
        numberOfPlayer: 1,
        maxDurationMs: 180001,
        choose: async () => ({ actionId: "target-a" }),
      }),
    ).rejects.toThrow("maxDurationMs");
    expect(rejected.calls).toHaveLength(0);
  });

  test("4500ms balanced movement is opt-in; default 2000ms remains enforced with owned cleanup", async () => {
    for (const allowed of [false, true]) {
      const f = fixture();
      const result = await runPlaytest({
        ...f.runOptions,
        ...(allowed ? { maxPhysicalBatchDurationMs: 5000 } : {}),
        choose: async () => ({ actionId: "target-a" }),
        callRpc: (async (method, params, rpcOptions) => {
          const reply = (await f.rpc(method, params, rpcOptions)) as {
            instances: { data: { instances: Array<{ Value: { String: string } }> } };
          };
          if (method === "game.observe") {
            const value = reply.instances.data.instances[0].Value;
            const frame = JSON.parse(value.String);
            for (const actor of frame.state.multiplayerActors)
              for (const action of actor.actions)
                for (const event of action.events) if (event.type === "wait") event.durationMs = 4500;
            value.String = JSON.stringify(frame);
          }
          return reply;
        }) as never,
      });
      expect(result.outcome).toBe(allowed ? "success" : "error");
      if (!allowed) expect(result.reason).toContain("exceeds 2000 ms");
      expect(result.cleanup?.stopped).toBe(true);
      expect(f.calls.filter((c) => c.method === "game.stop")).toHaveLength(1);
      if (allowed) expect(result.concurrencyEvidence?.inputCallsMaxInFlight).toBeGreaterThan(0);
    }
  });

  test("two provider calls AND two client-specific native RPC calls are in flight, not alternating", async () => {
    const f = fixture();
    const modelActors = new Set<string>();
    const inputClients = new Set<string>();
    let releaseModels!: () => void;
    let releaseInputs!: () => void;
    const modelsBothStarted = new Promise<void>((resolve) => {
      releaseModels = resolve;
    });
    const inputsBothStarted = new Promise<void>((resolve) => {
      releaseInputs = resolve;
    });
    let inputsInFlight = 0;
    let maxInputsInFlight = 0;
    const result = await runPlaytest({
      ...f.runOptions,
      choose: async (frame, candidates, signal, context) => {
        expect(candidates).toHaveLength(2);
        expect(frame.decisionState?.self).toBe(context?.actorId);
        expect(context?.recentActions).toBeUndefined();
        modelActors.add(context!.actorId!);
        if (modelActors.size === 2) releaseModels();
        await modelsBothStarted;
        signal.throwIfAborted();
        return { actionId: "target-a" };
      },
      callRpc: (async (method, params, rpcOptions) => {
        if (method !== "game.input.inject") return f.rpc(method, params, rpcOptions);
        inputsInFlight++;
        maxInputsInFlight = Math.max(maxInputsInFlight, inputsInFlight);
        inputClients.add(String(params?.clientId));
        if (inputClients.size === 2) releaseInputs();
        await inputsBothStarted;
        try {
          return await f.rpc(method, params, rpcOptions);
        } finally {
          inputsInFlight--;
        }
      }) as never,
    });
    expect(result.outcome).toBe("success");
    expect([...modelActors].sort()).toEqual(["Player0", "Player1"]);
    expect([...inputClients].sort()).toEqual(["real-main", "real-peer"]);
    expect(maxInputsInFlight).toBe(2);
    expect(result.concurrencyEvidence).toMatchObject({
      executionMode: "concurrent",
      modelRequestsMaxInFlight: 2,
      inputCallsMaxInFlight: 2,
      nativeInputOverlapPairs: null,
      nativeExecutionTiming: "not_reported_by_transport",
    });
    expect(result.concurrencyEvidence!.physicalRpcOverlapPairs).toBeGreaterThan(0);
    for (const timing of result.concurrencyEvidence!.inputTimings) {
      expect(timing.callEndedAtMs).toBeGreaterThanOrEqual(timing.callStartedAtMs);
      expect(timing.executionReplyObservedAtMs).toBe(timing.callEndedAtMs);
      expect(timing.nativeInputStartedAtMs).toBeNull();
      expect(timing.nativeInputEndedAtMs).toBeNull();
    }
    expect(f.events.filter((e) => e.type === "input_start")).toHaveLength(4);
    expect(f.events.filter((e) => e.type === "input_end")).toHaveLength(4);
    expect(inputsInFlight).toBe(0);
    expect(f.calls.filter((c) => c.method === "game.stop")).toHaveLength(1);
  });

  test("one chooser failure cancels and settles the other chooser before same-session cleanup", async () => {
    const f = fixture();
    let release!: () => void;
    const both = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requests = 0;
    let pending = 0;
    let peerCancelled = false;
    const result = await runPlaytest({
      ...f.runOptions,
      choose: async (_frame, _actions, signal, context) => {
        pending++;
        if (++requests === 2) release();
        try {
          await both;
          if (context?.actorId === "Player0") throw new Error("P0 provider failure");
          await new Promise<void>((_resolve, reject) => {
            const abort = () => {
              peerCancelled = true;
              reject(signal.reason);
            };
            if (signal.aborted) abort();
            else signal.addEventListener("abort", abort, { once: true });
          });
          return { actionId: "target-a" };
        } finally {
          pending--;
        }
      },
      callRpc: (async (method, params, opts) => {
        if (method === "game.stop") expect(pending).toBe(0);
        return f.rpc(method, params, opts);
      }) as never,
    });
    expect(result.outcome).toBe("error");
    expect(result.reason).toContain("P0 provider failure");
    expect(peerCancelled).toBe(true);
    expect(result.stats.dispatchedActions).toBe(0);
    expect(result.cleanup.stopped).toBe(true);
  });

  test("one native input cancellation cancels peer input and joins both before stopping", async () => {
    const f = fixture();
    let release!: () => void;
    const both = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = 0;
    let pending = 0;
    let cancelled = false;
    const result = await runPlaytest({
      ...f.runOptions,
      choose: async () => ({ actionId: "target-a" }),
      callRpc: (async (method, params, opts) => {
        if (method === "game.stop") expect(pending).toBe(0);
        if (method !== "game.input.inject") return f.rpc(method, params, opts);
        pending++;
        if (++started === 2) release();
        try {
          await both;
          if (params?.clientId === "real-main") return { status: "cancelled" };
          await new Promise<void>((_resolve, reject) => {
            const abort = () => {
              cancelled = true;
              reject(opts!.signal!.reason);
            };
            if (opts!.signal!.aborted) abort();
            else opts!.signal!.addEventListener("abort", abort, { once: true });
          });
          return { status: "completed" };
        } finally {
          pending--;
        }
      }) as never,
    });
    expect(result.outcome).toBe("input_cancelled");
    expect(cancelled).toBe(true);
    expect(result.cleanup.stopped).toBe(true);
    expect(result.concurrencyEvidence!.inputTimings).toHaveLength(2);
  });

  test("root ready=false without actors withholds BOTH stale model choices and resumes fresh", async () => {
    const f = fixture();
    let ready = true;
    let gapStarted = false;
    let unhealthyObservations = 0;
    let invalidated = 0;
    let modelStarts = 0;
    const result = await runPlaytest({
      ...f.runOptions,
      onEvent: (event) => {
        f.events.push(event);
        if (event.type === "choice_invalidated" && ++invalidated === 2) ready = true;
      },
      choose: async (_frame, _actions, signal) => {
        modelStarts++;
        if (!gapStarted) {
          gapStarted = true;
          ready = false;
        }
        // Make sure the observer publishes an unhealthy root frame before either choice resolves.
        while (unhealthyObservations < 1) await f.clock.sleep(10, signal);
        return { actionId: "target-a" };
      },
      callRpc: (async (method, params, opts) => {
        if (method === "game.input.inject") expect(ready).toBe(true);
        const reply = await f.rpc(method, params, opts);
        if (method === "game.observe" && !ready) {
          const observation = reply as { instances: { data: { instances: Array<{ Value: { String: string } }> } } };
          const value = observation.instances.data.instances[0].Value;
          const frame = JSON.parse(value.String);
          frame.ready = false;
          delete frame.state.multiplayerActors;
          value.String = JSON.stringify(frame);
          unhealthyObservations++;
        }
        return reply;
      }) as never,
    });
    expect(result.outcome).toBe("success");
    expect(invalidated).toBe(2);
    expect(modelStarts).toBe(4);
    expect(result.stats.observationErrors).toBe(0);
    expect(result.cleanup.stopped).toBe(true);
  });

  test("actor-local histories stay bounded across repeated concurrent model choices", async () => {
    const f = fixture();
    const choices = [0, 0];
    const contexts: Array<{ actorId?: string; recentActions?: Array<{ actionId: string; result: string }> }> = [];
    const result = await runPlaytest({
      ...f.runOptions,
      choose: async (frame, _actions, _signal, context) => {
        const i = context!.actorId === "Player0" ? 0 : 1;
        choices[i]++;
        contexts.push(structuredClone(context!));
        expect(context?.recentActions?.length ?? 0).toBeLessThanOrEqual(3);
        expect(context?.recentActions?.every((a) => a.actionId.startsWith(context.actorId!)) ?? true).toBe(true);
        return { actionId: frame.actions[0].id };
      },
      callRpc: (async (method, params, opts) => {
        // Keep the fixture active until each actor has exercised five local histories.
        if (method === "game.input.inject") {
          const i = params?.clientId === "real-main" ? 0 : 1;
          const reply = await f.rpc(method, params, opts);
          if (choices[i] < 5) f.receipts[i] = 0;
          return reply;
        }
        const reply = await f.rpc(method, params, opts);
        if (method === "game.observe") {
          const observation = reply as { instances: { data: { instances: Array<{ Value: { String: string } }> } } };
          const value = observation.instances.data.instances[0].Value;
          const frame = JSON.parse(value.String);
          for (const actor of frame.state.multiplayerActors) {
            for (const action of actor.actions) {
              delete action.intent;
              action.id = `${actor.actorId}-${action.id}`;
            }
          }
          value.String = JSON.stringify(frame);
        }
        return reply;
      }) as never,
    });
    expect(result.outcome).toBe("success");
    expect(choices.every((n) => n >= 5)).toBe(true);
    expect(contexts.filter((c) => c.recentActions?.length === 3).length).toBeGreaterThanOrEqual(2);
  });

  test("two-player runner never takes over a session already running", async () => {
    const f = fixture();
    const result = await runPlaytest({
      ...f.runOptions,
      choose: async () => {
        throw new Error("must not choose");
      },
      callRpc: (async (method) => {
        f.calls.push({ method });
        return { running: true, pieSessionId: "user-session" };
      }) as never,
    });
    expect(result.outcome).toBe("error");
    expect(result.reason).toContain("will not take over");
    expect(f.calls.map((c) => c.method)).toEqual(["game.pie.status"]);
    expect(result.cleanup.ownedSession).toBe(false);
  });

  test("binds shuffled real client IDs by initial positions, prefers native userId and rejects ambiguity", () => {
    for (const native of [false, true]) {
      const f = fixture({ native });
      const actors = parseMultiplayerActors(parsePlaytestFrame(f.snapshot()));
      const reads = new Map([
        ["real-main", { character: { CFrame: { Position: { X: native ? 9999 : 0, Y: 84, Z: 0 } } } }],
        ["real-peer", { character: { CFrame: { Position: { X: native ? 9999 : 1000, Y: 84, Z: 0 } } } }],
      ]);
      const clients = [
        { clientId: "real-peer", injectable: true, ...(native ? { userId: "user-1" } : {}) },
        { clientId: "real-main", injectable: true, ...(native ? { userId: "user-0" } : {}) },
      ];
      expect(bindActors(actors, { clients }, reads)).toEqual([
        {
          actorId: "Player0",
          userId: "user-0",
          clientId: "real-main",
          source: native ? "native_user_id" : "initial_position",
        },
        {
          actorId: "Player1",
          userId: "user-1",
          clientId: "real-peer",
          source: native ? "native_user_id" : "initial_position",
        },
      ]);
      if (!native) {
        actors[1].position.x = 0;
        expect(() => bindActors(actors, { clients }, reads)).toThrow("Ambiguous");
      }
    }
  });

  test("both actors really request model choices, retain macros, dispatch to correct clients and confirm local receipts", async () => {
    const f = fixture({ readyDelay: true });
    const requests: Array<{ goal: string; game: { self: string }; controller: { actorId: string } }> = [];
    const provider = await createDecisionProvider(
      { provider: "openai-decisions", goal: "shared goal" },
      {
        resolveApiKey: async () => "test-secret-not-output",
        fetch: async (url, init) => {
          expect(url).toBe("https://api.openai.com/v1/decisions");
          const body = JSON.parse(String(init.body));
          requests.push(JSON.parse(body.input[0].content[0].text));
          expect(body.questions[0].choices).toHaveLength(2);
          return Response.json({ answers: [{ name: "action", type: "choice", choice: "target-a" }] });
        },
      },
    );
    const result = await runPlaytest({ ...f.runOptions, choose: provider.choose });
    expect(result.outcome).toBe("success");
    expect(requests.map((r) => [r.controller.actorId, r.game.self, r.goal]).sort()).toEqual([
      ["Player0", "Player0", "purchase then defend"],
      ["Player1", "Player1", "steal then lock"],
    ]);
    expect(result.stats.modelCalls).toBe(2);
    const inputs = f.calls.filter((c) => c.method === "game.input.inject");
    const mainInputs = inputs.filter((c) => c.params?.clientId === "real-main");
    const peerInputs = inputs.filter((c) => c.params?.clientId === "real-peer");
    expect(mainInputs).toHaveLength(2);
    expect(peerInputs).toHaveLength(2);
    expect(mainInputs[0].params?.events).toEqual(
      expect.arrayContaining([
        { type: "key", key: "W", action: "down" },
        { type: "key", key: "W", action: "up" },
      ]),
    );
    expect(peerInputs[0].params?.events).toEqual(
      expect.arrayContaining([
        { type: "key", key: "D", action: "down" },
        { type: "key", key: "D", action: "up" },
      ]),
    );
    expect(mainInputs[1].params?.events).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "pointerMove", position: { x: 0.886, y: 0.8 } })]),
    );
    for (const id of ["Player0", "Player1"]) {
      expect(result.perActorEvidence?.[id].decisionEvidence).toMatchObject({
        status: "effects_observed",
        modelRequests: 1,
        modelChoices: 1,
        modelDispatches: 1,
        modelEffectsConfirmed: 1,
        automaticDispatches: 0,
      });
      expect(result.perActorEvidence?.[id].coverage).toMatchObject({ status: "complete", coveredTargets: 1 });
      expect(result.perActorEvidence?.[id].observationSource).toBe(
        "main_shared_authoritative_harness_actor_projection",
      );
    }
    expect(
      f.events
        .filter((e) => e.type === "action_result")
        .every((e) => (e.expectations as Array<{ passed: boolean }>).every((check) => check.passed)),
    ).toBe(true);
    expect(f.calls.filter((c) => c.method === "game.stop")).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("test-secret-not-output");
    expect(JSON.stringify(requests)).not.toContain("mainOnlySecret");
  });

  test("stale actor choice is discarded while peer runs independently with isolated history", async () => {
    const f = fixture();
    const contexts: Array<{ actorId?: string; recentActions?: unknown[] }> = [];
    let stale = true;
    const result = await runPlaytest({
      ...f.runOptions,
      choose: async (_frame, _actions, signal, context) => {
        contexts.push(structuredClone(context!));
        if (context?.actorId === "Player0" && stale) {
          stale = false;
          f.validity[0] = "changed-by-server";
          await f.clock.sleep(50, signal);
          await f.clock.sleep(50, signal);
        }
        return { actionId: "target-a" };
      },
    });
    expect(result.outcome).toBe("success");
    expect(result.stats.invalidatedChoices).toBeGreaterThan(0);
    expect(contexts.filter((c) => c.actorId === "Player0")).toHaveLength(2);
    expect(contexts.filter((c) => c.actorId === "Player1")).toHaveLength(1);
    expect(contexts.filter((c) => c.actorId === "Player0")[1].recentActions).toBeUndefined();
    expect(f.calls.filter((c) => c.method === "game.input.inject")[0].params?.clientId).toBe("real-peer");
  });

  test("mapping failure cleans up the same owned session without input", async () => {
    const f = fixture({ ambiguous: true });
    const result = await runPlaytest({ ...f.runOptions, choose: async () => ({ actionId: "target-a" }) });
    expect(result.outcome).toBe("error");
    expect(result.reason).toContain("Ambiguous");
    expect(f.calls.filter((c) => c.method === "game.input.inject")).toHaveLength(0);
    expect(f.calls.filter((c) => c.method === "game.stop")).toHaveLength(1);
  });

  test("parent's authoritative shared terminal ends the episode without fabricating actor terminals", async () => {
    const f = fixture({ rootOnly: true });
    const result = await runPlaytest({ ...f.runOptions, choose: async () => ({ actionId: "target-a" }) });
    expect(result.outcome).toBe("success");
    expect(result.reason).toContain("combatDrop");
    expect(result.perActorEvidence?.Player0.terminal).toBeUndefined();
    expect(result.perActorEvidence?.Player1.terminal).toBeUndefined();
    expect(result.perActorEvidence?.Player1.decisionEvidence.modelRequests).toBe(1);
  });

  test("replacement session is never stopped", async () => {
    const f = fixture({ replacement: true });
    const result = await runPlaytest({ ...f.runOptions, choose: async () => ({ actionId: "target-a" }) });
    expect(result.outcome).toBe("session_changed");
    expect(result.cleanup.stopped).toBe(false);
    expect(f.calls.filter((c) => c.method === "game.stop")).toHaveLength(0);
  });

  test("unselected singleton cannot become a scripted opponent", async () => {
    const f = fixture({ singleton: true });
    let choices = 0;
    const result = await runPlaytest({
      ...f.runOptions,
      maxDurationMs: 1500,
      choose: async () => {
        choices++;
        return { actionId: "target-a" };
      },
    });
    expect(result.outcome).toBe("timeout");
    expect(choices).toBe(0);
    expect(result.stats.dispatchedActions).toBe(0);
  });

  test("peer watchdog does not inherit main progress", async () => {
    const f = fixture({ peerNoProgress: true });
    const result = await runPlaytest({
      ...f.runOptions,
      stuckTimeoutMs: 1800,
      choose: async () => ({ actionId: "target-a" }),
    });
    expect(result.outcome).toBe("stuck");
    expect(f.events.find((e) => e.type === "stuck")?.actorId).toBe("Player1");
  });

  test("actor projection rejects main-targeted controls and normalizes nested Luau action arrays", () => {
    const f = fixture();
    const raw = f.snapshot();
    const actors = raw.state.multiplayerActors as Array<{ actions: unknown; state: Record<string, unknown> }>;
    const action = (actors[0].actions as Array<Record<string, unknown>>)[0];
    action.events = [{ type: "pointerButton", button: "left", action: "press", target: "AttackButton" }];
    expect(() => parsePlaytestFrame(raw)).toThrow("main-targeted");
    action.events = { "1": { type: "key", key: "E", action: "press" } };
    actors[0].actions = { "1": action };
    const projected = projectActorFrame(parsePlaytestFrame(raw), "Player0");
    expect(projected.actions[0].events).toEqual([{ type: "key", key: "E", action: "press" }]);
    expect(projected.state.receipts).toBe(0);
    expect(projected.state.mainOnlySecret).toBeUndefined();
  });

  test("multi duration extends only multi and rejects visual peer fiction", () => {
    expect(
      runParams.parse({ harnessName: "test", goal: "goal", numberOfPlayer: 2, maxDurationMs: 360000 }).numberOfPlayer,
    ).toBe(2);
    expect(() => runParams.parse({ harnessName: "test", goal: "goal", maxDurationMs: 180001 })).toThrow(
      "Single-player",
    );
    expect(() =>
      runParams.parse({ harnessName: "test", goal: "goal", numberOfPlayer: 2, observationMode: "structured+image" }),
    ).toThrow("main-targeted");
  });

  test("raw invocation uses existing sidecar provider route without shell key or provider override; old backend blocks before POST", async () => {
    for (const current of [true, false]) {
      const requests: Array<{ url: string; method?: string; body?: unknown }> = [];
      const promise = invokeServerPlaytest({
        serverUrl: "http://127.0.0.1:12345",
        sidecarToken: "authorized-router-token",
        approved: true,
        args: { harnessName: "test", goal: "goal", numberOfPlayer: 2 },
        fetch: (async (url, init) => {
          requests.push({
            url: String(url),
            method: init?.method,
            body: init?.body ? JSON.parse(String(init.body)) : undefined,
          });
          if (String(url).endsWith("/catalog"))
            return Response.json({
              tools: [
                { name: "studiorpc_game_playtest", inputSchema: { properties: current ? { numberOfPlayer: {} } : {} } },
              ],
            });
          return Response.json({ content: [{ type: "text", text: "owned run result" }] });
        }) as typeof fetch,
      });
      if (current) {
        await promise;
        expect(requests[1]).toMatchObject({
          url: "http://127.0.0.1:12345/mcp-router/tools/call",
          method: "POST",
          body: { tool: "studiorpc_game_playtest", args: { numberOfPlayer: 2 } },
        });
        expect((requests[1].body as { args: Record<string, unknown> }).args.decisionProvider).toBeUndefined();
      } else {
        await expect(promise).rejects.toThrow("old playtest implementation");
        expect(requests).toHaveLength(1);
      }
    }
  });

  test("parent can submit inline harness Source updates through the server route", async () => {
    const source = "return {}\n" + "-- parent-owned source\n".repeat(700);
    const result = await invokeServerTool({
      serverUrl: "http://127.0.0.1:12345",
      sidecarToken: "router-token",
      approved: true,
      tool: "studiorpc_game_playtest_harness",
      args: {
        operation: "update",
        name: "two-actors",
        expectedSourceHash: "c38a9d75a85bdf4a12f248eba78c2c36cad18af129a1116f27f0d376f239680c",
        source,
      },
      fetch: (async (url, init) => {
        if (String(url).endsWith("/catalog"))
          return Response.json({ tools: [{ name: "studiorpc_game_playtest_harness" }] });
        const payload = JSON.parse(String(init?.body));
        expect(payload.args.source).toBe(source);
        expect(payload.tool).toBe("studiorpc_game_playtest_harness");
        return Response.json({ updated: true });
      }) as typeof fetch,
    });
    expect(result).toEqual({ updated: true });
  });
});
