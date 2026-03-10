import { z } from "zod";

export const method = "instance.add";

export const description = "Add a supported instance under a parent. Use 'class' to select the type.";

// ── Class → RPC method mapping ────────────────────────────────────────────────

const CLASS_METHOD_MAP: Record<string, string> = {
  Part: "instance.part.add",
  Frame: "instance.frame.add",
  ImageButton: "instance.image_button.add",
  ImageLabel: "instance.image_label.add",
  TextButton: "instance.text_button.add",
  TextLabel: "instance.text_label.add",
  Sound: "instance.sound.add",
  RemoteEvent: "instance.remote_event.add",
  Tool: "instance.tool.add",
  VFXPreset: "instance.vfx_preset.add",
  AngularVelocity: "instance.angular_velocity.add",
  LinearVelocity: "instance.linear_velocity.add",
  VectorForce: "instance.vector_force.add",
};

export function resolveMethod(args: { class: string }): string {
  return CLASS_METHOD_MAP[args.class] ?? `instance.${args.class.toLowerCase()}.add`;
}

// ── Discriminated union variants ──────────────────────────────────────────────

const guiObjectProperties = {
  AnchorPoint: z.object({ x: z.number(), y: z.number() }).optional(),
  BackgroundColor3: z
    .object({ r: z.number(), g: z.number(), b: z.number() })
    .optional(),
  BackgroundTransparency: z.number().describe("Background transparency (0~1)").optional(),
  LayoutOrder: z.number().optional(),
  Position: z
    .object({
      xscale: z.number(),
      xoffset: z.number(),
      yscale: z.number(),
      yoffset: z.number(),
    })
    .describe("UI position (UDim2)")
    .optional(),
  Rotation: z.number().optional(),
  Size: z
    .object({
      xscale: z.number(),
      xoffset: z.number(),
      yscale: z.number(),
      yoffset: z.number(),
    })
    .describe("UI size (UDim2)")
    .optional(),
  Visible: z.boolean().optional(),
  ZIndex: z.number().optional(),
};

