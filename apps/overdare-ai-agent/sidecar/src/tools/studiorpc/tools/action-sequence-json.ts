// @summary Validates common ActionSequence JSON fields and supplies missing Studio compatibility properties.
import { z } from "zod";

const guid = z
  .object({ a: z.number().int(), b: z.number().int(), c: z.number().int(), d: z.number().int() })
  .passthrough();
const track = z
  .object({
    Class: z.string().min(1),
    TrackID: guid,
    IsEnable: z.boolean(),
    StartTime: z.number().finite(),
    EndTime: z.number().finite(),
    CustomDisplayName: z.string().default(""),
    StartOffsetTime: z.number().finite().default(0),
    ParentTrackID: guid,
    ChildTrackIDs: z.array(guid),
    IsLock: z.boolean(),
  })
  .passthrough();
const sequence = z
  .object({
    Class: z.literal("/Script/LuaAPI.ActionSequence"),
    Header: z
      .object({ version: z.number().int().positive(), createTime: z.string(), lastModifyTime: z.string() })
      .passthrough(),
    ActionSequenceID: z.string(),
    SequencerDescription: z.string(),
    Length: z.number().finite().nonnegative(),
    PreviewTarget: z.record(z.unknown()).default({}),
    Tracks: z.array(track),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    value.Tracks.forEach((item, index) => {
      if (
        item.Class === "/Script/LuaAPI.ActionSequenceControlTrack" &&
        item.bScaleInheritance !== undefined &&
        typeof item.bScaleInheritance !== "boolean"
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["Tracks", index, "bScaleInheritance"],
          message: "Expected boolean",
        });
      }
    });
  });

function propertyPath(path: (string | number)[]): string {
  return path.reduce<string>(
    (text, part) => (typeof part === "number" ? `${text}[${part}]` : text ? `${text}.${part}` : part),
    "",
  );
}

/** This covers common fields only; Studio owns class-specific reflection and deserialization. */
export function normalizeActionSequenceJson(content: string): Record<string, unknown> {
  let input: unknown;
  try {
    input = JSON.parse(content.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`Invalid ActionSequence JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const result = sequence.safeParse(input);
  if (!result.success) {
    throw new Error(
      `Invalid ActionSequence JSON fields:\n${result.error.issues
        .map((issue) => `${propertyPath(issue.path) || "Root"}: ${issue.message}`)
        .join("\n")}`,
    );
  }
  for (const item of result.data.Tracks) {
    if (item.Class === "/Script/LuaAPI.ActionSequenceControlTrack" && item.bScaleInheritance === undefined) {
      item.bScaleInheritance = true;
    }
  }
  return result.data;
}
