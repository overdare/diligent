import { z } from "zod";

export const method = "action_sequencer_service.apply_json";

export const description =
  "Apply an Action Sequence JSON file to an existing Action Sequence instance in the level. " +
  "Validates common fields and fills missing PreviewTarget, CustomDisplayName, StartOffsetTime, and control-track " +
  "bScaleInheritance in a temporary copy, preserving existing values and the source file. " +
  "Studio validates class-specific properties. Call studiorpc_level_save_file after successful application to persist it.";

export const params = z.object({
  instanceGuid: z.string().describe("GUID of the target Action Sequence instance"),
  jsonFilePath: z.string().describe("Absolute file path to the Action Sequence JSON file"),
});
