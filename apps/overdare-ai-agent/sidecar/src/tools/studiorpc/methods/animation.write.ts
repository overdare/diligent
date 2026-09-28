// @summary Declares the Studio RPC method that creates or replaces an animation clip from JSON and saves it.
import type { ImageBlock } from "@diligent/protocol";
import { z } from "zod";
import {
  ANIMATION_TIMEOUT_MS,
  animationSchema,
  attachPreviewImage,
  normalizePreview,
  previewSchema,
  withErrorData,
} from "./animation-shared";

export const method = "animation.write";

export const timeoutMs = ANIMATION_TIMEOUT_MS;

export const description =
  "Create or replace a character animation clip from JSON, save it as a local .uasset, and return a preview " +
  "contact sheet. Get bone names and axes first from studiorpc_animation_read with no assetPath.\n" +
  "Workflow: write without assetPath to create a clip under /Temp/AnimationAssets/<name> (a suffix is added if " +
  "the name is taken; use the returned assetPath and animation.name). Look at the image and " +
  "preview.poseSamples, edit the JSON, then write again with assetPath and the revision from your last " +
  "read/write. A replace rewrites the whole clip: tracks and keys you leave out are removed. revision is " +
  "required on replace; REVISION_CONFLICT means the clip changed since you read it — call studiorpc_animation_read, " +
  "reapply your edit to the returned animation, and write with the new revision. After a timeout, do not repeat " +
  "a create: it may have succeeded.\n" +
  "JSON (version 1): { version: 1, name, fps: 30 | 60, durationFrames: N, tracks: { <boneName>: [ { frame, " +
  "rotation?, translation? } ] } }.\n" +
  "- Length is N/fps s, at most 10 s. frame is an integer 0..N, strictly ascending and unique per track. Keys " +
  "are interpolated linearly; scale is always 1.\n" +
  "- rotation = [roll, pitch, yaw] degrees about the bone's own reference axes (roll = X, pitch = Y, yaw = Z); " +
  "translation = [x, y, z] cm along those axes. Both are deltas from the bone's reference pose and default to " +
  "[0, 0, 0], which is the reference pose.\n" +
  "- Bones not in tracks stay in the reference pose; tracks: {} is a reference-pose clip; a track needs at " +
  "least one key. Limits: 64 tracks, 1024 keys total. name matches [A-Za-z][A-Za-z0-9_]{0,63} and cannot " +
  "change on replace. Unknown fields, wrong array lengths and non-numbers are rejected; nothing is clamped " +
  "or re-sorted.\n" +
  "preview: omitted or true = default contact sheet (frames 0, N/4, N/2, 3N/4, N; both views), false = none, " +
  '{ frames: [up to 8], views: ["front", "side"] } = those. The PNG comes back as an image: rows = views ' +
  "(front first, then side), columns = frames in order. preview.poseSamples gives animated bones' " +
  "component-space translation (cm) and rotationQuat [x,y,z,w] per frame. A failed preview does not undo the " +
  "save; re-capture with studiorpc_animation_read.\n" +
  "Result: { assetPath, filePath, revision, animation (canonical), applied, saved, created, preview, warnings }. " +
  "Errors carry data.kind (INVALID_ANIMATION, INVALID_PARAMS, REVISION_CONFLICT, UNSUPPORTED_REPRESENTATION, " +
  "ASSET_NOT_FOUND, SAVE_FAILED, APPLY_FAILED) and data.errors[] with path, bone, frame and message. Invalid " +
  "input and conflicts leave the asset unchanged; SAVE_FAILED reports applied and saved as they are.";

export const params = z
  .object({
    animation: animationSchema.describe("The whole clip in the version-1 JSON format above."),
    assetPath: z.string().min(1).optional().describe("Clip to replace. Omit to create a new clip."),
    revision: z
      .string()
      .min(1)
      .optional()
      .describe("Required with assetPath: the revision from the last read or write of that clip."),
    preview: previewSchema
      .optional()
      .describe("Omit or true for the default contact sheet, false for none, or { frames, views }."),
  })
  .strict();

export function normalizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  return normalizePreview(args);
}

export async function recover(error: unknown, args: Record<string, unknown>): Promise<unknown> {
  return withErrorData(
    error,
    args.assetPath === undefined
      ? "The create may still have completed in Studio. Do not repeat it blindly; ask the user or check " +
          "/Temp/AnimationAssets before writing again."
      : "The replace may still have completed in Studio. Call studiorpc_animation_read with this assetPath " +
          "and compare the revision before writing again.",
  );
}

export async function attachImages(result: unknown): Promise<ImageBlock[] | undefined> {
  return attachPreviewImage(result);
}
