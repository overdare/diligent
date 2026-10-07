import { describe, expect, test } from "bun:test";
import { StudioRpcError } from "../../../../../src/tools/studiorpc/rpc";
import { createCoverageTracker } from "../../../../../src/tools/studiorpc/tools/playtest/coverage";
import {
  type PlaytestEvent,
  type PlaytestFrame,
  parsePlaytestFrame,
  runPlaytest,
} from "../../../../../src/tools/studiorpc/tools/playtest/runtime";
import type { PlaytestVisual } from "../../../../../src/tools/studiorpc/tools/playtest/visual-observation";

class TestClock {
  private current = 0;
  now(): number {
    return this.current;
  }
  advance(ms: number): void {
    this.current += ms;
  }
  async sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
    this.current += ms;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 1);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );
    });
  }
}

function frame(overrides: Partial<PlaytestFrame> = {}): PlaytestFrame {
  return {
    protocolVersion: 1,
    harnessId: "raid-demo-v1",
    revision: 1,
    gameTimeSeconds: 10,
    state: { phase: "EXPOSED", ammo: 3, bossHp: 100 },
    actions: [
      {
        id: "fire_core",
        description: "Fire once at the exposed core.",
        coverageKey: "core-shot",
        validityKey: "round-4-exposed",
        events: [{ type: "key", key: "F", action: "press", durationMs: 80 }],
        expectations: [{ key: "bossHp", op: "decrease" }],
      },
      {
        id: "wait",
        description: "Wait for the next phase.",
        events: [{ type: "wait", durationMs: 80 }],
      },
    ],
    events: [{ id: "phase-exposed-4", level: "info", message: "Core exposed" }],
    ...overrides,
  };
}

function observePayload(clientId: string, snapshot: PlaytestFrame, frameName: string) {
  return {
    character: { data: { clientId } },
    instances: {
      data: {
        instances: [
          {
            name: frameName,
            path: `Workspace.${frameName}`,
            class: "StringValue",
            Value: { Type: "String", String: JSON.stringify(snapshot) },
          },
        ],
      },
    },
  };
}

function unavailableObservePayload() {
  return {
    outcome: "partial",
    failedSections: ["character", "instances"],
    character: { status: "error", error: "There is no play test to read a character from." },
    instances: { status: "error", error: "The requested play-test client state is not available." },
  };
}

type FakeCall = { method: string; params?: Record<string, unknown>; signal?: AbortSignal };

function createRpc(
  options: {
    initiallyRunning?: boolean;
    inputStatus?: string;
    replaceSessionOnStatus?: number;
    observeLatencyMs?: number;
    onInput?: (signal?: AbortSignal) => void | Promise<void>;
    beforeInputFrame?: (observeCount: number) => PlaytestFrame;
    afterInputFrame?: () => PlaytestFrame;
    observePayload?: (observeCount: number, snapshot: PlaytestFrame, frameName: string) => unknown;
  } = {},
) {
  const calls: FakeCall[] = [];
  const clock = new TestClock();
  let running = options.initiallyRunning ?? false;
  let session = "pie-owned";
  let statusCount = 0;
  let observeCount = 0;
  let frameState = frame();
  let injected = false;
  const callRpc = async (method: string, params?: Record<string, unknown>, rpcOptions?: { signal?: AbortSignal }) => {
    calls.push({ method, params, signal: rpcOptions?.signal });
    if (rpcOptions?.signal?.aborted) throw rpcOptions.signal.reason ?? new DOMException("Aborted", "AbortError");
    if (method === "game.pie.status") {
      statusCount += 1;
      if (options.replaceSessionOnStatus === statusCount) session = "pie-replacement";
      return {
        running,
        pieSessionId: running ? session : undefined,
        clients: running ? [{ clientId: "client-1", injectable: true, targeted: true }] : [],
      };
    }
    if (method === "game.play") {
      running = true;
      return { started: true };
    }
    if (method === "game.stop") {
      running = false;
      return { stopped: true };
    }
    if (method === "game.observe") {
      if (options.observeLatencyMs) clock.advance(options.observeLatencyMs);
      observeCount += 1;
      frameState = injected
        ? (options.afterInputFrame?.() ??
          frame({
            revision: 50 + observeCount,
            gameTimeSeconds: 20 + observeCount,
            state: { phase: "VICTORY", ammo: 2, bossHp: 70 },
            actions: [],
            terminal: { outcome: "success", reason: "Boss defeated" },
          }))
        : (options.beforeInputFrame?.(observeCount) ??
          frame({ revision: observeCount, gameTimeSeconds: 10 + observeCount }));
      const instanceParams = params?.instances as { targets?: unknown } | undefined;
      const frameName = Array.isArray(instanceParams?.targets)
        ? String(instanceParams.targets[0] ?? "__PlaytestFrame")
        : "__PlaytestFrame";
      return (
        options.observePayload?.(observeCount, frameState, frameName) ??
        observePayload("client-1", frameState, frameName)
      );
    }
    if (method === "game.input.inject") {
      injected = true;
      await options.onInput?.(rpcOptions?.signal);
      return { status: options.inputStatus ?? "completed", looks: [] };
    }
    throw new Error(`Unexpected RPC ${method}`);
  };
  return { calls, callRpc, clock, getObserveCount: () => observeCount };
}

function optionsFor(f: ReturnType<typeof createRpc>, overrides: Record<string, unknown> = {}) {
  return {
    callRpc: f.callRpc as never,
    choose: async (_current: PlaytestFrame, _actions: PlaytestFrame["actions"], _signal: AbortSignal) => ({
      actionId: "fire_core",
      diagnostics: { confidence: 0.9 },
      latencyMs: 5,
    }),
    clock: f.clock,
    harnessId: "raid-demo-v1",
    frameName: "__PlaytestFrame",
    maxDurationMs: 15_000,
    startupTimeoutMs: 3_000,
    onEvent: (_event: PlaytestEvent) => {},
    ...overrides,
  } as never;
}

