import { z } from "zod";

export const method = "instance.part.add";

export const description = "Add a Part instance under a parent.";

export const params = z.object({
  class: z.literal("Part"),
  parentGuid: z.string().describe("GUID of the parent instance"),
  name: z.string(),
  properties: z
    .object({
      Shape: z.enum(["Enum.Block", "Enum.Ball", "Enum.Cylinder"]).optional(),
      CFrame: z
        .object({
          Position: z.object({ x: z.number(), y: z.number(), z: z.number() }),
          Orientation: z.object({ x: z.number(), y: z.number(), z: z.number() }),
        })
        .optional(),
      Size: z.object({ x: z.number(), y: z.number(), z: z.number() }).describe("units in cm").optional(),
      Color: z.object({ r: z.number(), g: z.number(), b: z.number() }).describe("Part color (RGB)").optional(),
      Material: z
        .enum([
          "Enum.Material.Basic",
          "Enum.Material.Plastic",
          "Enum.Material.Brick",
          "Enum.Material.Rock",
          "Enum.Material.Metal",
          "Enum.Material.Unlit",
          "Enum.Material.Bark",
          "Enum.Material.SmallBrick",
          "Enum.Material.LeafyGround",
          "Enum.Material.MossyGround",
          "Enum.Material.Ground",
          "Enum.Material.Glass",
          "Enum.Material.Paving",
          "Enum.Material.MossyRock",
          "Enum.Material.Wood",
          "Enum.Material.Neon",
        ])
        .optional(),
    })
    .describe("Part properties"),
});
