// @summary Defines shared instance property schemas and class enums for Studio RPC tools.
import { z } from "zod";

const vec3 = z.object({ x: z.number(), y: z.number(), z: z.number() });
const udim = z.object({ scale: z.number(), offset: z.number() });
const colorChannel = z.number().int().min(0).max(255);
const rgb = z.object({ r: colorChannel, g: colorChannel, b: colorChannel });
const udim2 = z.object({ xscale: z.number(), xoffset: z.number(), yscale: z.number(), yoffset: z.number() });

const guiObjectProperties = {
  AnchorPoint: z.object({ x: z.number(), y: z.number() }).optional(),
  BackgroundColor3: rgb.optional(),
  BackgroundTransparency: z.number().describe("(0~1)").optional(),
  LayoutOrder: z.number().optional(),
  Position: udim2.describe("UI position (UDim2)").optional(),
  Rotation: z.number().optional(),
  Size: udim2.describe("UI size (UDim2)").optional(),
  Visible: z.boolean().optional(),
  ZIndex: z.number().optional(),
};

const textProperties = {
  Text: z.string().optional(),
  TextSize: z.number().optional(),
  TextColor3: rgb.optional(),
  TextTransparency: z.number().describe("(0~1)").optional(),
  TextXAlignment: z.string().describe('e.g. "Enum.TextXAlignment.Left"').optional(),
  TextYAlignment: z.string().describe('e.g. "Enum.TextYAlignment.Top"').optional(),
};

export const instanceClassEnum = z.enum([
  "Part",
  "Frame",
  "ImageButton",
  "ImageLabel",
  "TextButton",
  "TextLabel",
  "Sound",
  "RemoteEvent",
  "Tool",
  "VFXPreset",
  "AngularVelocity",
  "LinearVelocity",
  "VectorForce",
  "Model",
  "Folder",
  "ScrollingFrame",
  "UIListLayout",
  "UIGridLayout",
]);

export const materialEnum = z.enum([
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
]);