describe("playtest frame contract", () => {
  test("rejects mismatched protocol, too many actions, and unbalanced input", () => {
    expect(() => parsePlaytestFrame(JSON.stringify(frame({ protocolVersion: 2 })))).toThrow(/protocolVersion/);
    expect(() =>
      parsePlaytestFrame(
        JSON.stringify(
          frame({
            actions: Array.from({ length: 17 }, (_, i) => ({
              id: `a${i}`,
              description: "too many",
              events: [{ type: "wait", durationMs: 1 }],
            })),
          }),
        ),
      ),
    ).toThrow(/16/);
    expect(() =>
      parsePlaytestFrame(
        JSON.stringify(
          frame({
            actions: [
              {
                id: "bad",
                description: "held key",
                events: [{ type: "key", key: "F", action: "down" }],
              },
            ],
          }),
        ),
      ),
    ).toThrow(/released|held/);
  });

  test("normalizes known Luau numeric-key arrays in numeric order without rewriting state maps", () => {
    const actions = Array.from({ length: 10 }, (_, index) => ({
      id: `action-${index + 1}`,
      description: `action ${index + 1}`,
      events: { "1": { type: "wait", durationMs: 1 } },
      expectations: {},
    }));
    const lexicalKeys = ["1", "10", "2", "3", "4", "5", "6", "7", "8", "9"];
    const actionsObject = `{${lexicalKeys.map((key) => `${JSON.stringify(key)}:${JSON.stringify(actions[Number(key) - 1])}`).join(",")}}`;
    const frameObject = frame({ actions: [], events: [], state: { values: { "10": "ten", "2": "two" } } });
    const payload = JSON.stringify(frameObject)
      .replace('"actions":[]', `"actions":${actionsObject}`)
      .replace('"events":[]', '"events":{}');

    const parsed = parsePlaytestFrame(payload);

    expect(parsed.actions.map((action) => action.id)).toEqual(
      Array.from({ length: 10 }, (_, index) => `action-${index + 1}`),
    );
    expect(parsed.actions[0].events).toEqual([{ type: "wait", durationMs: 1 }]);
    expect(parsed.actions[0].expectations).toEqual([]);
    expect(parsed.events).toEqual([]);
    expect(parsed.state.values).toEqual({ "10": "ten", "2": "two" });
  });

  test("rejects nonnumeric maps in protocol array fields", () => {
    const payload = JSON.stringify(frame({ actions: [] })).replace('"actions":[]', '"actions":{"shoot":{}}');
    expect(() => parsePlaytestFrame(payload)).toThrow(/non-array key/);
  });

  test("accepts exactly 16 actions", () => {
    const actions = Array.from({ length: 16 }, (_, index) => ({
      id: `action-${index + 1}`,
      description: `action ${index + 1}`,
      events: [{ type: "wait", durationMs: 1 }],
    }));
    expect(parsePlaytestFrame(JSON.stringify(frame({ actions }))).actions).toHaveLength(16);
  });
});

