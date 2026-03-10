import { z } from "zod";
import { guiObjectProperties } from "./common.ts";

export const method = "instance.text_button.add";

export const description = "Create an interactive TextButton that displays text and detects clicks/taps.";

export const params = z.object({
  class: z.literal("TextButton"),
  parentGuid: z.string().describe("GUID of the parent instance"),
  name: z.string(),
  properties: z
    .object({
      Text: z.string().describe("Text to display").optional(),
      TextSize: z.number().describe("Text size").optional(),
      TextColor3: z.object({ r: z.number(), g: z.number(), b: z.number() }).describe("Text color (RGB)").optional(),
      TextTransparency: z.number().describe("Text transparency (0~1)").optional(),
      TextXAlignment: z.string().describe('Text horizontal alignment (e.g. "Enum.TextXAlignment.Left")').optional(),
      TextYAlignment: z.string().describe('Text vertical alignment (e.g. "Enum.TextYAlignment.Top")').optional(),
      ...guiObjectProperties,
    })
    .describe("TextButton properties"),
});
