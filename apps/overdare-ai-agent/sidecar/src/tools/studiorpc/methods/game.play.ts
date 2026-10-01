// @summary Declares the Studio RPC method for starting or restarting a play test.
import { z } from "zod";
import type { CallRpc } from "../tools/pie-input/target";
import { confirmStopped } from "./game.stop";

export const method = "game.play";

export const description =
  "Start the OVERDARE Studio play test. Calling it while PIE is already running keeps that session; pass " +
  "restart: true to stop it first and start clean.";

export const params = z.object({
  numberOfPlayer: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Number of PIE players. Defaults to 1. Input and move tools can target another injectable client by " +
        "clientId, but UI, screenshots, camera, and game.observe read the targeted main client.",
    ),
  restart: z
    .boolean()
    .optional()
    .describe("Stop an existing play test before starting, so the game begins from a clean session."),
});
export async function preCall(args: Record<string, unknown>, callRpc: CallRpc): Promise<void> {
  if (args.restart !== true) return;
  const status = await callRpc("game.pie.status", {});
  if (!status || typeof status !== "object" || typeof (status as { running?: unknown }).running !== "boolean") {
    throw new Error(
      "Cannot restart: game.pie.status did not report running. Inspect the live session before retrying.",
    );
  }
  if (!(status as { running: boolean }).running) return;
  const stopped = await confirmStopped(await callRpc("game.stop", {}), callRpc);
  if (!stopped || typeof stopped !== "object" || (stopped as { success?: unknown }).success !== true) {
    throw new Error(
      "Cannot restart: PIE stop completion is unconfirmed. Inspect game.pie.status; do not start another session yet.",
    );
  }
}
export function normalizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const { restart: _restart, ...rest } = args;
  return rest;
}