describe("runPlaytest", () => {
  test("refuses an existing PIE session without starting, input, or stopping it", async () => {
    const f = createRpc({ initiallyRunning: true });
    const result = await runPlaytest(optionsFor(f));
    expect(result.outcome).toBe("error");
    expect(f.calls.map((call) => call.method)).toEqual(["game.pie.status"]);
  });

  test("waits through partial startup observations, then dispatches only after a matching client frame", async () => {
    const events: PlaytestEvent[] = [];
    const f = createRpc({
      observePayload: (count, snapshot, frameName) =>
        count <= 2 ? unavailableObservePayload() : observePayload("client-1", snapshot, frameName),
    });
    const result = await runPlaytest(
      optionsFor(f, {
        maxDurationMs: 8_000,
        startupTimeoutMs: 2_500,
        onEvent: (event: PlaytestEvent) => events.push(event),
      }),
    );

    expect(result.outcome).toBe("success");
    expect(result.stats.observations).toBeGreaterThan(0);
    expect(events.some((event) => event.type === "readiness_wait" && event.section === "instances")).toBe(true);
    expect(f.calls.some((call) => call.method === "game.input.inject")).toBe(true);
    expect(result.cleanup.stopped).toBe(true);
  });

  test("waits for an adapter ready=false initial frame to become ready before dispatch", async () => {
    const events: PlaytestEvent[] = [];
    const f = createRpc({
      observePayload: (count, snapshot, frameName) =>
        observePayload("client-1", { ...snapshot, ready: count > 1 }, frameName),
    });
    const result = await runPlaytest(
      optionsFor(f, {
        maxDurationMs: 8_000,
        startupTimeoutMs: 2_500,
        onEvent: (event: PlaytestEvent) => events.push(event),
      }),
    );

    expect(result.outcome).toBe("success");
    expect(events.some((event) => event.type === "readiness_wait" && event.section === "adapter")).toBe(true);
    expect(f.calls.some((call) => call.method === "game.input.inject")).toBe(true);
    expect(result.cleanup.stopped).toBe(true);
  });

  test("does not dispatch a previously legal choice after the adapter becomes ready=false", async () => {
    const f = createRpc({
      observePayload: (count, snapshot, frameName) =>
        observePayload("client-1", { ...snapshot, ready: count < 3 }, frameName),
    });
    const result = await runPlaytest(
      optionsFor(f, {
        maxDurationMs: 3_000,
        startupTimeoutMs: 2_500,
        choose: async () => {
          while (f.getObserveCount() < 3) await new Promise((resolve) => setTimeout(resolve, 1));
          return { actionId: "fire_core", diagnostics: {}, latencyMs: 1 };
        },
      }),
    );

    expect(result.outcome).toBe("timeout");
    expect(result.reason).not.toContain("clientId mismatch");
    expect(f.calls.some((call) => call.method === "game.input.inject")).toBe(false);
    expect(result.stats.invalidatedChoices).toBeGreaterThan(0);
  });

  test("times out and stops its owned session when no usable frame appears during startup", async () => {
    const events: PlaytestEvent[] = [];
    const f = createRpc({ observePayload: () => unavailableObservePayload() });
    const result = await runPlaytest(
      optionsFor(f, {
        maxDurationMs: 8_000,
        startupTimeoutMs: 2_500,
        onEvent: (event: PlaytestEvent) => events.push(event),
      }),
    );

    expect(result.outcome).toBe("timeout");
    expect(result.reason).toContain("game-owned playtest frame");
    expect(f.calls.some((call) => call.method === "game.input.inject")).toBe(false);
    expect(f.calls.filter((call) => call.method === "game.stop")).toHaveLength(1);
    expect(result.cleanup.stopped).toBe(true);
    expect(events.some((event) => event.type === "readiness_wait")).toBe(true);
  });

  test("fails immediately on an explicit different nonempty client id", async () => {
    const f = createRpc({
      observePayload: (count, snapshot, frameName) =>
        observePayload(count === 1 ? "client-replacement" : "client-1", snapshot, frameName),
    });
    const result = await runPlaytest(optionsFor(f, { startupTimeoutMs: 2_500, maxDurationMs: 8_000 }));

    expect(result.outcome).toBe("session_changed");
    expect(result.reason).toContain("client-replacement");
    expect(f.calls.some((call) => call.method === "game.input.inject")).toBe(false);
    expect(result.cleanup.stopped).toBe(true);
  });

  test("does not dispatch from a stale choice after the character section disappears", async () => {
    const f = createRpc({
      observePayload: (count, snapshot, frameName) => observePayload(count < 3 ? "client-1" : "", snapshot, frameName),
    });
    const result = await runPlaytest(
      optionsFor(f, {
        maxDurationMs: 3_000,
        startupTimeoutMs: 2_500,
        choose: async () => {
          while (f.getObserveCount() < 3) await new Promise((resolve) => setTimeout(resolve, 1));
          return { actionId: "fire_core", diagnostics: {}, latencyMs: 1 };
        },
      }),
    );

    expect(result.outcome).toBe("timeout");
    expect(result.reason).not.toContain("clientId mismatch");
    expect(f.calls.some((call) => call.method === "game.input.inject")).toBe(false);
    expect(result.stats.invalidatedChoices).toBeGreaterThan(0);
  });

  test("accepts a fresh terminal frame with unavailable character data only while the PIE session is verified", async () => {
    const f = createRpc({
      beforeInputFrame: (count) =>
        frame({
          revision: count,
          gameTimeSeconds: 10 + count,
          actions: [],
          terminal: { outcome: "success", reason: "Observed completion" },
        }),
      observePayload: (_count, snapshot, frameName) => observePayload("", snapshot, frameName),
    });
    const result = await runPlaytest(optionsFor(f, { startupTimeoutMs: 2_500, maxDurationMs: 8_000 }));

    expect(result.outcome).toBe("success");
    expect(result.terminal?.reason).toBe("Observed completion");
    expect(f.calls.some((call) => call.method === "game.input.inject")).toBe(false);
    expect(result.cleanup.stopped).toBe(true);
  });

  test("forwards only parsed harness frames to the synchronous onFrame callback", async () => {
    const captured: PlaytestFrame[] = [];
    const good = createRpc();
    const completed = await runPlaytest(optionsFor(good, { onFrame: (value: PlaytestFrame) => captured.push(value) }));
    expect(completed.outcome).toBe("success");
    expect(captured.length).toBeGreaterThan(0);
    expect(captured.every((value) => value.harnessId === "raid-demo-v1")).toBe(true);

    const invalid = createRpc({
      observePayload: (_count, snapshot, frameName) => ({
        character: { data: { clientId: "client-1" } },
        instances: {
          data: {
            instances: [{ name: frameName, Value: { Type: "String", String: JSON.stringify(snapshot).slice(0, 20) } }],
          },
        },
      }),
    });
    const invalidFrames: PlaytestFrame[] = [];
    const failed = await runPlaytest(
      optionsFor(invalid, { onFrame: (value: PlaytestFrame) => invalidFrames.push(value) }),
    );
    expect(failed.outcome).toBe("error");
    expect(invalidFrames).toHaveLength(0);
  });

  test("accepts the 180s ceiling and rejects values above it before contacting Studio", async () => {
    const f = createRpc({ initiallyRunning: true });
    const accepted = await runPlaytest(optionsFor(f, { maxDurationMs: 180_000 }));
    expect(accepted.outcome).toBe("error");
    const callsBeforeInvalid = f.calls.length;
    await expect(runPlaytest(optionsFor(f, { maxDurationMs: 180_001 }))).rejects.toThrow(/180000/);
    expect(f.calls).toHaveLength(callsBeforeInvalid);
  });

  test("keeps a same action valid across revisions and dispatches the latest frame events", async () => {
    let inputs: Record<string, unknown>[] = [];
    let observationsAtInputStart = 0;
    let observationsAtInputEnd = 0;
    const events: PlaytestEvent[] = [];
    const f = createRpc({
      beforeInputFrame: (n) =>
        frame({
          revision: n,
          gameTimeSeconds: 10 + n,
          actions: [
            {
              id: "fire_core",
              coverageKey: "core-shot",
              description: "Fire once",
              validityKey: "same-window",
              events: [{ type: "key", key: n < 3 ? "F" : "R", action: "press", durationMs: 80 }],
              expectations: [{ key: "bossHp", op: "decrease" }],
            },
            { id: "wait", description: "Wait", events: [{ type: "wait", durationMs: 80 }] },
          ],
        }),
      onInput: async () => {
        observationsAtInputStart = f.getObserveCount();
        await new Promise((resolve) => setTimeout(resolve, 8));
        observationsAtInputEnd = f.getObserveCount();
      },
    });
    const baseCall = f.callRpc;
    f.callRpc = (async (method: string, params?: Record<string, unknown>, rpcOptions?: { signal?: AbortSignal }) => {
      if (method === "game.input.inject") inputs = params?.events as Record<string, unknown>[];
      return baseCall(method, params, rpcOptions);
    }) as never;
    const result = await runPlaytest(
      optionsFor(f, {
        choose: async () => {
          await new Promise((resolve) => setTimeout(resolve, 8));
          return { actionId: "fire_core", diagnostics: { confidence: 0.9 }, latencyMs: 8 };
        },
        onEvent: (event: PlaytestEvent) => events.push(event),
      }),
    );
    expect(result.outcome).toBe("success");
    expect(inputs.some((event) => event.key === "R")).toBe(true);
    expect(f.calls.find((call) => call.method === "game.input.inject")?.params).toMatchObject({
      pieSessionId: "pie-owned",
      clientId: "client-1",
    });
    expect(f.calls.find((call) => call.method === "game.play")?.params).toEqual({ numberOfPlayer: 1 });
    expect(observationsAtInputEnd).toBeGreaterThan(observationsAtInputStart);
    expect(events.filter((event) => event.type === "game_event" && event.id === "phase-exposed-4")).toHaveLength(1);
    expect(events.some((event) => event.type === "action_result" && event.expectations?.[0]?.passed === true)).toBe(
      true,
    );
    for (const type of ["model_choice", "action_dispatch", "input_reply", "action_result"]) {
      expect(events.find((event) => event.type === type)).toMatchObject({ coverageKey: "core-shot" });
    }
  });

  test("does not dispatch after the action validity key changes during inference", async () => {
    const f = createRpc({
      beforeInputFrame: (n) =>
        n >= 3
          ? frame({
              revision: n,
              gameTimeSeconds: 10 + n,
              actions: [],
              terminal: { outcome: "failure", reason: "State changed" },
            })
          : frame({
              revision: n,
              gameTimeSeconds: 10 + n,
              actions: [
                {
                  id: "fire_core",
                  description: "Fire",
                  validityKey: "old",
                  events: [{ type: "key", key: "F", action: "press" }],
                },
                { id: "wait", description: "Wait", events: [{ type: "wait", durationMs: 80 }] },
              ],
            }),
    });
    const result = await runPlaytest(
      optionsFor(f, {
        choose: async () => {
          while (f.getObserveCount() < 4) await new Promise((resolve) => setTimeout(resolve, 1));
          return { actionId: "fire_core", diagnostics: {}, latencyMs: 8 };
        },
      }),
    );
    expect(result.outcome).toBe("failure");
    expect(f.calls.some((call) => call.method === "game.input.inject")).toBe(false);
  });

  test("stops on cancelled inject without retrying and stops only its owned session", async () => {
    const f = createRpc({ inputStatus: "cancelled" });
    const result = await runPlaytest(optionsFor(f));
    expect(result.outcome).toBe("input_cancelled");
    expect(f.calls.filter((call) => call.method === "game.input.inject")).toHaveLength(1);
    expect(f.calls.filter((call) => call.method === "game.stop")).toHaveLength(1);
    const cleanupStatus = f.calls.filter((call) => call.method === "game.pie.status").at(-1);
    expect(cleanupStatus?.signal?.aborted).toBe(false);
  });

  test("classifies only the typed interruptedByUser input RPC error as cancellation", async () => {
    const interrupted = createRpc();
    const interruptedBaseCall = interrupted.callRpc;
    let interruptedAttempts = 0;
    interrupted.callRpc = (async (
      method: string,
      params?: Record<string, unknown>,
      rpcOptions?: { signal?: AbortSignal },
    ) => {
      if (method === "game.input.inject") {
        interruptedAttempts += 1;
        throw new StudioRpcError("Studio input interrupted", -32108, { reason: "interruptedByUser" });
      }
      return interruptedBaseCall(method, params, rpcOptions);
    }) as never;
    const interruptedEvents: PlaytestEvent[] = [];
    const interruptedResult = await runPlaytest(
      optionsFor(interrupted, { onEvent: (event: PlaytestEvent) => interruptedEvents.push(event) }),
    );
    expect(interruptedResult.outcome).toBe("input_cancelled");
    expect(interruptedAttempts).toBe(1);
    expect(interruptedResult.cleanup.stopped).toBe(true);
    expect(interrupted.calls.filter((call) => call.method === "game.stop")).toHaveLength(1);
    expect(interruptedEvents.find((event) => event.type === "input_reply")).toMatchObject({
      status: "cancelled",
      error: { code: -32108, reason: "interruptedByUser" },
    });

    for (const failure of [
      {
        message: "Look interaction failed",
        data: { reason: "lookTimedOut", looks: [{ status: "timedOut" }] },
      },
      {
        message: "Pointer interaction failed",
        data: { reason: "pointerTimedOut", pointerTargets: [{ status: "timedOut" }] },
      },
    ]) {
      const otherFailure = createRpc();
      const otherFailureBaseCall = otherFailure.callRpc;
      let otherFailureAttempts = 0;
      otherFailure.callRpc = (async (
        method: string,
        params?: Record<string, unknown>,
        rpcOptions?: { signal?: AbortSignal },
      ) => {
        if (method === "game.input.inject") {
          otherFailureAttempts += 1;
          throw new StudioRpcError(failure.message, -32108, failure.data);
        }
        return otherFailureBaseCall(method, params, rpcOptions);
      }) as never;
      const failedResult = await runPlaytest(optionsFor(otherFailure));
      expect(failedResult.outcome).toBe("error");
      expect(failedResult.reason).toContain("StudioRpcError");
      expect(otherFailureAttempts).toBe(1);
      expect(failedResult.cleanup.stopped).toBe(true);
      expect(otherFailure.calls.filter((call) => call.method === "game.stop")).toHaveLength(1);
    }
  });

  test("caller cancellation during input still stops the owned session with an independent signal", async () => {
    const controller = new AbortController();
    const f = createRpc({ onInput: () => controller.abort(new DOMException("Cancelled", "AbortError")) });
    const result = await runPlaytest(optionsFor(f, { signal: controller.signal }));
    expect(result.outcome).toBe("cancelled");
    expect(result.cleanup.stopped).toBe(true);
    expect(f.calls.filter((call) => call.method === "game.input.inject")).toHaveLength(1);
    const stop = f.calls.filter((call) => call.method === "game.stop");
    expect(stop).toHaveLength(1);
    expect(stop[0]?.signal?.aborted).toBe(false);
    expect(stop[0]?.signal).not.toBe(controller.signal);
  });

  test("episode deadline exhausted after input is timeout rather than a missing-frame error", async () => {
    let f: ReturnType<typeof createRpc>;
    f = createRpc({ onInput: () => f.clock.advance(5000) });
    const result = await runPlaytest(optionsFor(f, { maxDurationMs: 1000 }));
    expect(result.outcome).toBe("timeout");
    expect(result.reason).toContain("maxDurationMs");
    expect(result.cleanup.stopped).toBe(true);
  });

  test("a missing newer effect frame before the episode deadline remains an error", async () => {
    const f = createRpc({
      beforeInputFrame: () => frame({ revision: 1, gameTimeSeconds: 11 }),
      afterInputFrame: () => frame({ revision: 1, gameTimeSeconds: 11 }),
    });
    const result = await runPlaytest(optionsFor(f, { maxDurationMs: 10000 }));
    expect(result.outcome).toBe("error");
    expect(result.reason).toContain("No newer");
    expect(result.cleanup.stopped).toBe(true);
  });

  test("treats adapter errors as harness errors, never as game failure", async () => {
    const f = createRpc({
      beforeInputFrame: (n) =>
        frame({
          revision: n,
          gameTimeSeconds: 10 + n,
          actions: [],
          ready: false,
          error: { message: "adapter module raised" },
        }),
    });
    const result = await runPlaytest(optionsFor(f));
    expect(result.outcome).toBe("error");
    expect(result.reason).toContain("adapter module raised");
    expect(result.terminal).toBeUndefined();
    expect(f.calls.some((call) => call.method === "game.input.inject")).toBe(false);
  });

  test("blocks dispatch when gameTimeSeconds freezes even as frame revisions advance", async () => {
    const f = createRpc({
      beforeInputFrame: (n) =>
        frame({
          revision: n,
          gameTimeSeconds: 10,
          events: [],
        }),
    });
    const events: PlaytestEvent[] = [];
    const result = await runPlaytest(
      optionsFor(f, {
        maxDurationMs: 2_500,
        choose: async () => {
          while (f.getObserveCount() < 12) await new Promise((resolve) => setTimeout(resolve, 1));
          return { actionId: "fire_core", diagnostics: {}, latencyMs: 1_200 };
        },
        onEvent: (event: PlaytestEvent) => events.push(event),
      }),
    );
    expect(result.outcome).toBe("timeout");
    expect(f.calls.some((call) => call.method === "game.input.inject")).toBe(false);
    expect(
      events.some(
        (event) =>
          event.type === "dispatch_blocked" && String(event.reason).includes("gameTimeSeconds has not advanced"),
      ),
    ).toBe(true);
  });

  test("does not stop a replacement PIE session after supervisor detects it", async () => {
    const f = createRpc({ replaceSessionOnStatus: 3 });
    const result = await runPlaytest(
      optionsFor(f, {
        maxDurationMs: 5_000,
        choose: async () => {
          while (f.getObserveCount() < 20) await new Promise((resolve) => setTimeout(resolve, 1));
          return { actionId: "fire_core", diagnostics: {}, latencyMs: 1_500 };
        },
      }),
    );
    expect(result.outcome).toBe("session_changed");
    expect(result.cleanup.stopped).toBe(false);
    expect(f.calls.some((call) => call.method === "game.stop")).toBe(false);
  });

  test("uses a minimum start interval without adding 100ms after a slow observe RPC", async () => {
    const runWithLatency = async (observeLatencyMs: number) => {
      const f = createRpc({
        observeLatencyMs,
        beforeInputFrame: (n) =>
          frame({
            revision: n,
            gameTimeSeconds: 10 + n,
            actions: [],
            terminal: n >= 3 ? { outcome: "success", reason: "terminal observed" } : undefined,
          }),
      });
      const events: PlaytestEvent[] = [];
      const result = await runPlaytest(
        optionsFor(f, {
          maxDurationMs: 5_000,
          onEvent: (event: PlaytestEvent) => events.push(event),
        }),
      );
      expect(result.outcome).toBe("success");
      return events.filter((event) => event.type === "observation");
    };

    const slow = await runWithLatency(120);
    const fast = await runWithLatency(20);
    expect(slow.length).toBeGreaterThanOrEqual(3);
    expect(fast.length).toBeGreaterThanOrEqual(3);
    expect(slow.every((event) => event.pollDelayMs === 0)).toBe(true);
    expect(fast.every((event) => event.pollDelayMs === 80)).toBe(true);
    expect(
      slow.every(
        (event) =>
          typeof event.state === "object" &&
          event.state !== null &&
          (event.state as Record<string, unknown>).phase === "EXPOSED",
      ),
    ).toBe(true);
  });
});

