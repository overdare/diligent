import { z } from "zod"
import { guiObjectProperties } from "./common.ts"

export const method = "instance.frame.add"

export const description =
  "Create a Frame container for grouping GUI elements with responsive layout."

export const params = z.object({
  class: z.literal("Frame"),
  parentGuid: z.string().describe("GUID of the parent instance"),
  name: z.string(),
  properties: z.object(guiObjectProperties).describe("Frame properties"),
})
