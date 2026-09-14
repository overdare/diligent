// @summary Defines the native Studio Rig Builder insertion contract.

import { z } from "zod";
import type { CallRpc } from "../tools/pie-input/target";
import { checkResult } from "../tools/v2/result";

export const method = "rig_builder.insert";

export const description =
  "Insert a new standard Rig Builder character model into the edit world. " +
  "Every call creates a new rig, so do not retry automatically after a timeout or cancellation. " +
  "Omit ParentActorGuid to use the default Workspace. Omit Position to place the rig in front of the viewport. " +
  "Position uses Lua axes (Y is up) and centimeters.";

const position = z
  .object({
    x: z.number().finite().describe("Lua X coordinate in centimeters."),
    y: z.number().finite().describe("Lua Y coordinate in centimeters (up)."),
    z: z.number().finite().describe("Lua Z coordinate in centimeters."),
  })
  .strict();

export const params = z
  .object({
    ParentActorGuid: z.string().min(1).describe("Parent instance GUID. Omit to use the default Workspace.").optional(),
    Position: position
      .describe("Rig position in Lua axes and centimeters. Omit to place it in front of the viewport.")
      .optional(),
  })
  .strict();

export async function postProcess(
  result: unknown,
  _args: Record<string, unknown>,
  callRpc: CallRpc,
): Promise<
  { success: true; instanceGuid: string } | { success: true; instanceGuid: string; saved: false; saveError: string }
> {
  checkResult(method, result);
  const payload = result as { success?: unknown; instanceGuid?: unknown } | null | undefined;
  if (payload?.success !== true) {
    throw new Error(
      `${method} returned an invalid result: success must be true. ` +
        "Creation may be unknown; inspect Studio before retrying.",
    );
  }
  if (typeof payload.instanceGuid !== "string" || payload.instanceGuid.length === 0) {
    throw new Error(
      `${method} returned an invalid result: instanceGuid is missing. ` +
        "Creation may have succeeded; inspect Studio before retrying.",
    );
  }

  const created = { success: true as const, instanceGuid: payload.instanceGuid };
  try {
    const saveResult = await callRpc("level.save.file", {});
    checkResult("level.save.file", saveResult);
    if ((saveResult as { success?: unknown } | null | undefined)?.success !== true) {
      throw new Error("level.save.file returned an invalid result: success must be true.");
    }
    return created;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ...created,
      saved: false,
      saveError:
        `Rig ${payload.instanceGuid} was created, but level.save.file did not confirm persistence: ${reason}. ` +
        `Do not retry rig_builder.insert; inspect instance ${payload.instanceGuid} in Studio and save the level.`,
    };
  }
}
