// @summary Prepares native surface mapping and previews without changing the level.
import { z } from "zod";
import { texturePlan } from "./texture-plan";

export const method = "texture.prepare";
export const readOnly = true;
export const timeoutMs = 300_000;
export const description =
  "Prepare one albedo for a Block Part, ProceduralModel or static MeshPart. " +
  "Returns stable surfaces, physical dimensions, requiredImages and local preview paths without changing the world. " +
  "Use fill/shape/pattern/text for simple graphics; image layers reference imageKey or an existing published image. " +
  "Omit plan to inspect or reload the saved plan. Images can be generated independently with generate_image. " +
  "Pass the returned prepareId and targetRevision to texture.apply; never assemble the final UV atlas in the image generator.";
export const params = z
  .object({
    targetGuid: z.string().min(1),
    resolution: z.union([z.literal(256), z.literal(512), z.literal(1024)]).optional(),
    plan: texturePlan.optional(),
  })
  .strict();
