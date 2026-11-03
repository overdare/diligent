import { z } from "zod";

export const method = "action_sequence.write";

export const description =
  "Apply a JSON file to an existing Action Sequence. Validates shared fields and fills missing PreviewTarget, CustomDisplayName, StartOffsetTime and control-track bScaleInheritance in a temporary copy, preserving source values and the original file. " +
  "dryRun:true returns proposed timeline/issues without mutation or approval. Application returns warnings; Studio validates class-specific properties. This operation does not save the resulting world: use studiorpc_level_save_file. See actionsequence for the payload format.";

export const params = z.object({
  instanceGuid: z.string().describe("GUID of the target Action Sequence instance"),
  jsonFilePath: z.string().describe("Absolute file path to the Action Sequence JSON file"),
  dryRun: z.boolean().optional().describe("Inspect the proposal without changing the stored sequence."),
});