describe("no-progress watchdog", () => {
  test("ends an empty-action stall despite advancing frame clocks and cleans up its session", async () => {
    const f = createRpc({
      beforeInputFrame: (n) => frame({ revision: n, gameTimeSeconds: n, progress: { sequence: 0 }, actions: [] }),
    });
    const events: PlaytestEvent[] = [];
    const result = await runPlaytest(
      optionsFor(f, {
        stuckTimeoutMs: 1000,
        maxDurationMs: 5000,
        onEvent: (event: PlaytestEvent) => events.push(event),
      }),
    );
    expect(result.outcome).toBe("stuck");
    expect(result.terminal).toBeUndefined();
    expect(result.stuck).toMatchObject({ timeoutMs: 1000, source: "adapter", sequence: 0 });
    expect(result.stats.elapsedMs).toBeLessThan(5000);
    expect(result.cleanup.stopped).toBe(true);
    expect(events.some((event) => event.type === "stuck" && event.state !== undefined)).toBe(true);
    expect(f.calls.some((call) => call.method === "game.input.inject")).toBe(false);
  });

  test("completed wait batches and changing clock expectations do not reset legacy progress", async () => {
    let n = 0;
    const waitingFrame = () =>
      frame({
        revision: ++n,
        gameTimeSeconds: n,
        state: { tick: n },
        actions: [
          {
            id: "wait",
            description: "Wait",
            events: [{ type: "wait", durationMs: 10 }],
            expectations: [{ key: "tick", op: "increase" }],
          },
        ],
      });
    const f = createRpc({ beforeInputFrame: waitingFrame, afterInputFrame: waitingFrame });
    const result = await runPlaytest(optionsFor(f, { stuckTimeoutMs: 1000, maxDurationMs: 5000 }));
    expect(result.outcome).toBe("stuck");
    expect(result.stuck?.source).toBe("effects");
    expect(result.stats.dispatchedActions).toBeGreaterThan(0);
    expect(result.cleanup.stopped).toBe(true);
  });

  test("meaningful adapter progress prevents a stall until the overall episode limit", async () => {
    const f = createRpc({
      beforeInputFrame: (n) =>
        frame({
          revision: n,
          gameTimeSeconds: n,
          progress: { sequence: Math.floor(f.clock.now() / 500) },
          actions: [],
        }),
    });
    const result = await runPlaytest(optionsFor(f, { stuckTimeoutMs: 1000, maxDurationMs: 4000 }));
    expect(result.outcome).toBe("timeout");
    expect(result.stuck).toBeUndefined();
    expect(result.cleanup.stopped).toBe(true);
  });

  test("allows a bounded normal wait and still accepts its real terminal", async () => {
    const f = createRpc({
      beforeInputFrame: (n) =>
        frame({
          revision: n,
          gameTimeSeconds: n,
          actions: [],
          progress: { sequence: 0, waiting: { reason: "Countdown", timeoutMs: 2000 } },
          terminal: f.clock.now() >= 1800 ? { outcome: "success", reason: "Observed completion" } : undefined,
        }),
    });
    const result = await runPlaytest(optionsFor(f, { stuckTimeoutMs: 1000, maxDurationMs: 5000 }));
    expect(result.outcome).toBe("success");
    expect(result.stuck).toBeUndefined();
    expect(result.stats.elapsedMs).toBeGreaterThan(1000);
  });

  test("aborts a pending model choice when progress stops", async () => {
    let aborted = false;
    const f = createRpc({
      beforeInputFrame: (n) => frame({ revision: n, gameTimeSeconds: n, progress: { sequence: 0 } }),
    });
    const result = await runPlaytest(
      optionsFor(f, {
        stuckTimeoutMs: 1000,
        maxDurationMs: 5000,
        choose: async (_frame: PlaytestFrame, _actions: unknown, signal: AbortSignal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                aborted = true;
                reject(signal.reason);
              },
              { once: true },
            );
          }),
      }),
    );
    expect(result.outcome).toBe("stuck");
    expect(aborted).toBe(true);
    expect(result.stats.dispatchedActions).toBe(0);
    expect(result.cleanup.stopped).toBe(true);
  });

  test("aborts a pending input batch and records the last action before owned cleanup", async () => {
    let n = 0;
    let aborted = false;
    const ongoing = () => frame({ revision: ++n, gameTimeSeconds: n, progress: { sequence: 0 } });
    const f = createRpc({
      beforeInputFrame: ongoing,
      afterInputFrame: ongoing,
      onInput: (signal) =>
        new Promise((_resolve, reject) => {
          signal!.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(signal!.reason);
            },
            { once: true },
          );
        }),
    });
    const result = await runPlaytest(optionsFor(f, { stuckTimeoutMs: 1000, maxDurationMs: 5000 }));
    expect(result.outcome).toBe("stuck");
    expect(aborted).toBe(true);
    expect(result.stuck?.lastActionId).toBe("fire_core");
    expect(result.cleanup.stopped).toBe(true);
  });
});

