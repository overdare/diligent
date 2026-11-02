// @summary Declares the Studio RPC method for starting or restarting a play test.
import { z } from "zod";
import type { CallRpc } from "../tools/pie-input/target";

export const method = "game.play";

export const description =
  "Start the OVERDARE Studio play test. Calling it while PIE is already running keeps that session; pass " +
  "restart: true to stop it first and start clean. Choose mobileSimulator when starting a stopped session. " +
  "Omit separateServer for ordinary playtesting; process separation is only for controlled precision performance measurements.";

export const params = z
  .object({
    mobileSimulator: z
      .boolean()
      .optional()
      .describe(
        "Enable or disable the mobile simulator for the next play session. The device is fixed to Galaxy A04e with " +
          "Actual Resolution. Omit to preserve Studio's selection. Use restart: true to change it during a running session. " +
          "Cannot be combined with addClient: true.",
      ),
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
    separateServer: z
      .boolean()
      .optional()
      .describe(
        "Use only for controlled precision performance measurements, not ordinary playtesting. true starts a separate headless dedicated server for this PIE session; false forces one-process PIE; omission preserves Studio configuration. " +
          "Save intended changes with the level-save tool first; this tool does not save them automatically. It waits for verified server readiness before starting clients. " +
          "An accepted request is asynchronous: poll studiorpc_game_pie_status for server.state and clients; game.stop also cancels startup. " +
          "Choose it only when starting stopped PIE, or combine with restart: true. Cannot be combined with addClient: true. " +
          "Separate-process PIE restricts existing input/observation tools; external server performance currently includes OS CPU/memory only, not Lua scopes or server tick timing.",
      ),
    restart: z
      .boolean()
      .optional()
      .describe("Stop an existing play test before starting, so the game begins from a clean session."),
  })
  .strict()
  .refine(
    (args) =>
      args.addClient !== true ||
      (args.numberOfPlayer === undefined &&
        args.mobileSimulator === undefined &&
        args.separateServer === undefined &&
        args.restart !== true),
    {
      message: "addClient: true cannot be combined with numberOfPlayer, mobileSimulator, separateServer, or restart: true.",
    },
  );
export async function preCall(args: Record<string, unknown>, callRpc: CallRpc): Promise<void> {
  if (args.restart !== true) return;
  await callRpc("game.stop", {});
}
export function normalizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const { restart: _restart, ...rest } = args;
  return rest;
}
