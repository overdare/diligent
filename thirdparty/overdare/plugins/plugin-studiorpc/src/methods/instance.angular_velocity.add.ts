import { z } from "zod";

export const method = "instance.angular_velocity.add";

export const description = "Add an AngularVelocity instance under a parent.";

export const params = z.object({
  class: z.literal("AngularVelocity"),
  parentGuid: z.string().describe("GUID of the parent instance"),
  name: z.string(),
  properties: z
    .object({
      AngularVelocity: z
        .object({ x: z.number(), y: z.number(), z: z.number() })
        .describe("Target angular velocity vector")
        .optional(),
      MaxTorque: z.number().describe("Maximum torque to apply").optional(),
      ReactionTorqueEnabled: z.boolean().describe("Whether to apply reaction torque").optional(),
      RelativeTo: z.string().describe('Frame of reference (e.g. "Enum.ActuatorRelativeTo.World")').optional(),
    })
    .describe("AngularVelocity properties"),
});
