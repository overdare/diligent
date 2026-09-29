// @summary Shared schemas and result/error handling for the animation.read / animation.write Studio RPCs.
import { readFile } from "node:fs/promises";
import type { ImageBlock } from "@diligent/protocol";
import { z } from "zod";
import { isRecord } from "../camera-response";
import { StudioRpcError } from "../rpc";

/** Capture renders several frames and two views; the default 10 s RPC timeout is too short. */
export const ANIMATION_TIMEOUT_MS = 120_000;

const vec3 = (unit: string) => z.array(z.number().finite()).length(3).describe(unit);

const animationKey = z
  .object({
    frame: z.number().int().min(0).describe("Integer frame, 0..durationFrames. Strictly ascending within a track."),
    rotation: vec3("[roll, pitch, yaw] degrees, delta from the bone reference pose. Default [0,0,0].").optional(),
    translation: vec3("[x, y, z] cm, delta in the bone reference local axes. Default [0,0,0].").optional(),
    interp: z
      .enum(["linear", "cubic", "constant"])
      .optional()
      .describe(
        "How the motion leaves this key toward the next one. linear (default), cubic = smooth ease with automatic " +
          "tangents (what the AnimationEditor's Cubic key menu sets), constant = hold until the next key.",
      ),
  })
  .strict();

/**
 * Structural check of the version-1 animation JSON. Studio is the real validator
 * (bone names, frame range and order, limits); this only catches malformed input
 * early with a path. Nothing is defaulted or coerced — the object goes to Studio as given.
 */
export const animationSchema = z
  .object({
    version: z.literal(1),
    name: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/)
      .describe("Asset name. Must equal the current name when replacing."),
    fps: z.union([z.literal(30), z.literal(60)]),
    durationFrames: z.number().int().min(1).max(600).describe("N. Length is N/fps seconds, at most 10 s."),
    tracks: z
      .record(z.string().min(1), z.array(animationKey).min(1))
      .describe("Bone name -> non-empty key array. {} is a reference-pose clip."),
  })
  .strict();

const previewOptions = z
  .object({
    frames: z
      .array(z.number().int().min(0))
      .max(12)
      .optional()
      .describe("Frames to render, one column each, in this order. Default 0, N/4, N/2, 3N/4, N."),
    views: z
      .array(z.enum(["front", "side"]))
      .max(2)
      .optional()
      .describe("Rows to render. Default both."),
    motion: z
      .boolean()
      .optional()
      .describe(
        "Default true: one more MOTION column per view with the whole clip onion-skinned and the paths of the hands " +
          "(right red, left blue), feet (right orange, left cyan) and head (yellow).",
      ),
  })
  .strict();

/**
 * Pins keep a hand or foot at one component-space point over a frame range (a planted foot, a hand on the
 * floor while the body turns). Studio bakes them into keys on the limb's upper, lower and end bones.
 */
export const pinsSchema = z
  .array(
    z
      .object({
        bone: z.enum(["RightHand", "LeftHand", "RightFoot", "LeftFoot"]),
        frames: z.array(z.number().int().min(0)).length(2).describe("[from, to], inclusive."),
        position: vec3("[x, y, z] component cm. Omit to hold the point where the effector is at `from`.").optional(),
        flat: z
          .boolean()
          .optional()
          .describe("Feet only: the foot lies flat on the floor (sole at z = 0) keeping its heading at `from`."),
      })
      .strict(),
  )
  .max(8);

/** Whitespace and invisible characters some models put in optional strings they were forced to fill. */
export function isBlank(value: unknown): boolean {
  return typeof value === "string" && value.replace(/\s|\u200b|\u200c|\u200d|\ufeff|\u00a0/g, "") === "";
}

/** Drops blank optional strings so they read as "not given". */
export function dropBlank(args: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out = { ...args };
  for (const key of keys) {
    if (isBlank(out[key])) delete out[key];
  }
  return out;
}

/**
 * `true` is a wrapper-side alias for the contract's `{}` (default capture). It exists because
 * the tool loops drop an empty object on an optional parameter as "not given", so `{}` would
 * never reach Studio — and on animation.read "not given" means no capture at all.
 */
