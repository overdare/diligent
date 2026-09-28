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
      .max(8)
      .optional()
      .describe("Frames to render, one column each, in this order. Default 0, N/4, N/2, 3N/4, N."),
    views: z
      .array(z.enum(["front", "side"]))
      .max(2)
      .optional()
      .describe("Rows to render. Default both."),
  })
  .strict();

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

export async function attachPreviewImage(result: unknown): Promise<ImageBlock[] | undefined> {
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
