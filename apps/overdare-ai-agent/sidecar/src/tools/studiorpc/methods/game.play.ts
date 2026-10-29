// @summary Declares the Studio RPC method for starting or restarting a play test.
import { z } from "zod";
import type { CallRpc } from "../tools/pie-input/target";

export const method = "game.play";

export const description =
  "Start the OVERDARE Studio play test. Calling it while PIE is already running keeps that session; pass " +
  "restart: true to stop it first and start clean.";

export const params = z
  .object({
    addClient: z
      .boolean()
      .optional()
      .describe(
        "Add one client to the running PIE session without restarting. Cannot be combined with numberOfPlayer or restart: true. " +
          "An accepted request queues a client addition; use studiorpc_game_pie_status to wait for it. Do not retry an accepted request.",
      ),
    numberOfPlayer: z
      .number()
      .int()
      .positive()
      .max(8)
      .optional()
      .describe(
        "Number of PIE players when starting a stopped session (1–8, independent of the world's maxPlayers). Omit to keep Studio's configured player count. " +
          "Input and move tools can target another injectable client by " +
          "clientId. game.observe can read that client when pieSessionId and clientId are supplied together.",
      ),
    restart: z
      .boolean()
      .optional()
      .describe("Stop an existing play test before starting, so the game begins from a clean session."),
  })
  .strict()
  .refine((args) => args.addClient !== true || (args.numberOfPlayer === undefined && args.restart !== true), {
    message: "addClient: true cannot be combined with numberOfPlayer or restart: true.",
  });
export async function preCall(args: Record<string, unknown>, callRpc: CallRpc): Promise<void> {
  if (args.restart !== true) return;
  await callRpc("game.stop", {});
}
export function normalizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const { restart: _restart, ...rest } = args;
  return rest;
}
