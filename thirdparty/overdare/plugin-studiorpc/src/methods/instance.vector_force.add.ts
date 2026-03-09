import { z } from "zod"

export const method = "instance.vector_force.add"

export const description = "Add a VectorForce instance under a parent."

export const params = z.object({
  class: z.literal("VectorForce"),
  parentGuid: z.string().describe("GUID of the parent instance"),
  name: z.string(),
  properties: z
    .object({
      Force: z
        .object({ x: z.number(), y: z.number(), z: z.number() })
        .describe("Target force vector")
        .optional(),
      ApplyAtCenterOfMass: z
        .boolean()
        .describe("Whether to apply force at center of mass")
        .optional(),
      RelativeTo: z
        .string()
        .describe('Frame of reference (e.g. "Enum.ActuatorRelativeTo.World")')
        .optional(),
    })
    .describe("VectorForce properties"),
})
