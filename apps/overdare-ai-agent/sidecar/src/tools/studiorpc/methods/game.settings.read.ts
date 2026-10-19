// @summary Reads saved game defaults from the edit world's Workspace and StarterPlayer.
import { z } from "zod";

export const method = "game.settings.read";
export const readOnly = true;
export const description =
  "Read the edit world's game defaults: maxPlayers, gravity, httpEnabled, gravityScale, jumpHeight, " +
  "jumpPower, useJumpPower, walkSpeed, and maxSlopeAngle. Returns a settings object. These defaults " +
  "configure subsequent play sessions; they are not live PIE character state.";
export const params = z.object({}).strict();
