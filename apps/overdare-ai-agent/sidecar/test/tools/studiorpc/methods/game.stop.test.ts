// @summary Verifies that stopping PIE requires observed completion rather than request acceptance.
import { describe, expect, test } from "bun:test";
import { confirmStopped, postProcess } from "../../../../src/tools/studiorpc/methods/game.stop";

describe("game.stop completion", () => {
  test("polls through a delayed stop before reporting success", async () => {
    let reads = 0;
    const result = await confirmStopped(
      { success: true },
      async (method, _params, options) => {
        expect(method).toBe("game.pie.status");
        expect(options?.timeoutMs).toBeGreaterThan(0);
        expect(options?.timeoutMs).toBeLessThanOrEqual(100);
        return ++reads === 1
          ? { running: true, state: "stopping", pieSessionId: "old" }
          : { running: false, state: "stopped" };
      },
      { timeoutMs: 100, pollIntervalMs: 1 },
    );
    expect(reads).toBe(2);
    expect(result).toMatchObject({ success: true, running: false, status: "stopped" });
  });

  test("an accepted stop still running at the deadline is pending, not successful", async () => {
    const result = await confirmStopped({ success: true }, async () => ({ running: true, pieSessionId: "old" }), {
      timeoutMs: 0,
    });
    expect(result).toMatchObject({ success: false, status: "stopPending", running: true, pieSessionId: "old" });
  });

  test("missing status and a failed stop never establish completion", async () => {
    await expect(postProcess({ success: true }, {}, async () => ({}))).rejects.toThrow("running");
    let reads = 0;
    const failed = await postProcess({ success: false, reason: "busy" }, {}, async () => {
      reads++;
      return {};
    });
    expect(failed).toEqual({ success: false, reason: "busy" });
    expect(reads).toBe(0);
  });

  test("status transport errors remain errors without replaying the stop", async () => {
    await expect(
      postProcess({ success: true }, {}, async () => {
        throw new Error("connection lost");
      }),
    ).rejects.toThrow("connection lost");
  });
});
