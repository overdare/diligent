// @summary Reads saved action-sequence timelines and issues without approval or mutation.
import { z } from "zod";
import { enrichClipDurations, formatSequenceResult, isRecord } from "./action-sequence-shared";
import { attachPreviewImage } from "./animation-shared";

export const method = "action_sequence.read";
export const readOnly = true;
export const timeoutMs = 150_000;
export const attachImages = attachPreviewImage;
export const description =
  "Read ActionSequence instances in the open level. With no arguments, list instanceGuid, Name, parentPath, Length, trackCounts and duplicate names. With instanceGuid, return the saved timeline in seconds and diagnostic issues (severity, track index/id, time and evidence). Control rows resolve child targets and report nested VFX enabled keys; animation rows report loaded or offline catalog clip durations, otherwise unknown. A timeline read downloads no assets. raw:true writes the complete saved JSON to rawJsonPath; edit that file and send it to studiorpc_action_sequence_write (formerly apply_json) with dryRun first. preview:{times:[...]} evaluates 1 to 12 distinct seconds in [0,Length) on an isolated character, waits for mesh/animation resources, and returns a front/side contact sheet plus world-space joints, control/VFX positions, lowest skin points and collision-key signed distances in cm (negative inside). Red outlines mark collisions at exact key times; cyan crosses mark control roots. Arc/frustum distances are unknown; gameplay scripts and hit recipients are not simulated. Preview can take up to 120 seconds and reports failed/unavailable resources explicitly. This tool does not change the level.";
export const params = z
  .object({
    instanceGuid: z.string().min(1).optional(),
    raw: z.boolean().optional(),
    preview: z
      .object({
        times: z
          .array(z.number().finite().nonnegative())
          .min(1)
          .max(12)
          .refine((times) => new Set(times).size === times.length, "preview times must be distinct"),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((args) => !(args.raw || args.preview) || !!args.instanceGuid, {
    message: "raw and preview require instanceGuid",
  });

export async function postProcess(result: unknown): Promise<string> {
  if (!isRecord(result)) return JSON.stringify(result);
  if (Array.isArray(result.timeline) && Array.isArray(result.issues)) {
    result = await enrichClipDurations(
      result as { timeline: Record<string, unknown>[]; issues: Record<string, unknown>[] },
    );
  }
  return formatSequenceResult(result as Record<string, unknown>);
}
