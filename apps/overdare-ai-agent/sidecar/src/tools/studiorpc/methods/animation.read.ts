// @summary Declares the Studio RPC method that reads the character rig or an animation clip as JSON.
import type { ImageBlock } from "@diligent/protocol";
import { z } from "zod";
import {
  ANIMATION_TIMEOUT_MS,
  attachPreviewImage,
  dropBlank,
  formatRigResult,
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
  "clips that already exist). `rig.bones[]` lists the bones you can animate: name, parent, refLocal.translation " +
  "and refComponent (translation, and axisX/axisY/axisZ = the bone's own axes in component space); " +
  "`rig.notAnimatable` names the IK, camera and item bones. Use bone names exactly as " +
  "listed, and check a bone's axes before deciding which rotation component bends it the way you want. " +
  "`template` is a valid empty animation to start from. You do not need an asset name to create a clip: " +
  "studiorpc_animation_write without assetPath creates one.\n" +
  "With assetPath: returns { assetPath, filePath, revision, animation, preview? }. `animation` is in the " +
  "studiorpc_animation_write format; send it back edited, with this `revision` unchanged. Use this to see the " +
  "clip's current state (a person may have edited it in the AnimationEditor) and after REVISION_CONFLICT.\n" +
  "With assetId (ovdrassetid://N, e.g. from an Action Sequence AnimationTrack) instead of assetPath: opens that " +
  "animation for editing and adds `source` { assetId, openedFrom, note }. An id published from this project opens " +
  'the clip it was published from (openedFrom "published clip"); any other id is downloaded once into an editable ' +
  'copy /Temp/AnimationAssets/Asset_<id> (openedFrom "copy", keys baked per frame where the motion needs them). ' +
  "Edit it with studiorpc_animation_write and the returned assetPath; the id keeps pointing at the old version " +
  "until you publish again and put the new id where the old one was used.\n" +
  "No image unless you pass `preview` with assetPath or assetId: true = default frames (0, N/4, N/2, 3N/4, N), both views " +
  'and a MOTION column; or { frames: [up to 12 integer frames], views: ["front", "side"], motion: false } to ' +
  "look closely at specific frames. Leave optional fields out when you do not use them (blank strings and " +
  "preview false count as not given). The PNG comes back as an image: rows = views (front first, then side), " +
  "columns = frames in order (each labeled), then MOTION: the clip onion-skinned (earlier = fainter) with the " +
  "paths of right hand (red), left hand (blue), right foot (orange), left foot (cyan), head (yellow). " +
  "preview.floor checks the skinned mesh against the floor (z = 0) on every frame: belowFloor ranges (sinking), " +
  "airborne ranges, and contacts = which bones touch the floor on which frames. " +
  "preview.clearance lists frame ranges where a hand, forearm, shin or foot sinks into the head, torso or a " +
  "thigh (part, into, maxDepthCm, deepestFrame; a shin or foot is not checked against its own thigh). " +
  "preview.poseSamples lists, per " +
  "sampled frame, animated bones' componentTranslationCm, rotationQuat [x,y,z,w], lowestCm and touchingFloor. " +
  "preview.status is completed, skipped or failed (see preview.diagnostic).";

export const params = z
  .object({
    assetPath: z
      .string()
      .optional()
      .describe("Clip to read, as returned by studiorpc_animation_write. Omit to get the rig and a template."),
    assetId: z
      .string()
      .optional()
      .describe("Instead of assetPath: an animation id, ovdrassetid://N, to open for editing."),
    preview: previewSchema
      .optional()
      .describe(
        "Only with assetPath or assetId. true for the default contact sheet, or { frames, views, motion }. Omit or false for none.",
      ),
  })
  .strict();

export function normalizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  return normalizePreview(dropBlank(args, ["assetPath", "assetId"]));
}

export async function recover(error: unknown): Promise<unknown> {
  return withErrorData(error);
}

export async function attachImages(result: unknown): Promise<ImageBlock[] | undefined> {
  return attachPreviewImage(result);
}

export function postProcess(result: unknown): unknown {
  return formatRigResult(result);
}