test("the default watchdog stops at fifteen seconds without requiring a timeout argument", async () => {
  const f = createRpc({ beforeInputFrame: (n) => frame({ revision: n, gameTimeSeconds: n, actions: [] }) });
  const result = await runPlaytest(optionsFor(f, { maxDurationMs: 60000 }));
  expect(result.outcome).toBe("stuck");
  expect(result.stuck?.timeoutMs).toBe(15000);
  expect(result.stuck?.inactiveMs).toBeGreaterThanOrEqual(15000);
  expect(result.stuck?.inactiveMs).toBeLessThan(15500);
  expect(result.cleanup.stopped).toBe(true);
});

test("a permanently renewed normal wait eventually expires into stuck", async () => {
  const f = createRpc({
    beforeInputFrame: (n) =>
      frame({
        revision: n,
        gameTimeSeconds: n,
        actions: [],
        progress: { sequence: 0, waiting: { reason: `Waiting frame ${n}`, timeoutMs: 1200 + n * 100 } },
      }),
  });
  const result = await runPlaytest(optionsFor(f, { stuckTimeoutMs: 1000, maxDurationMs: 10000 }));
  expect(result.outcome).toBe("stuck");
  expect(result.stats.elapsedMs).toBeLessThan(5000);
  expect(result.cleanup.stopped).toBe(true);
});

test("already-satisfied unchanged effects cannot keep a legacy harness running", async () => {
  let n = 0;
  const same = () =>
    frame({
      revision: ++n,
      gameTimeSeconds: n,
      state: { ready: true },
      actions: [
        {
          id: "ready",
          description: "Ready",
          events: [{ type: "key", key: "F", action: "press", durationMs: 10 }],
          expectations: [{ key: "ready", op: "equals", value: true }],
        },
      ],
    });
  const f = createRpc({ beforeInputFrame: same, afterInputFrame: same });
  const result = await runPlaytest(optionsFor(f, { stuckTimeoutMs: 1000, maxDurationMs: 5000 }));
  expect(result.outcome).toBe("stuck");
  expect(result.stats.dispatchedActions).toBeGreaterThan(0);
});

