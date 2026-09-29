// @summary Declares the Studio RPC method that reads the character rig or an animation clip as JSON.
import type { ImageBlock } from "@diligent/protocol";
import { z } from "zod";
import {
  ANIMATION_TIMEOUT_MS,
  attachPreviewImage,
  dropBlank,
  formatAnimationResult,
  normalizePreview,
  previewSchema,
  withErrorData,
} from "./animation-shared";

export const method = "animation.read";

export const readOnly = true;

export const timeoutMs = ANIMATION_TIMEOUT_MS;

export const description =
  "Read the character rig, or an animation clip as editable JSON. Nothing is created or changed.\n" +
  "Without assetPath (start here): returns `rig`, `template`, `limits` and `animations` (asset paths of the " +
  "clips that already exist). `rig.bones[]` has name, parent, editable, refLocal (reference local transform) and " +
  "refComponent, whose axisX/axisY/axisZ are the bone's own axes in component space. Use bone names exactly as " +
  "listed, and check a bone's axes before deciding which rotation component bends it the way you want. " +
  "`template` is a valid empty animation to start from. You do not need an asset name to create a clip: " +
  "studiorpc_animation_write without assetPath creates one.\n" +
  "With assetPath: returns { assetPath, filePath, revision, animation, preview? }. `animation` is in the " +
  "studiorpc_animation_write format; send it back edited, with this `revision` unchanged. Use this to see the " +
  "clip's current state (a person may have edited it in the AnimationEditor) and after REVISION_CONFLICT.\n" +
  "No image unless you pass `preview` with assetPath: true = default frames (0, N/4, N/2, 3N/4, N), both views " +
  'and a MOTION column; or { frames: [up to 12 integer frames], views: ["front", "side"], motion: false } to ' +
  "look closely at specific frames. Leave optional fields out when you do not use them (blank strings and " +
  "preview false count as not given). The PNG comes back as an image: rows = views (front first, then side), " +
  "columns = frames in order (each labeled), then MOTION: the clip onion-skinned (earlier = fainter) with the " +
  "paths of right hand (red), left hand (blue), right foot (orange), left foot (cyan), head (yellow). " +
  "preview.floor checks the skinned mesh against the floor (z = 0) on every frame: belowFloor ranges (sinking), " +
  "airborne ranges, and contacts = which bones touch the floor on which frames. preview.poseSamples lists, per " +
  "sampled frame, animated bones' componentTranslationCm, rotationQuat [x,y,z,w], lowestCm and touchingFloor. " +
  "preview.status is completed, skipped or failed (see preview.diagnostic).";

export const params = z
  .object({
    assetPath: z
      .string()
      .optional()
      .describe("Clip to read, as returned by studiorpc_animation_write. Omit to get the rig and a template."),
    preview: previewSchema
      .optional()
      .describe(
        "Only with assetPath. true for the default contact sheet, or { frames, views, motion }. Omit or false for none.",
      ),
  })
  .strict();

export function normalizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  return normalizePreview(dropBlank(args, ["assetPath"]));
}

export async function recover(error: unknown): Promise<unknown> {
  return withErrorData(error);
}

export async function attachImages(result: unknown): Promise<ImageBlock[] | undefined> {
  return attachPreviewImage(result);
}

export function postProcess(result: unknown): unknown {
  return formatAnimationResult(result);
}
