// @summary Declares the Studio RPC method that creates or replaces an animation clip from JSON and saves it.
import type { ImageBlock } from "@diligent/protocol";
import { z } from "zod";
import {
  ANIMATION_TIMEOUT_MS,
  animationSchema,
  attachPreviewImage,
  dropBlank,
  formatCheckResult,
  formatWriteResult,
  groundSchema,
  isBlank,
  normalizePreview,
  pinsSchema,
  previewSchema,
  withErrorData,
} from "./animation-shared";

export const method = "animation.write";

export const timeoutMs = ANIMATION_TIMEOUT_MS;

export const description =
  "Create or fully replace an animation clip from version-1 JSON and save it as a local .uasset. Read the rig first; use modelGuid for an existing single-skin Model, or omit it for the built-in Studio character. Existing assetPath infers its original rig. " +
  "Keys are reference-pose deltas: rotation [roll,pitch,yaw] degrees about local X/Y/Z, translation cm along those axes. Missing tracks use the reference pose; replacement removes omitted tracks and keys. Native limits are 64 tracks and 4096 keys, at most 10 seconds; the name cannot change on replacement. " +
  "Replacement requires the last read/write revision. On REVISION_CONFLICT, read the current clip before merging an edit. A timed-out create may have succeeded; inspect before retrying. SAVE_FAILED can report applied=true,saved=false. " +
  "dryRun evaluates without saving or rendering, returning joints, component axes, skin heights and requested built-in-character IK solutions. pins and ground support only the built-in Studio character rig and bake into keys; replacements need their original authored keys and solver requests again. General clips retain their Skeleton/binds/weights; unsupported scale, events, additive or root-motion data are rejected. " +
  "Preview is opt-in. A preview failure does not undo a save; recapture with animation.read. Results include assetPath, revision, applied/saved/created and diagnostics. Publish the saved clip to obtain a gameplay asset ID. Use character-animation for pose and solver guidance.";

export const params = z
  .object({
    modelGuid: z
      .string()
      .optional()
      .describe(
        "Existing Workspace Model's single-skin rig for creation. Existing assetPath infers its original rig; a conflicting selector is rejected.",
      ),
    dryRun: z
      .boolean()
      .optional()
      .describe("Evaluate poses without saving or rendering. assetPath/revision are checked even in dryRun."),
    frames: z
      .array(z.number().int().min(0))
      .min(1)
      .max(24)
      .optional()
      .describe("With dryRun only: up to 24 pose frames; default up to 12 keyed frames and pin edges."),
    animation: animationSchema.describe("The whole clip in the version-1 JSON format above."),
    assetPath: z.string().optional().describe("Clip to replace. Omit to create a new clip."),
    revision: z
      .string()
      .optional()
      .describe("Required with assetPath: the revision from the last read or write of that clip."),
    preview: previewSchema
      .optional()
      .describe("Omit or false for no capture, true for the default contact sheet, or { frames, views, motion }."),
    pins: pinsSchema
      .optional()
      .describe("Hands/feet held at a fixed point over a frame range; baked into keys. Omit for none."),
    ground: groundSchema
      .optional()
      .describe(
        "Frame ranges where the body's lowest point stays on the floor; baked into LowerTorso keys. Omit for none.",
      ),
  })
  .strict()
  .refine((args) => args.frames === undefined || args.dryRun === true, {
    message: "frames requires dryRun: true",
    path: ["frames"],
  });

export function normalizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out =
    args.dryRun === true
      ? dropBlank(args, ["assetPath", "revision", "modelGuid"])
      : normalizePreview(dropBlank(args, ["assetPath", "revision", "modelGuid"]));
  if (args.dryRun === true) delete out.preview;
  if (Array.isArray(out.frames) && out.frames.length === 0) delete out.frames;
  if (Array.isArray(out.pins) && out.pins.length === 0) delete out.pins;
  if (Array.isArray(out.ground) && out.ground.length === 0) delete out.ground;
  return out;
}

export async function recover(error: unknown, args: Record<string, unknown>): Promise<unknown> {
  if (args.dryRun === true) return withErrorData(error);
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
  let parsed: unknown = result;
  if (typeof result === "string") {
    try {
      parsed = JSON.parse(result);
    } catch {
      return undefined;
    }
  }
  if (parsed && typeof parsed === "object" && "dryRun" in parsed && parsed.dryRun === true) return undefined;
  return attachPreviewImage(result);
}

export function postProcess(result: unknown): unknown {
  if (result && typeof result === "object" && "dryRun" in result && result.dryRun === true)
    return formatCheckResult(result);
  return formatWriteResult(result);
}