test("changed confirmed input effects maintain progress in a legacy adapter", async () => {
  let n = 0;
  let score = 0;
  const scored = () =>
    frame({
      revision: ++n,
      gameTimeSeconds: n,
      state: { score },
      actions: [
        {
          id: "score",
          description: "Score",
          events: [{ type: "key", key: "F", action: "press", durationMs: 10 }],
          expectations: [{ key: "score", op: "increase" }],
        },
      ],
    });
  const f = createRpc({
    beforeInputFrame: scored,
    afterInputFrame: scored,
    onInput: () => {
      score++;
    },
  });
  const result = await runPlaytest(optionsFor(f, { stuckTimeoutMs: 1000, maxDurationMs: 4000 }));
  expect(result.outcome).toBe("timeout");
  expect(result.stuck).toBeUndefined();
  expect(score).toBeGreaterThan(1);
});

test("validates progress payloads and watchdog options before starting play", async () => {
  expect(() => parsePlaytestFrame(frame({ progress: { sequence: -1 } }))).toThrow(/progress/);
  expect(() =>
    parsePlaytestFrame(frame({ progress: { sequence: 0, waiting: { reason: "", timeoutMs: 100 } } })),
  ).toThrow(/progress/);
  for (const timeout of [-1, 0.5, 180001, Number.NaN]) {
    const f = createRpc();
    await expect(runPlaytest(optionsFor(f, { stuckTimeoutMs: timeout }))).rejects.toThrow(/stuckTimeoutMs/);
    expect(f.calls).toHaveLength(0);
  }
});

test("runtime correlates model selection, dispatch and effect evidence across observation revisions", async () => {
  const events: PlaytestEvent[] = [];
  const f = createRpc();
  const result = await runPlaytest(optionsFor(f, { onEvent: (event: PlaytestEvent) => events.push(event) }));
  const chosen = events.find((event) => event.type === "model_choice")!;
  const dispatched = events.find((event) => event.type === "action_dispatch")!;
  const effect = events.find((event) => event.type === "action_result")!;
  expect(chosen.decisionId).toBeNumber();
  expect(dispatched.decisionId).toBe(chosen.decisionId);
  expect(effect.decisionId).toBe(chosen.decisionId);
  expect(dispatched.decisionSource).toBe("model");
  expect(effect.decisionSource).toBe("model");
  expect(result.decisionEvidence).toMatchObject({
    status: "effects_observed",
    modelRequests: 1,
    modelChoices: 1,
    modelDispatches: 1,
    modelEffectsConfirmed: 1,
    automaticDispatches: 0,
  });
});

test("a successful automatic-only episode explicitly reports model decisions were not exercised", async () => {
  const f = createRpc({
    beforeInputFrame: (n) =>
      frame({
        revision: n,
        gameTimeSeconds: n,
        actions: frame().actions.slice(0, 1),
      }),
  });
  const result = await runPlaytest(optionsFor(f));
  expect(result.outcome).toBe("success");
  expect(result.decisionEvidence).toMatchObject({
    status: "not_exercised",
    modelRequests: 0,
    modelChoices: 0,
    modelDispatches: 0,
    modelEffectsConfirmed: 0,
    automaticDispatches: 1,
  });
});

describe("model-selected persistent intents", () => {
  function scenario(options: { invalidateA?: boolean; waitOnly?: boolean } = {}) {
    let revision = 0;
    let a = 0;
    let b = 0;
    const make = () =>
      frame({
        revision: ++revision,
        gameTimeSeconds: revision,
        state: { aSteps: a, bSteps: b, aDone: a >= 3, bDone: b >= 2 },
        progress: { sequence: a + b },
        actions: [
          ...(a >= 3
            ? []
            : [
                {
                  id: `a-step-${a}`,
                  description: "Execute room A step",
                  intent: {
                    id: "room-a",
                    description: "Explore room A",
                    validityKey: options.invalidateA && a > 0 ? "changed" : "stable",
                    completeWhen: [{ key: "aDone", op: "equals" as const, value: true }],
                  },
                  events: options.waitOnly
                    ? [{ type: "wait" as const, durationMs: 10 }]
                    : [{ type: "key" as const, key: "A" as const, action: "press" as const, durationMs: 10 }],
                  expectations: [{ key: "aSteps", op: "increase" as const }],
                },
              ]),
          ...(b >= 2
            ? []
            : [
                {
                  id: `b-step-${b}`,
                  description: "Execute room B step",
                  intent: {
                    id: "room-b",
                    description: "Explore room B",
                    validityKey: "stable",
                    completeWhen: [{ key: "bDone", op: "equals" as const, value: true }],
                  },
                  events: options.waitOnly
                    ? [{ type: "wait" as const, durationMs: 10 }]
                    : [{ type: "key" as const, key: "B" as const, action: "press" as const, durationMs: 10 }],
                  expectations: [{ key: "bSteps", op: "increase" as const }],
                },
              ]),
        ],
        terminal: (options.invalidateA ? b >= 2 : a >= 3 && b >= 2)
          ? { outcome: "success", reason: "Observed scenario completion" }
          : undefined,
      });
    const f = createRpc({ beforeInputFrame: make, afterInputFrame: make });
    const base = f.callRpc;
    f.callRpc = (async (method: string, params?: Record<string, unknown>, rpcOptions?: { signal?: AbortSignal }) => {
      if (method === "game.input.inject") {
        const inputs = params?.events as Array<{ type: string; key?: string; action?: string }>;
        if (inputs.some((event) => event.type === "key" && event.key === "A" && event.action === "down")) a++;
        if (inputs.some((event) => event.type === "key" && event.key === "B" && event.action === "down")) b++;
      }
      return base(method, params, rpcOptions);
    }) as never;
    return { f, counts: () => ({ a, b }) };
  }

  test("retains a model-selected goal across changing physical step IDs until its observed completion", async () => {
    const { f, counts } = scenario();
    const events: PlaytestEvent[] = [];
    const catalogs: string[][] = [];
    const result = await runPlaytest(
      optionsFor(f, {
        maxDurationMs: 10000,
        intentDecisionIntervalMs: 30000,
        onEvent: (event: PlaytestEvent) => events.push(event),
        choose: async (_frame: PlaytestFrame, candidates: Array<{ id: string }>) => {
          catalogs.push(candidates.map((candidate) => candidate.id));
          return { actionId: "room-a" };
        },
      }),
    );
    expect(result.outcome).toBe("success");
    expect(catalogs).toEqual([["room-a", "room-b"]]);
    expect(counts()).toEqual({ a: 3, b: 2 });
    const dispatches = events.filter((event) => event.type === "action_dispatch");
    expect(dispatches.map((event) => event.actionId)).toEqual([
      "a-step-0",
      "a-step-1",
      "a-step-2",
      "b-step-0",
      "b-step-1",
    ]);
    expect(new Set(dispatches.slice(0, 3).map((event) => event.decisionId)).size).toBe(1);
    expect(new Set(dispatches.map((event) => event.executionId)).size).toBe(5);
    expect(events.filter((event) => event.type === "intent_completed").map((event) => event.intentId)).toEqual([
      "room-a",
      "room-b",
    ]);
    expect(result.decisionEvidence).toMatchObject({ modelChoices: 1, modelDispatches: 1, modelEffectsConfirmed: 1 });
  });

  test("a changed intent guard triggers fresh model choice before the normal reconsideration interval", async () => {
    const { f, counts } = scenario({ invalidateA: true });
    let choices = 0;
    const events: PlaytestEvent[] = [];
    const result = await runPlaytest(
      optionsFor(f, {
        maxDurationMs: 10000,
        intentDecisionIntervalMs: 30000,
        onEvent: (event: PlaytestEvent) => events.push(event),
        choose: async () => ({ actionId: ++choices === 1 ? "room-a" : "room-b" }),
      }),
    );
    expect(result.outcome).toBe("success");
    expect(counts()).toEqual({ a: 1, b: 2 });
    expect(choices).toBe(2);
    expect(events.some((event) => event.type === "intent_invalidated" && event.intentId === "room-a")).toBe(true);
  });

  test("periodic model reconsideration can switch goals without waiting for completion", async () => {
    const { f, counts } = scenario({ waitOnly: true });
    const contexts: unknown[] = [];
    const coverage = createCoverageTracker();
    const events: PlaytestEvent[] = [];
    let calls = 0;
    const result = await runPlaytest(
      optionsFor(f, {
        maxDurationMs: 3000,
        stuckTimeoutMs: 2000,
        intentDecisionIntervalMs: 250,
        onEvent: (event: PlaytestEvent) => events.push(event),
        choose: async (_frame: PlaytestFrame, _candidates: unknown, _signal: AbortSignal, context: unknown) => {
          contexts.push(context);
          return { actionId: ++calls === 1 ? "room-a" : "room-b" };
        },
      }),
    );
    expect(result.outcome).toBe("stuck");
    expect(calls).toBeGreaterThan(1);
    expect(contexts[1]).toMatchObject({ activeIntent: { id: "room-a", elapsedMs: expect.any(Number) } });
    expect(
      events.filter((event) => event.type === "action_dispatch").some((event) => event.intentId === "room-b"),
    ).toBe(true);
    expect(events.filter((event) => event.type === "intent_selected")).toHaveLength(2);
    for (const event of events) expect(() => coverage.event(event)).not.toThrow();
    expect(counts()).toEqual({ a: 0, b: 0 });
  });
});