export const instancePropertiesSchema = z
  .union([
    z
      .object({
        Shape: z.enum(["Enum.PartType.Block", "Enum.PartType.Ball", "Enum.PartType.Cylinder"]).optional(),
        CFrame: z.object({ Position: vec3, Orientation: vec3 }).optional(),
        Size: vec3.describe("units in cm").optional(),
        Color: rgb.optional(),
        Material: materialEnum.optional(),
      })
      .strict()
      .describe(
        "Use when class=Part. Defines the 3D mesh shape, transform, size (in cm), color, and surface material.",
      ),
    z
      .object(guiObjectProperties)
      .strict()
      .describe("Use when class=Frame. Layout and visual properties shared by all GUI objects."),
    z
      .object({
        Image: z.string().describe("Image asset ID").optional(),
        ImageColor3: rgb.optional(),
        ImageTransparency: z.number().describe("(0~1)").optional(),
        PressImage: z.string().describe("Image asset ID shown when pressed").optional(),
        HoverImage: z.string().describe("Image asset ID shown on hover").optional(),
        ...guiObjectProperties,
      })
      .strict()
      .describe(
        "Use when class=ImageButton. Extends GUI base with image source, tint, transparency, and press/hover state images.",
      ),
    z
      .object({
        Image: z.string().describe("Image asset ID").optional(),
        ImageColor3: rgb.optional(),
        ImageTransparency: z.number().describe("(0~1)").optional(),
        ...guiObjectProperties,
      })
      .strict()
      .describe(
        "Use when class=ImageLabel. Extends GUI base with image source, tint, and transparency (no interaction).",
      ),
    z
      .object({ ...textProperties, ...guiObjectProperties })
      .strict()
      .describe(
        "Use when class=TextButton. Extends GUI base with text content, size, color, transparency, and alignment.",
      ),
    z
      .object({ ...textProperties, ...guiObjectProperties })
      .strict()
      .describe("Use when class=TextLabel. Same as TextButton properties but non-interactive."),
    z
      .object({
        SoundId: z.string().optional(),
        Volume: z.number().describe("multiplier (0~10)").optional(),
        Looped: z.boolean().optional(),
        PlaybackSpeed: z.number().describe("Speed of sound (pitch also changes)").optional(),
        PlayOnRemove: z.boolean().describe("If true, plays when parent/sound is destroyed").optional(),
        RollOffMaxDistance: z.number().describe("Distance where sound becomes inaudible").optional(),
        RollOffMinDistance: z.number().describe("Distance where volume fading starts").optional(),
        RollOffMode: z.string().describe('e.g. "Enum.RollOffMode.InverseTapered"').optional(),
      })
      .strict()
      .describe(
        "Use when class=Sound. Configures the audio asset, volume, looping, playback speed, and 3D spatial roll-off.",
      ),
    z
      .object({})
      .strict()
      .describe("Use when class=RemoteEvent. No configurable properties — just set parentGuid and name."),
    z
      .object({ CanBeDropped: z.boolean().optional() })
      .strict()
      .describe("Use when class=Tool. An equippable item; optionally set whether it can be dropped."),
    z
      .object({
        PresetName: z
          .enum([
            "Hit",
            "Explosion",
            "Knockback",
            "Dash",
            "Landing",
            "Trail",
            "Crack",
            "Muzzle",
            "Heal",
            "Cast",
            "Barrier",
            "Fire",
            "Portal",
            "Rain",
            "Spawn",
            "Buff Zone",
            "Speedup",
            "Warning",
            "Level Up",
            "Get Item",
            "Hit Object",
            "Destroy",
            "Stun",
            "Debuff Toxic",
            "Guard",
            "Simple Hit",
            "Blood",
            "Electric Muzzle",
            "Flash Hit",
            "Electric Explosion",
            "Smoke Explosion",
            "Highlight Burst",
            "Floating Puzzle",
            "Spin Trail",
            "Solar Swirl Trail",
            "Solar Trail Plus",
            "Solar Trail Burst",
            "Electric Attack",
            "Electric Dragon",
            "Electric Dragon Strike",
            "Electric Kick",
            "Game Over",
            "Scratch",
            "Snowflake",
            "Spark",
            "Tornado",
            "Water Swirl Trail",
            "Waterfall Attack",
            "Lightning Arc",
            "Bounce",
            "Simple Punch",
            "Punch",
            "Strong Punch",
            "Light Cast",
            "Light Charge",
            "Small Barrier",
            "Aura Wave",
            "Swirl Ring",
            "Dash Burst",
            "Soccer Dash",
            "Simple Landing",
            "Void Portal",
            "Water Splash",
            "Mining",
            "Dig",
            "Leaf",
            "Fog",
          ])
          .describe("VFX preset name"),
        Color: z.array(z.object({ Time: z.number(), Color: rgb })).describe("Color gradient over time"),
        Enabled: z.boolean().optional(),
        InfiniteLoop: z.boolean().optional(),
        LoopCount: z.number().describe("Number of times to loop if not infinite").optional(),
        Size: z.number().describe("Size multiplier").optional(),
        Transparency: z.number().describe("(0~1)").optional(),
      })
      .strict()
      .describe(
        "Use when class=VFXPreset. Configures particle emission: color gradient, loop behavior, size multiplier, and transparency. PresetName is required.",
      ),
    z
      .object({
        AngularVelocity: vec3.describe("Target angular velocity vector").optional(),
        MaxTorque: z.number().optional(),
        ReactionTorqueEnabled: z.boolean().optional(),
        RelativeTo: z.string().describe('e.g. "Enum.ActuatorRelativeTo.World"').optional(),
      })
      .strict()
      .describe(
        "Use when class=AngularVelocity. Applies a target rotational velocity to a physics body, with torque limit and reference frame.",
      ),
    z
      .object({
        VelocityConstraintMode: z.string().describe('e.g. "Enum.VelocityConstraintMode.Vector"').optional(),
        VectorVelocity: vec3.describe("Target linear velocity vector").optional(),
        ForceLimitsEnabled: z.boolean().optional(),
        ForceLimitMode: z.string().describe('e.g. "Enum.ForceLimitMode.Magnitude"').optional(),
        MaxForce: z.number().optional(),
        RelativeTo: z.string().describe('e.g. "Enum.ActuatorRelativeTo.World"').optional(),
      })
      .strict()
      .describe(
        "Use when class=LinearVelocity. Applies a target linear velocity to a physics body, with optional force limits and reference frame.",
      ),
    z
      .object({
        Force: vec3.describe("Target force vector").optional(),
        ApplyAtCenterOfMass: z.boolean().optional(),
        RelativeTo: z.string().describe('e.g. "Enum.ActuatorRelativeTo.World"').optional(),
      })
      .strict()
      .describe(
        "Use when class=VectorForce. Applies a constant force vector to a physics body, optionally at its center of mass.",
      ),
    z
      .object({
        PrimaryPart: z.string().describe("InstanceGuid of the primary part").optional(),
        WorldPivot: z.object({ Position: vec3, Orientation: vec3 }).optional(),
      })
      .strict()
      .describe(
        "Use when class=Model. Groups BaseParts into a single unit; supports physics, movement, and rotation as one entity.",
      ),
    z
      .object({})
      .strict()
      .describe(
        "Use when class=Folder. Logical organizer with no properties — use for grouping scripts or non-physical instances.",
      ),
    z
      .object({
        AutomaticCanvasSize: z.string().describe('e.g. "Enum.AutomaticSize.Y"').optional(),
        CanvasPosition: z.object({ x: z.number(), y: z.number() }).describe("Scroll offset (Vector2)").optional(),
        CanvasSize: udim2.describe("Total scrollable area (UDim2)").optional(),
        ScrollBarImageColor3: rgb.optional(),
        ScrollBarImageTransparency: z.number().describe("(0~1)").optional(),
        ScrollBarThickness: z.number().optional(),
        ScrollingDirection: z.string().describe('e.g. "Enum.ScrollingDirection.Y"').optional(),
        ScrollingEnabled: z.boolean().optional(),
        ...guiObjectProperties,
      })
      .strict()
      .describe(
        "Use when class=ScrollingFrame. Scrollable UI container; use for inventory lists, quest logs, or any overflowing content.",
      ),
    z
      .object({
        Padding: udim.describe("Space between list items (UDim)").optional(),
        Wraps: z.boolean().optional(),
        FillDirection: z.string().describe('e.g. "Enum.FillDirection.Vertical"').optional(),
        HorizontalAlignment: z.string().describe('e.g. "Enum.HorizontalAlignment.Center"').optional(),
        VerticalAlignment: z.string().describe('e.g. "Enum.VerticalAlignment.Top"').optional(),
        SortOrder: z.string().describe('e.g. "Enum.SortOrder.LayoutOrder"').optional(),
      })
      .strict()
      .describe("Use when class=UIListLayout. Auto-arranges sibling UI elements in a horizontal or vertical list."),
    z
      .object({
        CellPadding: udim2.describe("Space between grid cells (UDim2)").optional(),
        CellSize: udim2.describe("Uniform size of each grid cell (UDim2)").optional(),
        FillDirectionMaxCells: z.number().int().describe("Max cells per row/column before wrapping").optional(),
        FillDirection: z.string().describe('e.g. "Enum.FillDirection.Horizontal"').optional(),
        HorizontalAlignment: z.string().describe('e.g. "Enum.HorizontalAlignment.Left"').optional(),
        VerticalAlignment: z.string().describe('e.g. "Enum.VerticalAlignment.Top"').optional(),
        SortOrder: z.string().describe('e.g. "Enum.SortOrder.LayoutOrder"').optional(),
      })
      .strict()
      .describe(
        "Use when class=UIGridLayout. Auto-arranges sibling UI elements in a uniform grid with configurable cell size and padding.",
      ),
  ])
  .optional();
