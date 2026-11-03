// @summary Declares the Studio RPC method that uploads an animation clip to OVERDARE and returns its ovdrassetid.
import { z } from "zod";
import { dropBlank, withErrorData } from "./animation-shared";

export const method = "animation.publish";

/** Upload, thumbnail capture and the Creator Hub requests run one after another; measured in seconds, not ms. */
export const timeoutMs = 180_000;

export const description =
  "Upload a saved animation as a new private MY ASSETS entry and return its numeric ovdrassetid://N. General clips retain their original Skeleton. Requires Studio login; no store listing or Creator Hub page is created. " +
  "Pass the last read/write revision to publish that version; unsaved AnimationEditor edits are saved first and a conflict rejects a stale revision. Every call uploads a new copy and ID; existing published IDs remain unchanged. " +
  "Result: assetPath, revision, assetId, worldAssetId and name. Use assetId for Animation.AnimationId or an Action Sequence AnimationTrack.OvdrAssetId.";

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
