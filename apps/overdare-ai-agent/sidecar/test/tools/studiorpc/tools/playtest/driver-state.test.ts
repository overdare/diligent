// @summary Ensures a run temporarily enables only its managed driver and restores it without touching external PIE.
import { describe, expect, test } from "bun:test";
import { withHarnessDriver } from "../../../../../src/tools/studiorpc/tools/playtest/driver-state";
import { createWriteLock } from "../../../../../src/tools/studiorpc/write-lock";

function fixture(enabled = false) {
  const controller = new AbortController();
  const flags = new Map([
    ["driver", enabled],
    ["other-driver", false],
  ]);
  const writes: boolean[] = [];
  let running = false;
  let snapshots = 0;
  let loseEnableReply = false;
  const rpc = async (method: string, args?: Record<string, unknown>, options?: { signal?: AbortSignal }) => {
    options?.signal?.throwIfAborted();
    if (method === "game.pie.status") return { running, clients: running ? [{ clientId: "external" }] : [] };
    if (method === "instance.read") {
      expect(args?.ActorGuid).toBe("driver");
      return {
        instance: { Name: "DiligentPlaytestDriver_sample", InstanceType: "LocalScript", Enabled: flags.get("driver") },
      };
    }
    if (method === "instance.update") {
      const updates = args?.Instances as Array<{ ActorGuid: string; Enabled: boolean }>;
      for (const update of updates) {
        flags.set(update.ActorGuid, update.Enabled);
        writes.push(update.Enabled);
      }
      if (loseEnableReply && updates.some((update) => update.Enabled)) throw Error("enable acknowledgement lost");
      return { success: true };
    }
    throw Error(`Unexpected RPC ${method}`);
  };
  const lock = createWriteLock();
  return {
    flags,
    writes,
    controller,
    setRunning(value: boolean) {
      running = value;
    },
    loseEnableReply() {
      loseEnableReply = true;
    },
    snapshotCount: () => snapshots,
    run: <T>(work: () => Promise<T>) =>
      withHarnessDriver(
        {
          cwd: "/tmp",
          callRpc: rpc as never,
          writeLock: lock,
          beforeMutation: async () => {
            const release = await lock.acquire();
            snapshots++;
            release();
            return undefined;
          },
        },
        { toolCallId: "run", signal: controller.signal, abort() {}, approve: async () => "once" },
        {
          name: "sample",
          moduleGuid: "adapter",
          driverGuid: "driver",
          frameName: "frame",
          source: "return {}",
          sourceHash: "a".repeat(64),
        },
        work,
      ),
  };
}

describe("managed playtest driver lifetime", () => {
  test("a disabled driver runs enabled, then restores exactly its original flag", async () => {
    const f = fixture();
    const result = await f.run(async () => {
      expect(f.flags.get("driver")).toBe(true);
      expect(f.flags.get("other-driver")).toBe(false);
      return "completed";
    });
    expect(result.result).toBe("completed");
    expect(result.driver).toMatchObject({ originalEnabled: false, temporarilyEnabled: true, restoration: "restored" });
    expect([...f.flags]).toEqual([
      ["driver", false],
      ["other-driver", false],
    ]);
    expect(f.snapshotCount()).toBe(1);
  });

  test("an already enabled driver is neither rewritten nor snapshotted", async () => {
    const f = fixture(true);
    const result = await f.run(async () => "completed");
    expect(f.flags.get("driver")).toBe(true);
    expect(result.driver.restoration).toBe("not_needed");
    expect(f.writes).toEqual([]);
    expect(f.snapshotCount()).toBe(0);
  });

  test("cancellation still restores the flag with an independent cleanup signal", async () => {
    const f = fixture();
    await expect(
      f.run(async () => {
        f.controller.abort();
        throw Error("episode cancelled");
      }),
    ).rejects.toThrow("episode cancelled");
    expect(f.flags.get("driver")).toBe(false);
    expect(f.writes).toEqual([true, false]);
  });

  test("an uncertain enable acknowledgement is not replayed and the observed mutation is restored", async () => {
    const f = fixture();
    f.loseEnableReply();
    let entered = false;
    await expect(
      f.run(async () => {
        entered = true;
      }),
    ).rejects.toThrow("enable acknowledgement lost");
    expect(entered).toBe(false);
    expect(f.flags.get("driver")).toBe(false);
    expect(f.writes).toEqual([true, false]);
  });

  test("external PIE prevents driver changes or running the supplied episode", async () => {
    const f = fixture();
    f.setRunning(true);
    let entered = false;
    await expect(
      f.run(async () => {
        entered = true;
      }),
    ).rejects.toThrow(/PIE/);
    expect(entered).toBe(false);
    expect(f.writes).toEqual([]);
    expect(f.snapshotCount()).toBe(0);
  });

  test("an external session appearing during cleanup is not stopped or edited", async () => {
    const f = fixture();
    const result = await f.run(async () => {
      f.setRunning(true);
      return "game completed";
    });
    expect(result.result).toBe("game completed");
    expect(result.driver).toMatchObject({ restoration: "failed" });
    expect(result.driver.error).toMatch(/PIE/);
    expect(f.flags.get("driver")).toBe(true);
    expect(f.flags.get("other-driver")).toBe(false);
    expect(f.writes).toEqual([true]);
  });
});
