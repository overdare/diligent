import { z } from "zod";
import { guiObjectProperties } from "./common.ts";

export const method = "instance.image_label.add";

export const description = "Create an ImageLabel to display images with customizable visual properties.";

export const params = z.object({
  class: z.literal("ImageLabel"),
  parentGuid: z.string().describe("GUID of the parent instance"),
  name: z.string(),
  properties: z
    .object({
      Image: z.string().describe("Image asset ID").optional(),
      ImageColor3: z.object({ r: z.number(), g: z.number(), b: z.number() }).describe("Image color (RGB)").optional(),
      ImageTransparency: z.number().describe("Image transparency (0~1)").optional(),
      ...guiObjectProperties,
    })
    .describe("ImageLabel properties"),
});
