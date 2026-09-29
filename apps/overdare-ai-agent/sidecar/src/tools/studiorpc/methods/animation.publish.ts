// @summary Declares the Studio RPC method that uploads an animation clip to OVERDARE and returns its ovdrassetid.
import { z } from "zod";
import { dropBlank, withErrorData } from "./animation-shared";

export const method = "animation.publish";

/** Upload, thumbnail capture and the Creator Hub requests run one after another; measured in seconds, not ms. */
export const timeoutMs = 180_000;

export const description =
  "Upload a saved animation clip to OVERDARE, like the AnimationEditor's Get Asset Id button, and return its " +
  "asset id. Use the returned assetId (ovdrassetid://N) wherever an animation id is needed: an Action Sequence " +
  "AnimationTrack's OvdrAssetId, an Animation instance's AnimationId in scripts.\n" +
  "This only issues the id: the clip goes to the user's own asset list (MY ASSETS), private. It is not listed on " +
  "the asset store and no Creator Hub page is opened (the button opens one for listing details; skip it).\n" +
  "assetPath is a clip from studiorpc_animation_write or studiorpc_animation_read. Pass the revision you last " +
  "looked at to publish exactly that version (REVISION_CONFLICT if the clip changed since); unsaved AnimationEditor " +
  "edits are saved first. Every call uploads a new copy with a new id; the clip itself stays editable, and an " +
  "edit needs another publish to reach the id. Studio must be logged in.\n" +
  "Result: { assetPath, revision (the published version), assetId, worldAssetId, name }. Errors carry data.kind " +
  "(INVALID_PARAMS, ASSET_NOT_FOUND, REVISION_CONFLICT, SAVE_FAILED, PUBLISH_FAILED) and the message.";

export const params = z
  .object({
    assetPath: z.string().min(1).describe("Clip to publish, e.g. /Temp/AnimationAssets/JinCombo.JinCombo."),
    revision: z
      .string()
      .optional()
      .describe("Revision from your last read/write of the clip. Omit to publish whatever is saved now."),
  })
  .strict();

export function normalizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  return dropBlank(args, ["revision"]);
}

export async function recover(error: unknown): Promise<unknown> {
  return withErrorData(
    error,
    "The upload may still have finished in Studio and produced an id. Publishing again creates a second asset; " +
      "ask the user to check the Studio log (animation.publish ... ->) before retrying.",
  );
}
