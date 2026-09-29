// @summary Declares the Studio RPC method that creates or replaces an animation clip from JSON and saves it.
import type { ImageBlock } from "@diligent/protocol";
import { z } from "zod";
import {
  ANIMATION_TIMEOUT_MS,
  animationSchema,
  attachPreviewImage,
  dropBlank,
  formatWriteResult,
  isBlank,
  normalizePreview,
  pinsSchema,
  previewSchema,
  withErrorData,
} from "./animation-shared";

export const method = "animation.write";

export const timeoutMs = ANIMATION_TIMEOUT_MS;

export const description =
  "Create or replace a character animation clip from JSON, save it as a local .uasset, and return a preview " +
  "contact sheet. Get bone names and axes first from studiorpc_animation_read with no assetPath.\n" +
  "Workflow: write without assetPath to create a clip under /Temp/AnimationAssets/<name> (a suffix is added if " +
  "the name is taken; use the returned assetPath and animation.name). Look at the image, preview.floor and " +
  "preview.poseSamples, edit the JSON, then write again with assetPath and the revision from your last " +
  "read/write. A replace rewrites the whole clip: tracks and keys you leave out are removed. revision is " +
  "required on replace; REVISION_CONFLICT means the clip changed since you read it — call studiorpc_animation_read, " +
  "reapply your edit to the returned animation, and write with the new revision. After a timeout, do not repeat " +
  "a create: it may have succeeded. Leave optional params out when you do not use them.\n" +
  "JSON (version 1): { version: 1, name, fps: 30 | 60, durationFrames: N, tracks: { <boneName>: [ { frame, " +
  "rotation?, translation?, interp? } ] } }.\n" +
  "- Length is N/fps s, at most 10 s. frame is an integer 0..N, strictly ascending and unique per track. " +
  "scale is always 1.\n" +
  "- interp sets how the motion leaves a key: linear (default, constant speed, mechanical), cubic (eases in and " +
  "out; use it for natural motion such as swings, weight shifts and holds that settle), constant (snaps at the " +
  "next key). Cubic tangents are automatic from the neighbouring keys, exactly like the AnimationEditor's Cubic key.\n" +
  "- rotation = [roll, pitch, yaw] degrees about the bone's own reference axes (roll = X, pitch = Y, yaw = Z); " +
  "translation = [x, y, z] cm along those axes. Both are deltas from the bone's reference pose and default to " +
  "[0, 0, 0], which is the reference pose.\n" +
  "- Bones not in tracks stay in the reference pose; tracks: {} is a reference-pose clip; a track needs at " +
  "least one key. Limits: 64 tracks, 4096 keys total. name matches [A-Za-z][A-Za-z0-9_]{0,63} and cannot " +
  "change on replace. Unknown fields, wrong array lengths and non-numbers are rejected; nothing is clamped " +
  "or re-sorted.\n" +
  "pins: [{ bone: RightHand | LeftHand | RightFoot | LeftFoot, frames: [from, to], position?: [x, y, z], flat? }] keep " +
  "that hand or foot fixed at one component-space point (cm; default: where it is at `from`) while the rest of " +
  "the body moves: a planted foot, a hand supporting the body on the floor. Studio solves the upper/lower limb " +
  "and the hand/foot on every frame of the range (keeping the elbow/knee bend side), writes those as keys, and " +
  "keeps the pose you keyed just outside the range. The saved clip contains only keys; on a replace, send your own " +
  "keys and the same pins again and they are baked again. result.pins reports maxErrorCm and outOfReachFrames per pin. flat: true (feet " +
  "only) plants the foot flat with the sole on the floor at its heading on `from` (walking, standing, squats); " +
  "without it the foot keeps the tilt and height it has at `from`. For a hand on the floor, set position z from " +
  "preview.floor (raise it by the reported maxDepthCm when the hand sinks).\n" +
  "preview: omitted or true = default contact sheet (frames 0, N/4, N/2, 3N/4, N; both views; MOTION column), " +
  'false = none, { frames: [up to 12], views: ["front", "side"], motion: true | false } = those. The PNG comes ' +
  "back as an image: rows = views (front first, then side), columns = frames in order, then MOTION (the clip " +
  "onion-skinned, earlier = fainter, with paths: right hand red, left hand blue, right foot orange, left foot " +
  "cyan, head yellow). preview.floor checks the skinned mesh against the floor (z = 0) on every frame: " +
  "belowFloor (sinking, with depth and bone), airborne, contacts (bone -> frame ranges on the floor). " +
  "preview.poseSamples gives animated bones' component-space translation (cm), rotationQuat [x,y,z,w], lowestCm " +
  "and touchingFloor per sampled frame. A failed preview does not undo the save; re-capture with " +
  "studiorpc_animation_read.\n" +
  "Result: { assetPath, filePath, revision, animation (name, fps, durationFrames and track/key counts; the " +
  "saved keys come from studiorpc_animation_read), applied, saved, created, pins?, preview, " +
  "warnings }. Errors carry data.kind (INVALID_ANIMATION, INVALID_PARAMS, REVISION_CONFLICT, " +
  "UNSUPPORTED_REPRESENTATION, ASSET_NOT_FOUND, SAVE_FAILED, APPLY_FAILED) and data.errors[] with path, bone, " +
  "frame and message. Invalid input and conflicts leave the asset unchanged; SAVE_FAILED reports applied and " +
  "saved as they are.";

export const params = z
  .object({
    animation: animationSchema.describe("The whole clip in the version-1 JSON format above."),
    assetPath: z.string().optional().describe("Clip to replace. Omit to create a new clip."),
    revision: z
      .string()
      .optional()
      .describe("Required with assetPath: the revision from the last read or write of that clip."),
    preview: previewSchema
      .optional()
      .describe("Omit or true for the default contact sheet, false for none, or { frames, views, motion }."),
    pins: pinsSchema
      .optional()
      .describe("Hands/feet held at a fixed point over a frame range; baked into keys. Omit for none."),
  })
  .strict();

export function normalizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out = normalizePreview(dropBlank(args, ["assetPath", "revision"]));
  if (Array.isArray(out.pins) && out.pins.length === 0) delete out.pins;
  return out;
}

export async function recover(error: unknown, args: Record<string, unknown>): Promise<unknown> {
  return withErrorData(
    error,
    args.assetPath === undefined || isBlank(args.assetPath)
      ? "The create may still have completed in Studio. Do not repeat it blindly; ask the user or check " +
          "/Temp/AnimationAssets before writing again."
      : "The replace may still have completed in Studio. Call studiorpc_animation_read with this assetPath " +
          "and compare the revision before writing again.",
  );
}

export async function attachImages(result: unknown): Promise<ImageBlock[] | undefined> {
  return attachPreviewImage(result);
}

export function postProcess(result: unknown): unknown {
  return formatWriteResult(result);
}
