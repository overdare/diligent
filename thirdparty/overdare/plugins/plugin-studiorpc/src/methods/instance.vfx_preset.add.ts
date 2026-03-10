import { z } from "zod";

export const method = "instance.vfx_preset.add";

export const description = "Add a VFXPreset instance under a parent.";

export const params = z.object({
  class: z.literal("VFXPreset"),
  parentGuid: z.string().describe("GUID of the parent instance"),
  name: z.string(),
  properties: z
    .object({
      Color: z
        .array(
          z.object({
            Time: z.number(),
            Color: z.object({ r: z.number(), g: z.number(), b: z.number() }),
          }),
        )
        .describe("Color gradient over time")
        .optional(),
      Enabled: z.boolean().describe("Determine if the particles emit").optional(),
      InfiniteLoop: z.boolean().describe("Whether the effect loops infinitely").optional(),
      LoopCount: z.number().describe("Number of times to loop if not infinite").optional(),
      Size: z.number().describe("Size multiplier").optional(),
      Transparency: z.number().describe("Transparency of preset (0~1)").optional(),
    })
    .describe("VFXPreset properties"),
});