export const previewSchema = z.union([z.boolean(), previewOptions]);

export function normalizePreview(args: Record<string, unknown>): Record<string, unknown> {
  if (args.preview !== true) return args;
  return { ...args, preview: {} };
}

/**
 * Output text for a read/write result. The generic 2-space JSON puts every number on its own line, and a write
 * with pins bakes a key per frame, so a result reached ~100 KB: the host truncated it, dropped the contact sheet
 * and cut off preview.floor. Here the short fields come first, then poseSamples one line per frame (numbers
 * rounded to 0.001), then the
 * animation one line per track. Still valid JSON (attachPreviewImage parses it back).
 */
export function formatAnimationResult(result: unknown): unknown {
  if (!isRecord(result)) return result;
  const { animation, preview, ...rest } = result;
  const posePlaceholder = "__ANIMATION_POSE_SAMPLES__";
  const animationPlaceholder = "__ANIMATION_DOCUMENT__";
  let poseSamples: unknown[] | undefined;
  let previewOut: unknown = isRecord(preview) ? trimPreview(preview) : preview;
  if (isRecord(previewOut) && Array.isArray(previewOut.poseSamples)) {
    const { poseSamples: samples, ...shortPreview } = previewOut;
    poseSamples = samples as unknown[];
    previewOut = { ...shortPreview, poseSamples: posePlaceholder };
  }
  const ordered: Record<string, unknown> = { ...rest };
  if (previewOut !== undefined) ordered.preview = previewOut;
  if (animation !== undefined) ordered.animation = animationPlaceholder;
  let text = JSON.stringify(ordered, null, 2);
  if (poseSamples) {
    const lines = poseSamples.map((sample) => `      ${JSON.stringify(sample, roundForReading)}`).join(",\n");
    text = text.replace(`"${posePlaceholder}"`, () => `[\n${lines}\n    ]`);
  }
  if (animation !== undefined) {
    text = text.replace(`"${animationPlaceholder}"`, () => compactAnimation(animation));
  }
  return text;
}

/** Compression error the runtime playback can show; below it the comparison only costs the agent tokens. */
const COMPRESSION_NOTICE_CM = 0.5;
const COMPRESSION_NOTICE_DEG = 1;

/**
 * The capture cameras are for debugging the sheet, and a completed compression check within a fraction of a cm
 * and a degree says nothing the agent acts on. Both are dropped; compression stays when it failed or is large.
 */
function trimPreview(preview: Record<string, unknown>): Record<string, unknown> {
  const { cameras: _cameras, compression, ...rest } = preview;
  const quiet =
    isRecord(compression) &&
    compression.status === "completed" &&
    typeof compression.maxTranslationErrorCm === "number" &&
    typeof compression.maxRotationErrorDeg === "number" &&
    compression.maxTranslationErrorCm <= COMPRESSION_NOTICE_CM &&
    compression.maxRotationErrorDeg <= COMPRESSION_NOTICE_DEG;
  return compression === undefined || quiet ? rest : { ...rest, compression };
}

/**
 * A write saves the keys the agent sent plus a key per frame for every limb bone a pin baked, and echoing them
 * back pushed results past the host's 25k-token output limit. The agent sends its own keys and the same pins on
 * the next replace, so the write result carries only counts; studiorpc_animation_read returns the saved keys.
 */
