// @summary Reads saved action-sequence timelines and issues without approval or mutation.
import { z } from "zod";
import { enrichClipDurations, formatSequenceResult, isRecord } from "./action-sequence-shared";
import { attachPreviewImage } from "./animation-shared";

export const method = "action_sequence.read";
export const readOnly = true;
export const timeoutMs = 150_000;
export const attachImages = attachPreviewImage;
export const description =
  "Read saved Action Sequences without changing the level. No instanceGuid lists names, GUIDs, track counts and duplicate names; a GUID returns its timeline in seconds and issues with track/time evidence. Loaded or offline-catalog clip durations may be available; a timeline-only read downloads no assets. " +
  "raw:true writes the complete saved JSON to rawJsonPath for editing with studiorpc_action_sequence_write. Optional preview samples up to 22 times on an isolated character, waiting for mesh/clip resources; default times span 0–100% of Length. " +
  "The sheet has front/side rows, collision bounds and control roots. Pose/control positions and signed collision distances are world-space cm (negative inside). Arc/frustum distances are unavailable; gameplay and hit recipients are not simulated. Preview may take 120 seconds and reports missing resources. Use actionsequence-review for interpretation.";

export const params = z
  .object({
    instanceGuid: z.string().min(1).optional(),
    raw: z.boolean().optional(),
    preview: z
      .union([
        z.literal(true),
        z
          .object({
            times: z
              .array(z.number().finite().nonnegative())
              .min(1)
              .max(22)
              .refine((times) => new Set(times).size === times.length, "preview times must be distinct")
              .optional(),
          })
          .strict(),
      ])
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
