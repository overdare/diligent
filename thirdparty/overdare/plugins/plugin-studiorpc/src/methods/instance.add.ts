import { z } from "zod";

export const method = "instance.add";

export const description =
  "Add an instance to the scene under a given parent. " +
  "Pick 'class' to specify the instance type, then populate only the 'properties' variant that matches that class. " +
  "This tool is safe to call in parallel — when adding multiple instances, call all at once rather than sequentially.\n" +
  "\n" +
  "Class reference:\n" +
  "  Part            — 3D mesh object placed in the world (shape, position, size, color, material)\n" +
  "  Frame           — Invisible GUI container for grouping and layout\n" +
  "  ImageButton     — Clickable GUI image that fires input events\n" +
  "  ImageLabel      — Non-interactive GUI image display\n" +
  "  TextButton      — Clickable GUI button with a text label\n" +
  "  TextLabel       — Non-interactive GUI text display\n" +
  "  Sound           — Audio source; attach to a Part or workspace\n" +
  "  RemoteEvent     — Async one-way server↔client communication channel (no properties needed)\n" +
  "  Tool            — Equippable item held by a character\n" +
  "  VFXPreset        — Particle/visual-effect emitter\n" +
  "  AngularVelocity  — Physics constraint that applies a rotational velocity\n" +
  "  LinearVelocity   — Physics constraint that applies a linear velocity\n" +
  "  VectorForce      — Physics constraint that applies a constant force vector\n" +
  "  Model            — Container that groups BaseParts into a single manageable unit\n" +
  "  Folder           — Logical container for organizing instances without physical properties\n" +
  "  ScrollingFrame   — Scrollable UI container for lists or grids that exceed visible area\n" +
  "  UIListLayout     — Auto-arranges sibling UI elements in a horizontal or vertical list\n" +
  "  UIGridLayout     — Auto-arranges sibling UI elements in a uniform grid";

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
  Model: "instance.model.add",
  Folder: "instance.folder.add",
  ScrollingFrame: "instance.scrolling_frame.add",
  UIListLayout: "instance.ui_list_layout.add",
  UIGridLayout: "instance.ui_grid_layout.add",
};

export function normalizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  return { ...args, properties: args.properties ?? {} };
}

export function resolveMethod(args: Record<string, unknown>): string {
  const cls = args.class as string;
  return CLASS_METHOD_MAP[cls] ?? `instance.${cls.toLowerCase()}.add`;
}

// ── Shared types ──────────────────────────────────────────────────────────────

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

// ── Schema ────────────────────────────────────────────────────────────────────