export const params = z.discriminatedUnion("class", [
  // Part
  z.object({
    class: z.literal("Part"),
    parentGuid: z.string(),
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
        Color: z.object({ r: z.number(), g: z.number(), b: z.number() }).optional(),
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
      }),
  }),

  // Frame
  z.object({
    class: z.literal("Frame"),
    parentGuid: z.string(),
    name: z.string(),
    properties: z.object(guiObjectProperties),
  }),

  // ImageButton
  z.object({
    class: z.literal("ImageButton"),
    parentGuid: z.string(),
    name: z.string(),
    properties: z
      .object({
        Image: z.string().describe("Image asset ID").optional(),
        ImageColor3: z
          .object({ r: z.number(), g: z.number(), b: z.number() })
          .optional(),
        ImageTransparency: z.number().describe("Image transparency (0~1)").optional(),
        PressImage: z.string().describe("Image asset ID shown when pressed").optional(),
        HoverImage: z.string().describe("Image asset ID shown on hover").optional(),
        ...guiObjectProperties,
      }),
  }),

  // ImageLabel
  z.object({
    class: z.literal("ImageLabel"),
    parentGuid: z.string(),
    name: z.string(),
    properties: z
      .object({
        Image: z.string().describe("Image asset ID").optional(),
        ImageColor3: z
          .object({ r: z.number(), g: z.number(), b: z.number() })
          .optional(),
        ImageTransparency: z.number().describe("Image transparency (0~1)").optional(),
        ...guiObjectProperties,
      }),
  }),

  // TextButton
  z.object({
    class: z.literal("TextButton"),
    parentGuid: z.string(),
    name: z.string(),
    properties: z
      .object({
        Text: z.string().optional(),
        TextSize: z.number().optional(),
        TextColor3: z
          .object({ r: z.number(), g: z.number(), b: z.number() })
          .optional(),
        TextTransparency: z.number().describe("Text transparency (0~1)").optional(),
        TextXAlignment: z
          .string()
          .describe('Text horizontal alignment (e.g. "Enum.TextXAlignment.Left")')
          .optional(),
        TextYAlignment: z
          .string()
          .describe('Text vertical alignment (e.g. "Enum.TextYAlignment.Top")')
          .optional(),
        ...guiObjectProperties,
      }),
  }),

  // TextLabel
  z.object({
    class: z.literal("TextLabel"),
    parentGuid: z.string(),
    name: z.string(),
    properties: z
      .object({
        Text: z.string().optional(),
        TextSize: z.number().optional(),
        TextColor3: z
          .object({ r: z.number(), g: z.number(), b: z.number() })
          .optional(),
        TextTransparency: z.number().describe("Text transparency (0~1)").optional(),
        TextXAlignment: z
          .string()
          .describe('Text horizontal alignment (e.g. "Enum.TextXAlignment.Left")')
          .optional(),
        TextYAlignment: z
          .string()
          .describe('Text vertical alignment (e.g. "Enum.TextYAlignment.Top")')
          .optional(),
        ...guiObjectProperties,
      }),
  }),

  // Sound
  z.object({
    class: z.literal("Sound"),
    parentGuid: z.string(),
    name: z.string(),
    properties: z
      .object({
        SoundId: z.string().optional(),
        Volume: z.number().describe("Volume multiplier (0~10)").optional(),
        Looped: z.boolean().optional(),
        PlaybackSpeed: z.number().describe("Speed of sound (pitch also changes)").optional(),
        PlayOnRemove: z.boolean().describe("If true, plays when parent/sound is destroyed").optional(),
        RollOffMaxDistance: z.number().describe("Distance where sound becomes inaudible").optional(),
        RollOffMinDistance: z.number().describe("Distance where volume fading starts").optional(),
        RollOffMode: z
          .string()
          .describe('Distance attenuation model (e.g. "Enum.RollOffMode.InverseTapered")')
          .optional(),
      }),
  }),

  // RemoteEvent
  z.object({
    class: z.literal("RemoteEvent"),
    parentGuid: z.string(),
    name: z.string(),
    properties: z.object({}).describe("RemoteEvent has no configurable properties"),
  }),

  // Tool
  z.object({
    class: z.literal("Tool"),
    parentGuid: z.string(),
    name: z.string(),
    properties: z
      .object({
        CanBeDropped: z.boolean().optional(),
      }),
  }),

  // VFXPreset
  z.object({
    class: z.literal("VFXPreset"),
    parentGuid: z.string(),
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
        Enabled: z.boolean().optional(),
        InfiniteLoop: z.boolean().optional(),
        LoopCount: z.number().describe("Number of times to loop if not infinite").optional(),
        Size: z.number().describe("Size multiplier").optional(),
        Transparency: z.number().describe("Transparency of preset (0~1)").optional(),
      }),
  }),

  // AngularVelocity
  z.object({
    class: z.literal("AngularVelocity"),
    parentGuid: z.string(),
    name: z.string(),
    properties: z
      .object({
        AngularVelocity: z
          .object({ x: z.number(), y: z.number(), z: z.number() })
          .describe("Target angular velocity vector")
          .optional(),
        MaxTorque: z.number().optional(),
        ReactionTorqueEnabled: z.boolean().optional(),
        RelativeTo: z
          .string()
          .describe('Frame of reference (e.g. "Enum.ActuatorRelativeTo.World")')
          .optional(),
      }),
  }),

  // LinearVelocity
  z.object({
    class: z.literal("LinearVelocity"),
    parentGuid: z.string(),
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
        ForceLimitsEnabled: z.boolean().optional(),
        ForceLimitMode: z
          .string()
          .describe('Force limit mode (e.g. "Enum.ForceLimitMode.Magnitude")')
          .optional(),
        MaxForce: z.number().optional(),
        RelativeTo: z
          .string()
          .describe('Frame of reference (e.g. "Enum.ActuatorRelativeTo.World")')
          .optional(),
      }),
  }),

  // VectorForce
  z.object({
    class: z.literal("VectorForce"),
    parentGuid: z.string(),
    name: z.string(),
    properties: z
      .object({
        Force: z
          .object({ x: z.number(), y: z.number(), z: z.number() })
          .describe("Target force vector")
          .optional(),
        ApplyAtCenterOfMass: z
          .boolean()
          .optional(),
        RelativeTo: z
          .string()
          .describe('Frame of reference (e.g. "Enum.ActuatorRelativeTo.World")')
          .optional(),
      }),
  }),
]);
