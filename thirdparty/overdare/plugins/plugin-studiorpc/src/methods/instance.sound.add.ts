import { z } from "zod";

export const method = "instance.sound.add";

export const description = "Add a Sound instance under a parent.";

export const params = z.object({
  class: z.literal("Sound"),
  parentGuid: z.string().describe("GUID of the parent instance"),
  name: z.string(),
  properties: z
    .object({
      SoundId: z.string().describe("Sound asset ID").optional(),
      Volume: z.number().describe("Volume multiplier (0~10)").optional(),
      Looped: z.boolean().describe("Whether the sound repeats seamlessly").optional(),
      PlaybackSpeed: z.number().describe("Speed of sound (pitch also changes)").optional(),
      PlayOnRemove: z.boolean().describe("If true, plays when parent/sound is destroyed").optional(),
      RollOffMaxDistance: z.number().describe("Distance where sound becomes inaudible").optional(),
      RollOffMinDistance: z.number().describe("Distance where volume fading starts").optional(),
      RollOffMode: z
        .string()
        .describe('Distance attenuation model (e.g. "Enum.RollOffMode.InverseTapered")')
        .optional(),
    })
    .describe("Sound properties"),
});