export const params = z.object({
  class: z.enum([
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
  ]),
  parentGuid: z.string(),
  name: z.string(),
  properties: z
    .union([
      z
        .object({
          Shape: z.enum(["Enum.Block", "Enum.Ball", "Enum.Cylinder"]).optional(),
          CFrame: z.object({ Position: vec3, Orientation: vec3 }).optional(),
          Size: vec3.describe("units in cm").optional(),
          Color: rgb.optional(),
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
        .describe("Use when class=Part. Defines the 3D mesh shape, transform, size (in cm), color, and surface material."),
      z.object(guiObjectProperties).describe("Use when class=Frame. Layout and visual properties shared by all GUI objects."),
      z
        .object({
          Image: z.string().describe("Image asset ID").optional(),
          ImageColor3: rgb.optional(),
          ImageTransparency: z.number().describe("(0~1)").optional(),
          PressImage: z.string().describe("Image asset ID shown when pressed").optional(),
          HoverImage: z.string().describe("Image asset ID shown on hover").optional(),
          ...guiObjectProperties,
        })
        .describe("Use when class=ImageButton. Extends GUI base with image source, tint, transparency, and press/hover state images."),
      z
        .object({
          Image: z.string().describe("Image asset ID").optional(),
          ImageColor3: rgb.optional(),
          ImageTransparency: z.number().describe("(0~1)").optional(),
          ...guiObjectProperties,
        })
        .describe("Use when class=ImageLabel. Extends GUI base with image source, tint, and transparency (no interaction)."),
      z.object({ ...textProperties, ...guiObjectProperties }).describe("Use when class=TextButton. Extends GUI base with text content, size, color, transparency, and alignment."),
      z.object({ ...textProperties, ...guiObjectProperties }).describe("Use when class=TextLabel. Same as TextButton properties but non-interactive."),
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
        .describe("Use when class=Sound. Configures the audio asset, volume, looping, playback speed, and 3D spatial roll-off."),
      z.object({}).describe("Use when class=RemoteEvent. No configurable properties — just set parentGuid and name."),
      z.object({ CanBeDropped: z.boolean().optional() }).describe("Use when class=Tool. An equippable item; optionally set whether it can be dropped."),
      z
        .object({
          Color: z
            .array(z.object({ Time: z.number(), Color: rgb }))
            .describe("Color gradient over time")
            .optional(),
          Enabled: z.boolean().optional(),
          InfiniteLoop: z.boolean().optional(),
          LoopCount: z.number().describe("Number of times to loop if not infinite").optional(),
          Size: z.number().describe("Size multiplier").optional(),
          Transparency: z.number().describe("(0~1)").optional(),
        })
        .describe("Use when class=VFXPreset. Configures particle emission: color gradient, loop behavior, size multiplier, and transparency."),
      z
        .object({
          AngularVelocity: vec3.describe("Target angular velocity vector").optional(),
          MaxTorque: z.number().optional(),
          ReactionTorqueEnabled: z.boolean().optional(),
          RelativeTo: z.string().describe('e.g. "Enum.ActuatorRelativeTo.World"').optional(),
        })
        .describe("Use when class=AngularVelocity. Applies a target rotational velocity to a physics body, with torque limit and reference frame."),
      z
        .object({
          VelocityConstraintMode: z.string().describe('e.g. "Enum.VelocityConstraintMode.Vector"').optional(),
          VectorVelocity: vec3.describe("Target linear velocity vector").optional(),
          ForceLimitsEnabled: z.boolean().optional(),
          ForceLimitMode: z.string().describe('e.g. "Enum.ForceLimitMode.Magnitude"').optional(),
          MaxForce: z.number().optional(),
          RelativeTo: z.string().describe('e.g. "Enum.ActuatorRelativeTo.World"').optional(),
        })
        .describe("Use when class=LinearVelocity. Applies a target linear velocity to a physics body, with optional force limits and reference frame."),
      z
        .object({
          Force: vec3.describe("Target force vector").optional(),
          ApplyAtCenterOfMass: z.boolean().optional(),
          RelativeTo: z.string().describe('e.g. "Enum.ActuatorRelativeTo.World"').optional(),
        })
        .describe("Use when class=VectorForce. Applies a constant force vector to a physics body, optionally at its center of mass."),
      z
        .object({
          PrimaryPart: z.string().describe("InstanceGuid of the primary part").optional(),
          WorldPivot: z.object({ Position: vec3, Orientation: vec3 }).optional(),
        })
        .describe("Use when class=Model. Groups BaseParts into a single unit; supports physics, movement, and rotation as one entity."),
      z.object({}).describe("Use when class=Folder. Logical organizer with no properties — use for grouping scripts or non-physical instances."),
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
        .describe("Use when class=ScrollingFrame. Scrollable UI container; use for inventory lists, quest logs, or any overflowing content."),
      z
        .object({
          Padding: udim.describe("Space between list items (UDim)").optional(),
          Wraps: z.boolean().optional(),
          FillDirection: z.string().describe('e.g. "Enum.FillDirection.Vertical"').optional(),
          HorizontalAlignment: z.string().describe('e.g. "Enum.HorizontalAlignment.Center"').optional(),
          VerticalAlignment: z.string().describe('e.g. "Enum.VerticalAlignment.Top"').optional(),
          SortOrder: z.string().describe('e.g. "Enum.SortOrder.LayoutOrder"').optional(),
        })
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
        .describe("Use when class=UIGridLayout. Auto-arranges sibling UI elements in a uniform grid with configurable cell size and padding."),
    ])
    .optional(),
});
