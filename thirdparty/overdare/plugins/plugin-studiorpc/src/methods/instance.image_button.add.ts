import { z } from "zod";
import { guiObjectProperties } from "./common.ts";

export const method = "instance.image_button.add";

export const description = "Create an interactive ImageButton that detects clicks/taps.";

export const params = z.object({
  class: z.literal("ImageButton"),
  parentGuid: z.string().describe("GUID of the parent instance"),
  name: z.string(),
  properties: z
    .object({
      Image: z.string().describe("Image asset ID").optional(),
      ImageColor3: z.object({ r: z.number(), g: z.number(), b: z.number() }).describe("Image color (RGB)").optional(),
      ImageTransparency: z.number().describe("Image transparency (0~1)").optional(),
      PressImage: z.string().describe("Image asset ID shown when pressed").optional(),
      HoverImage: z.string().describe("Image asset ID shown on hover").optional(),
      ...guiObjectProperties,
    })
    .describe("ImageButton properties"),
});
