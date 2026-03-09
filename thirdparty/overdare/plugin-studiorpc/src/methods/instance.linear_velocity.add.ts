import { z } from "zod";

export const method = "instance.linear_velocity.add";

export const description = "Add a LinearVelocity instance under a parent.";

export const params = z.object({
  class: z.literal("LinearVelocity"),
  parentGuid: z.string().describe("GUID of the parent instance"),
  name: z.string(),
  properties: z
    .object({
      VelocityConstraintMode: z
        .string()
        .describe('Constraint mode (e.g. "Enum.VelocityConstraintMode.Vector")')
        .optional(),
      VectorVelocity: z
        .object({ x: z.number(), y: z.number(), z: z.number() })
        .describe("Target linear velocity vector")
        .optional(),
      ForceLimitsEnabled: z.boolean().describe("Whether force limits are enabled").optional(),
      ForceLimitMode: z.string().describe('Force limit mode (e.g. "Enum.ForceLimitMode.Magnitude")').optional(),
      MaxForce: z.number().describe("Maximum force to apply").optional(),
      RelativeTo: z.string().describe('Frame of reference (e.g. "Enum.ActuatorRelativeTo.World")').optional(),
    })
    .describe("LinearVelocity properties"),
});
