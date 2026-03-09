import { z } from "zod";

export const method = "instance.tool.add";

export const description = "Add a Tool instance under a parent.";

export const params = z.object({
  class: z.literal("Tool"),
  parentGuid: z.string().describe("GUID of the parent instance"),
  name: z.string(),
  properties: z
    .object({
      CanBeDropped: z.boolean().describe("Whether the tool can be dropped").optional(),
    })
    .describe("Tool properties"),
});
