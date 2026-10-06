// @summary Tests that restart really stops first, and that Studio never sees the flag.
import { describe, expect, test } from "bun:test";
import { normalizeArgs, preCall } from "../../../../src/tools/studiorpc/methods/game.play";

describe("game.play restart", () => {
  test("stops the running session before starting one", async () => {
    const calls: string[] = [];
    let reads = 0;
    await preCall({ restart: true, numberOfPlayer: 2 }, async (method) => {
      calls.push(method);
      return method === "game.stop" ? { success: true } : { running: ++reads === 1 };
    });

    expect(calls).toEqual(["game.pie.status", "game.stop", "game.pie.status"]);
  });

  test("does not send stop to an already stopped session", async () => {
    const calls: string[] = [];
    await preCall({ restart: true }, async (method) => {
      calls.push(method);
      return { running: false };
    });
    expect(calls).toEqual(["game.pie.status"]);
  });

  test("does not start after a rejected stop", async () => {
    await expect(
      preCall({ restart: true }, async (method) =>
        method === "game.pie.status" ? { running: true } : { success: false },
      ),
    ).rejects.toThrow("stop completion is unconfirmed");
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