export function formatWriteResult(result: unknown): unknown {
  if (!isRecord(result) || !isRecord(result.animation) || !isRecord(result.animation.tracks)) {
    return formatAnimationResult(result);
  }
  const { tracks, ...header } = result.animation;
  const keys = Object.values(tracks).reduce<number>((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
  const summary = {
    ...header,
    tracks: Object.keys(tracks).length,
    keys,
    note: "Saved keys are not repeated here. On a replace send your own keys and the same pins; they are baked again. studiorpc_animation_read with assetPath returns the saved keys.",
  };
  return formatAnimationResult({ ...result, animation: summary });
}

/**
 * The rig lists every bone with its full reference transform, pretty-printed: about 33 KB, most of it IK, camera
 * and item bones that cannot be animated and quaternions nobody reads. The result keeps the animatable bones one
 * line each (parent, reference translations, local axes in component space, 0.01 precision) and only the names
 * of the others.
 */
export function formatRigResult(result: unknown): unknown {
  if (!isRecord(result) || !isRecord(result.rig) || !Array.isArray(result.rig.bones)) {
    return formatAnimationResult(result);
  }
  const { bones, ...rig } = result.rig;
  const animatable = bones.filter((bone) => isRecord(bone) && bone.editable === true);
  const notAnimatable = bones.filter((bone) => isRecord(bone) && bone.editable !== true).map((bone) => bone.name);
  const placeholder = "__ANIMATION_RIG_BONES__";
  const text = JSON.stringify({ ...result, rig: { ...rig, bones: placeholder, notAnimatable } }, null, 2);
  const lines = animatable.map(
    (bone) => `      ${JSON.stringify(compactBone(bone as Record<string, unknown>), roundToHundredth)}`,
  );
  return text.replace(`"${placeholder}"`, () => (lines.length ? `[\n${lines.join(",\n")}\n    ]` : "[]"));
}

function compactBone(bone: Record<string, unknown>): Record<string, unknown> {
  const local = isRecord(bone.refLocal) ? bone.refLocal : {};
  const component = isRecord(bone.refComponent) ? bone.refComponent : {};
  return {
    name: bone.name,
    parent: bone.parent,
    refLocal: { translation: local.translation },
    refComponent: {
      translation: component.translation,
      axisX: component.axisX,
      axisY: component.axisY,
      axisZ: component.axisZ,
    },
  };
}

function roundToHundredth(_key: string, value: unknown): unknown {
  return typeof value === "number" ? Math.round(value * 100) / 100 || 0 : value;
}

/** poseSamples are for reading a pose, not authoring values: 0.001 cm / 0.001 of a quaternion is plenty. */
function roundForReading(_key: string, value: unknown): unknown {
  return typeof value === "number" ? Math.round(value * 1000) / 1000 : value;
}

function compactAnimation(animation: unknown): string {
  if (!isRecord(animation) || !isRecord(animation.tracks)) return JSON.stringify(animation);
  const { tracks, ...header } = animation;
  const trackLines = Object.entries(tracks).map(
    ([bone, keys]) => `      ${JSON.stringify(bone)}: ${JSON.stringify(keys)}`,
  );
  const headerText = JSON.stringify(header).slice(1, -1);
  return `{${headerText}${headerText ? "," : ""}\n    "tracks": {\n${trackLines.join(",\n")}\n    }}`;
}

export async function attachPreviewImage(result: unknown): Promise<ImageBlock[] | undefined> {
  if (typeof result === "string") {
    try {
      result = JSON.parse(result);
    } catch {
      return undefined;
    }
  }
  const preview = isRecord(result) && isRecord(result.preview) ? result.preview : undefined;
  if (preview?.status !== "completed" || typeof preview.imagePath !== "string") return undefined;
  try {
    const bytes = await readFile(preview.imagePath);
    return [{ type: "image", source: { type: "base64", media_type: "image/png", data: bytes.toString("base64") } }];
  } catch {
    return undefined;
  }
}

/**
 * The generic RPC error text keeps only `data.reason`; the animation handlers put the
 * actionable part (kind, errors[], currentRevision, applied, saved) in `data`, so append
 * all of it to the message the agent reads.
 */
export function withErrorData(error: unknown, timeoutNote?: string): never {
  if (error instanceof StudioRpcError) {
    if (error.data === undefined || error.data === null) throw error;
    throw new StudioRpcError(
      `${error.message}\n\nError data:\n${JSON.stringify(error.data, null, 2)}`,
      error.code,
      error.data,
    );
  }
  if (timeoutNote && error instanceof Error && error.message.startsWith("Studio RPC timed out")) {
    throw new Error(`${error.message}\n\n${timeoutNote}`, { cause: error });
  }
  throw error;
}