test("a terminal arriving during reconsideration records the retained goal's observed completion", async () => {
  let n = 0,
    calls = 0,
    complete = false;
  const observed = () =>
    frame({
      revision: ++n,
      gameTimeSeconds: n,
      state: { done: complete },
      actions: ["a", "b"].map((id) => ({
        id: `step-${id}`,
        description: `step ${id}`,
        events: [{ type: "key" as const, key: "F" as const, action: "press" as const, durationMs: 10 }],
        intent: {
          id,
          description: `goal ${id}`,
          validityKey: "same",
          completeWhen: [{ key: "done", op: "equals" as const, value: true }],
        },
      })),
      terminal: complete ? { outcome: "success", reason: "Authoritative completion" } : undefined,
    });
  const f = createRpc({ beforeInputFrame: observed, afterInputFrame: observed });
  const events: PlaytestEvent[] = [];
  const result = await runPlaytest(
    optionsFor(f, {
      maxDurationMs: 5000,
      intentDecisionIntervalMs: 250,
      onEvent: (e: PlaytestEvent) => events.push(e),
      choose: async (_f: unknown, _a: unknown, signal: AbortSignal) => {
        if (++calls === 1) return { actionId: "a" };
        complete = true;
        return new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
        );
      },
    }),
  );
  expect(result.outcome).toBe("success");
  expect(events.filter((e) => e.type === "intent_completed")).toHaveLength(1);
  expect(events.find((e) => e.type === "intent_completed")?.intentId).toBe("a");
});

test("a switch from legacy actions to intent actions invalidates an in-flight legacy choice", async () => {
  let choices = 0;
  const f = createRpc({
    beforeInputFrame: (n) =>
      frame({
        revision: n,
        gameTimeSeconds: n,
        actions: frame().actions.map((action) =>
          n < 3
            ? action
            : {
                ...action,
                intent: {
                  id: `goal-${action.id}`,
                  description: `Goal ${action.id}`,
                  validityKey: "same",
                  completeWhen: [{ key: "bossHp", op: "decrease" as const }],
                },
              },
        ),
      }),
  });
  const result = await runPlaytest(
    optionsFor(f, {
      choose: async (_f: PlaytestFrame, candidates: Array<{ id: string }>) => {
        choices++;
        if (choices === 1) await new Promise((resolve) => setTimeout(resolve, 8));
        return { actionId: candidates[0].id };
      },
    }),
  );
  expect(result.outcome).toBe("success");
  expect(choices).toBe(2);
  expect(result.stats.invalidatedChoices).toBeGreaterThan(0);
});

