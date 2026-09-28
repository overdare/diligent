// @summary Declares the Studio RPC method that reads the character rig or an animation clip as JSON.
import type { ImageBlock } from "@diligent/protocol";
import { z } from "zod";
import {
  ANIMATION_TIMEOUT_MS,
  attachPreviewImage,
  normalizePreview,
  previewSchema,
  withErrorData,
} from "./animation-shared";

export const method = "animation.read";

export const readOnly = true;

export const timeoutMs = ANIMATION_TIMEOUT_MS;

export const description =
  "Read the character rig, or an animation clip as editable JSON. Nothing is created or changed.\n" +
  "Without assetPath (start here): returns `rig`, `template` and `limits`. `rig.bones[]` has name, parent, " +
  "editable, refLocal (reference local transform) and refComponent, whose axisX/axisY/axisZ are the bone's own " +
  "axes in component space. Use bone names exactly as listed, and check a bone's axes before deciding which " +
  "rotation component bends it the way you want. `template` is a valid empty animation to start from. " +
  "`preview` is not allowed without assetPath.\n" +
  "With assetPath: returns { assetPath, filePath, revision, animation, preview? }. `animation` is in the " +
  "studiorpc_animation_write format; send it back edited, with this `revision` unchanged. Use this to see the " +
  "clip's current state (a person may have edited it in the AnimationEditor) and after REVISION_CONFLICT.\n" +
  "No image unless you pass `preview`: true = default frames (0, N/4, N/2, 3N/4, N) and both views; or " +
  '{ frames: [up to 8 integer frames], views: ["front", "side"] } to look closely at specific frames. ' +
  "The PNG comes back as an image: rows = views (front first, then side), columns = frames in order, each " +
  "cell labeled with its frame. preview.poseSamples lists, per sampled frame, each animated bone's " +
  "componentTranslationCm and rotationQuat [x,y,z,w] in component space — numbers to confirm a pose changed, " +
  "not authoring values. preview.status is completed, skipped or failed (see preview.diagnostic).";

export const params = z
  .object({
    assetPath: z
      .string()
      .min(1)
      .optional()
      .describe("Clip to read, as returned by studiorpc_animation_write. Omit to get the rig and a template."),
    preview: previewSchema
      .optional()
      .describe("Only with assetPath. true for the default contact sheet, or { frames, views }. Omit for none."),
  })
  .strict();

export function normalizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  return normalizePreview(args);
}

export async function recover(error: unknown): Promise<unknown> {
  return withErrorData(error);
}

export async function attachImages(result: unknown): Promise<ImageBlock[] | undefined> {
  return attachPreviewImage(result);
}
