import { z } from "zod";

export const method = "script.add";

export const description = "Add a script under a parent instance.";

export const params = z.object({
  class: z.enum(["LocalScript", "Script", "ModuleScript"]),
  parentGuid: z.string().describe("GUID of the parent instance"),
  name: z.string(),
  source: z.string().describe("Luau source code"),
});
