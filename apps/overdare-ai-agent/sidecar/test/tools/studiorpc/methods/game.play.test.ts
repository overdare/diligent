// @summary Tests that restart really stops first, and that Studio never sees the flag.
import { describe, expect, test } from "bun:test";
import { normalizeArgs, params, preCall } from "../../../../src/tools/studiorpc/methods/game.play";

test("accepts the Studio PIE player limit and rejects counts above it", () => {
  expect(params.safeParse({ numberOfPlayer: 8 }).success).toBe(true);
  expect(params.safeParse({ numberOfPlayer: 9, restart: true }).success).toBe(false);
});

test("accepts an explicit per-session server process choice and preserves omission", () => {
  expect(params.parse({ separateServer: true })).toEqual({ separateServer: true });
  expect(params.parse({ separateServer: false })).toEqual({ separateServer: false });
  expect(params.parse({})).toEqual({});
  expect(params.safeParse({ separateServer: "true" }).success).toBe(false);
  expect(params.safeParse({ addClient: true, separateServer: false }).success).toBe(false);
  expect(normalizeArgs({ restart: true, separateServer: true, numberOfPlayer: 1 })).toEqual({
    separateServer: true,
    numberOfPlayer: 1,
  });
});

describe("game.play restart", () => {
  test("stops the running session before starting one", async () => {
    const calls: string[] = [];
    await preCall({ restart: true, numberOfPlayer: 2 }, async (method) => {
      calls.push(method);
      return {};
    });

    expect(calls).toEqual(["game.stop"]);
  });

  test("leaves a running session alone when it is not asked to restart", async () => {
    const calls: string[] = [];
    const record = async (method: string) => {
      calls.push(method);
      return {};
    };
    await preCall({ numberOfPlayer: 2 }, record);
    await preCall({ restart: false }, record);

    expect(calls).toEqual([]);
  });

  test("does not start when the required stop could not be confirmed", async () => {
    await expect(
      preCall({ restart: true }, async () => {
        throw new Error("Studio RPC connection failed");
      }),
    ).rejects.toThrow("connection failed");
  });

  test("restart never reaches Studio, which does not know the flag", () => {
    expect(normalizeArgs({ restart: true, numberOfPlayer: 2 })).toEqual({ numberOfPlayer: 2 });
  });
});

describe("game.play mobile simulator selection", () => {
  test.each([
    { mobileSimulator: true, separateServer: true },
    { mobileSimulator: true, separateServer: false },
    { mobileSimulator: false, separateServer: true },
    { mobileSimulator: false, separateServer: false },
  ])("preserves both per-session choices through a restart: %j", async (choices) => {
    const args = params.parse({ ...choices, restart: true });
    const calls: string[] = [];
    await preCall(args, async (method) => {
      calls.push(method);
      return {};
    });
    expect(calls).toEqual(["game.stop"]);
    expect(normalizeArgs(args)).toEqual(choices);
  });

  test.each([true, false])("preserves the explicit %s choice across restart normalization", async (mobileSimulator) => {
    const args = params.parse({ mobileSimulator, restart: true });
    const calls: string[] = [];
    await preCall(args, async (method) => {
      calls.push(method);
      return {};
    });
    expect(calls).toEqual(["game.stop"]);
    expect(normalizeArgs(args)).toEqual({ mobileSimulator });
  });

  test("omission preserves Studio's current selection", () => {
    expect(normalizeArgs(params.parse({}))).toEqual({});
  });

  test.each(["false", null, 0, {}])("rejects non-boolean choice %j", (mobileSimulator) => {
    expect(params.safeParse({ mobileSimulator }).success).toBe(false);
  });

  test("cannot change the simulator while adding a client", () => {
    expect(params.safeParse({ addClient: true, mobileSimulator: false }).success).toBe(false);
  });
});
