import { z } from "zod";
import type { CallRpc } from "../tools/pie-input/target";

export const method = "game.stop";

export const description =
  "Stop the currently playing game and confirm PIE is no longer running. A delayed stop returns stopPending with success=false; inspect PIE status before editing or starting another session.";

export const params = z.object({});

interface StopConfirmationOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export async function confirmStopped(
  result: unknown,
  callRpc: CallRpc,
  options: StopConfirmationOptions = {},
): Promise<unknown> {
  if (!result || typeof result !== "object" || (result as { success?: unknown }).success !== true) return result;
  const deadline = Date.now() + (options.timeoutMs ?? 5_000);
  const pollInterval = options.pollIntervalMs ?? 100;
  while (true) {
    const status = await callRpc("game.pie.status", {}, { timeoutMs: Math.max(1, deadline - Date.now()) });
    if (!status || typeof status !== "object" || typeof (status as { running?: unknown }).running !== "boolean") {
      throw new Error(
        "game.stop was accepted, but game.pie.status did not report running. Completion is unconfirmed; inspect PIE status before editing or restarting.",
      );
    }
    const observed = status as { running: boolean; pieSessionId?: string; state?: string };
    if (!observed.running) return { ...result, success: true, running: false, status: "stopped" };
    const remaining = deadline - Date.now();
    if (remaining <= 0)
      return {
        ...result,
        success: false,
        status: "stopPending",
        running: true,
        pieSessionId: observed.pieSessionId,
        state: observed.state,
      };
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollInterval, remaining)));
  }
}

export async function postProcess(result: unknown, _args: Record<string, unknown>, callRpc: CallRpc): Promise<unknown> {
  return confirmStopped(result, callRpc);
}
