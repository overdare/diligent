// @summary Updates a validated patch of game defaults and preserves unspecified settings.
import { z } from "zod";

export const method = "game.settings.update";
export const description =
  "Update the edit world's game defaults with a partial patch and save the level. Unspecified values " +
  "are preserved. Returns the resulting settings. Distances are centimeters, walkSpeed is cm/s, " +
  "gravity is cm/s², and maxSlopeAngle is degrees. useJumpPower selects jump power versus jump height. " +
  "Settings apply to subsequent play sessions, not existing live PIE players.";
const nonNegativeFloat = z.number().finite().min(0).max(3.4028234663852886e38);
export const params = z
  .object({
    maxPlayers: z.number().int().min(1).max(20).optional(),
    gravity: nonNegativeFloat.optional(),
    httpEnabled: z.boolean().optional(),
    gravityScale: nonNegativeFloat.optional(),
    jumpHeight: nonNegativeFloat.optional(),
    jumpPower: nonNegativeFloat.optional(),
    useJumpPower: z.boolean().optional(),
    walkSpeed: nonNegativeFloat.optional(),
    maxSlopeAngle: z.number().finite().min(0).max(89).optional(),
  })
  .strict()
  .refine((args) => Object.values(args).some((value) => value !== undefined), {
    message: "Provide at least one game setting to update.",
  });
