import { z } from "zod";

export const method = "script.edit";

export const description = `Edit a script's source via exact string replacement.

IMPORTANT: Use tabs for indentation. Leading 4-space groups will be auto-converted to tabs.

The edit will FAIL if old_string is not unique in the script source.
Provide more surrounding context to make it unique, or set replace_all to true.
Use replace_all for renaming variables or replacing repeated patterns across the script.`;

export const params = z.object({
  targetGuid: z.string().describe("GUID of the script to edit"),
  old_string: z.string().describe("The exact text to find in the script source"),
  new_string: z.string().describe("The replacement text"),
  replace_all: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, replace every occurrence of old_string instead of requiring uniqueness"),
});
