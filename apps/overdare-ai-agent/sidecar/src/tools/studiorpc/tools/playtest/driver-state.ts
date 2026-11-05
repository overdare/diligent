// @summary Temporarily enables only an approved run's managed driver and restores its original flag after owned PIE cleanup.
import type { ToolContext } from "../../types";
import type { HarnessAsset } from "./harness";
import { type PlaytestToolOptions, withSignal } from "./tool-shared";

type Rpc = PlaytestToolOptions["callRpc"];
export interface DriverRestoration {
  guid: string;
  originalEnabled: boolean;
  temporarilyEnabled: boolean;
  restoration: "not_needed" | "restored" | "failed";
  error?: string;
}

async function requireStopped(rpc: Rpc): Promise<void> {
  const status = (await rpc("game.pie.status", {}, { timeoutMs: 5_000 })) as {
    running?: boolean;
    clients?: unknown[];
  };
  if (status.running !== false || (Array.isArray(status.clients) && status.clients.length > 0)) {
    throw new Error(
      "PIE must be stopped with zero clients before changing the managed driver; external sessions are never stopped.",
    );
  }
}

async function readEnabled(rpc: Rpc, asset: HarnessAsset): Promise<boolean> {
  const reply = (await rpc("instance.read", { ActorGuid: asset.driverGuid, Depth: 0 }, { timeoutMs: 5_000 })) as {
    instance?: { Name?: unknown; InstanceType?: unknown; Enabled?: unknown };
  };
  const driver = reply.instance;
  if (
    driver?.Name !== `DiligentPlaytestDriver_${asset.name}` ||
    driver.InstanceType !== "LocalScript" ||
    typeof driver.Enabled !== "boolean"
  ) {
    throw new Error("Managed driver identity or Enabled readback is unavailable; inspect the harness before running.");
  }
  return driver.Enabled;
}

async function setEnabled(rpc: Rpc, guid: string, enabled: boolean): Promise<void> {
  await rpc("instance.update", { Instances: [{ ActorGuid: guid, Enabled: enabled }] }, { timeoutMs: 5_000 });
}

export async function withHarnessDriver<T>(
  options: PlaytestToolOptions,
  ctx: ToolContext,
  asset: HarnessAsset,
  run: () => Promise<T>,
): Promise<{ result: T; driver: DriverRestoration; warning?: string }> {
  if (!asset.driverGuid) throw new Error("Install the managed observation driver before running.");
  const rpc = withSignal(options.callRpc, ctx);
  await requireStopped(rpc);
  let originalEnabled = await readEnabled(rpc, asset);
  if (originalEnabled) {
    return {
      result: await run(),
      driver: { guid: asset.driverGuid, originalEnabled, temporarilyEnabled: false, restoration: "not_needed" },
    };
  }

  // Snapshot capture acquires this same lock; finish it before holding the lock through the owned episode.
  const warning = await options.beforeMutation?.(ctx);
  ctx.signal.throwIfAborted();
  const release = await options.writeLock?.acquire();
  let attemptedEnable = false;
  const cleanupRpc: Rpc = (method, args, callOptions) =>
    options.callRpc(method, args, { ...callOptions, signal: AbortSignal.timeout(5_000) });
  const restoration = async (): Promise<DriverRestoration> => {
    const state: DriverRestoration = {
      guid: asset.driverGuid!,
      originalEnabled,
      temporarilyEnabled: attemptedEnable,
      restoration: "not_needed",
    };
    if (!attemptedEnable) return state;
    try {
      // Cancellation must not cancel restoration. Each native cleanup call still has a bounded timeout.
      await requireStopped(cleanupRpc);
      if ((await readEnabled(cleanupRpc, asset)) !== originalEnabled) {
        await setEnabled(cleanupRpc, asset.driverGuid!, originalEnabled);
      }
      if ((await readEnabled(cleanupRpc, asset)) !== originalEnabled) {
        throw new Error("Managed driver Enabled readback does not match its original value.");
      }
      return { ...state, restoration: "restored" };
    } catch (error) {
      return { ...state, restoration: "failed", error: error instanceof Error ? error.message : String(error) };
    }
  };

  try {
    ctx.signal.throwIfAborted();
    await requireStopped(rpc);
    originalEnabled = await readEnabled(rpc, asset);
    if (!originalEnabled) {
      // An uncertain acknowledgement may still mean the write happened; never replay the enable operation.
      attemptedEnable = true;
      await setEnabled(rpc, asset.driverGuid, true);
      if (!(await readEnabled(rpc, asset)))
        throw new Error("Managed driver did not become enabled; no episode was started.");
    }
    const result = await run();
    return { result, driver: await restoration(), ...(warning ? { warning } : {}) };
  } catch (error) {
    const restored = await restoration();
    if (restored.restoration === "failed") {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)} Driver restoration failed: ${restored.error}`,
        { cause: error },
      );
    }
    throw error;
  } finally {
    release?.();
  }
}