test("model context receives only the last three completed action outcomes from fresh observations", async () => {
  const clock = new TestClock();
  const calls: FakeCall[] = [];
  const contexts: Array<unknown> = [];
  const modelStarts: PlaytestEvent[] = [];
  let running = false;
  let revision = 0;
  let completed = 0;
  let count = 0;
  const ready = false;
  let lastEffect: string | null = null;
  let omitNextClient = false;

  const makeObservedFrame = (): PlaytestFrame => {
    const step = completed;
    const actionExpectations = [
      [{ key: "count", op: "increase" as const }],
      [{ key: "ready", op: "equals" as const, value: true }],
      [{ key: "lastEffect", op: "equals" as const, value: "step-2" }],
      [{ key: "count", op: "increase" as const }],
      undefined,
    ][step];
    const actions =
      step < 6
        ? [
            {
              id: `step-${step}`,
              description: `Perform physical step ${step}`,
              events: [
                {
                  type: "key" as const,
                  key: String.fromCharCode(65 + step) as "A",
                  action: "press" as const,
                  durationMs: 10,
                },
              ],
              ...(actionExpectations ? { expectations: actionExpectations } : {}),
            },
            {
              id: `alternate-${step}`,
              description: `Alternate physical step ${step}`,
              events: [{ type: "wait" as const, durationMs: 10 }],
            },
          ]
        : [];
    return frame({
      revision: ++revision,
      gameTimeSeconds: 20 + revision,
      state: { step, count, ready, lastEffect },
      actions,
      terminal: step === 6 ? { outcome: "success", reason: "Test episode complete" } : undefined,
    });
  };

  const callRpc = async (method: string, params?: Record<string, unknown>, rpcOptions?: { signal?: AbortSignal }) => {
    calls.push({ method, params, signal: rpcOptions?.signal });
    if (method === "game.pie.status") {
      return {
        running,
        pieSessionId: running ? "pie-owned" : undefined,
        clients: running ? [{ clientId: "client-1", injectable: true, targeted: true }] : [],
      };
    }
    if (method === "game.play") {
      running = true;
      return { started: true };
    }
    if (method === "game.stop") {
      running = false;
      return { stopped: true };
    }
    if (method === "game.observe") {
      const snapshot = makeObservedFrame();
      const instanceParams = params?.instances as { targets?: unknown } | undefined;
      const frameName = Array.isArray(instanceParams?.targets)
        ? String(instanceParams.targets[0] ?? "__PlaytestFrame")
        : "__PlaytestFrame";
      if (omitNextClient) {
        omitNextClient = false;
        return observePayload("", snapshot, frameName);
      }
      return observePayload("client-1", snapshot, frameName);
    }
    if (method === "game.input.inject") {
      const inputEvents = params?.events as Array<{ key?: string }>;
      const key = inputEvents[0]?.key;
      if (!key) throw new Error("Expected the selected physical input");
      const step = key.charCodeAt(0) - 65;
      completed = step + 1;
      if (step === 0 || step === 3) count += 1;
      if (step === 2) {
        lastEffect = "step-2";
        omitNextClient = true;
      }
      return { status: "completed", looks: [] };
    }
    throw new Error(`Unexpected RPC ${method}`);
  };

  const result = await runPlaytest(
    optionsFor({ callRpc, clock } as ReturnType<typeof createRpc>, {
      maxDurationMs: 10_000,
      choose: async (current: PlaytestFrame, _candidates: unknown, _signal: AbortSignal, context?: unknown) => {
        contexts.push(context);
        return { actionId: `step-${current.state.step}` };
      },
      onEvent: (event: PlaytestEvent) => {
        if (event.type === "model_start") modelStarts.push(event);
      },
    }),
  );

  expect(result.outcome).toBe("success");
  expect(calls.some((call) => call.method === "game.stop")).toBe(true);
  expect(contexts[0]).toBeUndefined();
  expect(contexts[1]).toEqual({ recentActions: [{ actionId: "step-0", result: "effect_confirmed" }] });
  expect(contexts[2]).toEqual({
    recentActions: [
      { actionId: "step-0", result: "effect_confirmed" },
      { actionId: "step-1", result: "effect_unconfirmed" },
    ],
  });
  expect(contexts[3]).toEqual({
    recentActions: [
      { actionId: "step-0", result: "effect_confirmed" },
      { actionId: "step-1", result: "effect_unconfirmed" },
      { actionId: "step-2", result: "not_checked" },
    ],
  });
  expect(contexts[4]).toEqual({
    recentActions: [
      { actionId: "step-1", result: "effect_unconfirmed" },
      { actionId: "step-2", result: "not_checked" },
      { actionId: "step-3", result: "effect_confirmed" },
    ],
  });
  expect(contexts[5]).toEqual({
    recentActions: [
      { actionId: "step-2", result: "not_checked" },
      { actionId: "step-3", result: "effect_confirmed" },
      { actionId: "step-4", result: "not_checked" },
    ],
  });
  expect(modelStarts[4]).toMatchObject({
    type: "model_start",
    controllerContext: contexts[4],
  });
  expect(modelStarts[0]).not.toHaveProperty("controllerContext");
  const fresh = createRpc();
  const freshContexts: unknown[] = [];
  await runPlaytest(
    optionsFor(fresh, {
      choose: async (_frame: unknown, _candidates: unknown, _signal: AbortSignal, context?: unknown) => {
        freshContexts.push(context);
        return { actionId: "fire_core" };
      },
    }),
  );
  expect(freshContexts).toEqual([undefined]);
});

test("visual mode passes captured evidence to the chooser and logs metadata without pixel payloads", async () => {
  const f = createRpc();
  const events: PlaytestEvent[] = [];
  let captured = false;
  const result = await runPlaytest(
    optionsFor(f, {
      captureVisual: async (
        current: PlaytestFrame,
        _signal: AbortSignal,
        target: { pieSessionId: string; clientId: string },
      ) => {
        expect(target).toEqual({ pieSessionId: "pie-owned", clientId: "client-1" });
        captured = true;
        return {
          dataUrl: "data:image/png;base64,c2VjcmV0cGl4ZWxz",
          metadata: {
            ...target,
            capturedAtMs: f.clock.now(),
            stateRevision: current.revision,
            width: 1,
            height: 1,
            sha256: "visual-hash",
          },
        };
      },
      choose: async (
        _frame: PlaytestFrame,
        _candidates: unknown,
        _signal: AbortSignal,
        _context: unknown,
        visual: PlaytestVisual,
      ) => {
        expect(captured).toBe(true);
        expect(visual.dataUrl).toContain("base64");
        return { actionId: "fire_core" };
      },
      onEvent: (e: PlaytestEvent) => events.push(e),
    }),
  );
  expect(result.outcome).toBe("success");
  expect(events.find((e) => e.type === "visual_observation")).toMatchObject({
    sha256: "visual-hash",
    clientId: "client-1",
  });
  expect(JSON.stringify(events)).not.toContain("c2VjcmV0cGl4ZWxz");
});

test("expired visual decisions are discarded before input and capture errors still clean up the owned PIE", async () => {
  for (const failure of ["expired", "capture_error", "wrong_client"]) {
    const f = createRpc();
    let modelCalls = 0;
    const result = await runPlaytest(
      optionsFor(f, {
        maxDurationMs: 2000,
        maxVisualAgeMs: 250,
        stuckTimeoutMs: 0,
        captureVisual: async (current: PlaytestFrame) => {
          if (failure === "capture_error") throw Error("Screenshot file unavailable");
          return {
            dataUrl: "data:image/png;base64,eA==",
            metadata: {
              pieSessionId: "pie-owned",
              clientId: failure === "wrong_client" ? "other" : "client-1",
              capturedAtMs: f.clock.now(),
              stateRevision: current.revision,
              width: 1,
              height: 1,
              sha256: "hash",
            },
          };
        },
        choose: async () => {
          modelCalls++;
          await f.clock.sleep(400);
          return { actionId: "fire_core" };
        },
      }),
    );
    expect(f.calls.some((c) => c.method === "game.input.inject")).toBe(false);
    expect(result.cleanup.stopped).toBe(true);
    if (failure === "expired") {
      expect(modelCalls).toBeGreaterThan(0);
      expect(result.stats.invalidatedChoices).toBeGreaterThan(0);
    } else {
      expect(modelCalls).toBe(0);
      expect(result.outcome).toBe("error");
    }
  }
});

test("candidate changes while capturing invalidate evidence before the provider is called", async () => {
  const f = createRpc({
    beforeInputFrame: (n) =>
      frame({
        revision: n,
        actions: [
          {
            id: "fire_core",
            description: "Fire",
            validityKey: `revision-${n}`,
            events: [{ type: "key", key: "F", action: "press", durationMs: 1 }],
          },
          { id: "wait", description: "Wait", events: [{ type: "wait", durationMs: 1 }] },
        ],
      }),
  });
  let requests = 0;
  const result = await runPlaytest(
    optionsFor(f, {
      maxDurationMs: 1500,
      stuckTimeoutMs: 0,
      captureVisual: async (
        current: PlaytestFrame,
        _signal: AbortSignal,
        target: { pieSessionId: string; clientId: string },
      ) => {
        const capturedAtMs = f.clock.now();
        await f.clock.sleep(200);
        return {
          dataUrl: "data:image/png;base64,eA==",
          metadata: { ...target, capturedAtMs, stateRevision: current.revision, width: 1, height: 1, sha256: "hash" },
        };
      },
      choose: async () => {
        requests++;
        return { actionId: "fire_core" };
      },
    }),
  );
  expect(requests).toBe(0);
  expect(result.stats.modelCalls).toBe(0);
  expect(result.stats.invalidatedChoices).toBeGreaterThan(0);
  expect(f.calls.some((c) => c.method === "game.input.inject")).toBe(false);
  expect(result.cleanup.stopped).toBe(true);
});
