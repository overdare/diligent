// @summary Defines shared instance property schemas and class enums for Studio RPC tools.
import { z } from "zod";

const vec3 = z.object({ X: z.number(), Y: z.number(), Z: z.number() });
const udim = z.object({ Scale: z.number(), Offset: z.number() });
const colorChannel = z.number().int().min(0).max(255);
const rgb = z.object({ R: colorChannel, G: colorChannel, B: colorChannel });
const udim2 = z.object({ XScale: z.number(), XOffset: z.number(), YScale: z.number(), YOffset: z.number() });

const normalIdEnum = z.enum(["Right", "Top", "Back", "Left", "Bottom", "Front"]);
const colorSequence = z
  .array(z.object({ Time: z.number(), Color: rgb }))
  .describe("ColorSequence keypoints [{Time,Color}]");
const numberSequence = z
  .array(z.object({ Time: z.number(), Value: z.number(), Envelope: z.number().optional() }))
  .describe("NumberSequence keypoints [{Time,Value,Envelope?}]");
const numberRange = z.object({ Min: z.number(), Max: z.number() });
const surfaceGuiBaseProperties = {
  Active: z.boolean().optional(),
  AlwaysOnTop: z.boolean().optional(),
  Brightness: z.number().optional(),
  ClipsDescendants: z.boolean().optional(),
  Enabled: z.boolean().optional(),
  LightInfluence: z.number().describe("(0~1)").optional(),
  MaxDistance: z.number().optional(),
  Size: udim2.describe("UI size (UDim2)").optional(),
  ZIndexBehavior: z.string().describe('e.g. "Sibling"').optional(),
};

const guiObjectProperties = {
  Active: z.boolean().optional(),
  AnchorPoint: z.object({ X: z.number(), Y: z.number() }).optional(),
  BackgroundColor3: rgb.optional(),
  BackgroundTransparency: z.number().describe("(0~1)").optional(),
  ClipsDescendants: z.boolean().optional(),
  LayoutOrder: z.number().optional(),
  Position: udim2.describe("UI position (UDim2)").optional(),
  Rotation: z.number().optional(),
  Size: udim2.describe("UI size (UDim2)").optional(),
  Visible: z.boolean().optional(),
  ZIndex: z.number().optional(),
};

const textProperties = {
  Bold: z.boolean().optional(),
  Text: z.string().optional(),
  TextColor3: rgb.optional(),
  TextScaled: z.boolean().optional(),
  TextSize: z.number().optional(),
  TextTransparency: z.number().describe("(0~1)").optional(),
  TextWrapped: z.boolean().optional(),
  TextXAlignment: z.string().describe('e.g. "Left"').optional(),
  TextYAlignment: z.string().describe('e.g. "Top"').optional(),
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
  "BillboardGui",
  "SurfaceGui",
  "BindableEvent",
  "Attachment",
  "Beam",
  "Trail",
  "ParticleEmitter",
  "PointLight",
  "SpotLight",
  "StringValue",
  "NumberValue",
  "BoolValue",
  "IntValue",
  "MeshPart",
  "Animation",
  "HumanoidDescription",
]);

export const materialEnum = z.enum([
  "Basic",
  "Plastic",
  "Brick",
  "Rock",
  "Metal",
  "Unlit",
  "Bark",
  "SmallBrick",
  "LeafyGround",
  "MossyGround",
  "Ground",
  "Glass",
  "Paving",
  "MossyRock",
  "Wood",
  "Neon",
]);

export const instancePropertiesSchema = z
  .union([
    z
      .object({
        Shape: z.enum(["Block", "Ball", "Cylinder"]).optional(),
        CFrame: z.object({ Position: vec3, Orientation: vec3 }).optional(),
        Size: vec3.describe("units in cm").optional(),
        Anchored: z.boolean().optional(),
        CanCollide: z.boolean().optional(),
        CanQuery: z.boolean().optional(),
        CanTouch: z.boolean().optional(),
        CastShadow: z.boolean().optional(),
        CollisionGroup: z.string().optional(),
        Color: rgb.optional(),
        Locked: z.boolean().optional(),
        Mass: z.number().optional(),
        Massless: z.boolean().optional(),
        Material: materialEnum.optional(),
        MaterialVariant: z.string().optional(),
        Reflectance: z.number().describe("(0~1)").optional(),
        RootPriority: z.number().optional(),
        Transparency: z.number().describe("(0~1)").optional(),
      })
      .strict()
      .describe(
        "Use when class=Part. Defines the 3D mesh shape, transform, size (in cm), color, material, physics, and collision properties.",
      ),
    z
      .object({
        ...guiObjectProperties,
        BorderColor3: rgb.optional(),
        BorderMode: z.enum(["Insert", "Middle", "Outline"]).optional(),
        BorderPixelSize: z.number().optional(),
      })
      .strict()
      .describe("Use when class=Frame. Layout and visual properties with optional border styling."),
    z
      .object({
        Image: z.string().describe("Image asset ID").optional(),
        ImageColor3: rgb.optional(),
        ImageTransparency: z.number().describe("(0~1)").optional(),
        PressImage: z.string().describe("Image asset ID").optional(),
        HoverImage: z.string().describe("Image asset ID").optional(),
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
        PlaybackSpeed: z.number().optional(),
        PlayOnRemove: z.boolean().optional(),
        RollOffMaxDistance: z.number().optional(),
        RollOffMinDistance: z.number().optional(),
        RollOffMode: z.string().describe('e.g. "InverseTapered"').optional(),
        StartTimePosition: z.number().optional(),
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
      .object({
        CanBeDropped: z.boolean().optional(),
        Enabled: z.boolean().optional(),
        ManualActivationOnly: z.boolean().optional(),
        RequiresHandle: z.boolean().optional(),
        ToolTip: z.string().optional(),
      })
      .strict()
      .describe("Use when class=Tool. An equippable item; configure drop, activation, handle, and tooltip."),
    z
      .object({
        PresetName: z.enum([
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
        ]),
        Color: z.array(z.object({ Time: z.number(), Color: rgb })),
        Enabled: z.boolean().optional(),
        InfiniteLoop: z.boolean().optional(),
        LoopCount: z.number().optional(),
        Size: z.number().optional(),
        Transparency: z.number().describe("(0~1)").optional(),
      })
      .strict()
      .describe(
        "Use when class=VFXPreset. Configures particle emission: color gradient, loop behavior, size multiplier, and transparency. PresetName is required.",
      ),
    z
      .object({
        AngularVelocity: vec3.optional(),
        Enabled: z.boolean().optional(),
        MaxTorque: z.number().optional(),
        ReactionTorqueEnabled: z.boolean().optional(),
        RelativeTo: z.string().describe('e.g. "World"').optional(),
        Visible: z.boolean().optional(),
      })
      .strict()
      .describe(
        "Use when class=AngularVelocity. Applies a target rotational velocity to a physics body, with torque limit and reference frame.",
      ),
    z
      .object({
        VelocityConstraintMode: z.string().describe('e.g. "Vector"').optional(),
        VectorVelocity: vec3.optional(),
        LineDirection: vec3.optional(),
        LineVelocity: z.number().optional(),
        PlaneVelocity: z.object({ X: z.number(), Y: z.number() }).optional(),
        PrimaryTangentAxis: vec3.optional(),
        SecondaryTangentAxis: vec3.optional(),
        Enabled: z.boolean().optional(),
        ForceLimitsEnabled: z.boolean().optional(),
        ForceLimitMode: z.string().describe('e.g. "Magnitude"').optional(),
        MaxForce: z.number().optional(),
        MaxAxesForce: vec3.optional(),
        RelativeTo: z.string().describe('e.g. "World"').optional(),
        Visible: z.boolean().optional(),
      })
      .strict()
      .describe(
        "Use when class=LinearVelocity. Applies a target linear velocity to a physics body; supports Vector/Line/Plane constraint modes with optional force limits.",
      ),
    z
      .object({
        Force: vec3.optional(),
        ApplyAtCenterOfMass: z.boolean().optional(),
        Enabled: z.boolean().optional(),
        RelativeTo: z.string().describe('e.g. "World"').optional(),
        Visible: z.boolean().optional(),
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
        AutomaticCanvasSize: z.string().describe('e.g. "Y"').optional(),
        CanvasPosition: z.object({ X: z.number(), Y: z.number() }).describe("Scroll offset (Vector2)").optional(),
        CanvasSize: udim2.describe("Total scrollable area (UDim2)").optional(),
        ScrollBarImageColor3: rgb.optional(),
        ScrollBarImageTransparency: z.number().describe("(0~1)").optional(),
        ScrollBarThickness: z.number().optional(),
        ScrollingDirection: z.string().describe('e.g. "Y"').optional(),
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
        FillDirection: z.string().describe('e.g. "Vertical"').optional(),
        HorizontalAlignment: z.string().describe('e.g. "Center"').optional(),
        VerticalAlignment: z.string().describe('e.g. "Top"').optional(),
        SortOrder: z.string().describe('e.g. "LayoutOrder"').optional(),
      })
      .strict()
      .describe("Use when class=UIListLayout. Auto-arranges sibling UI elements in a horizontal or vertical list."),
    z
      .object({
        CellPadding: udim2.describe("Space between grid cells (UDim2)").optional(),
        CellSize: udim2.describe("Uniform size of each grid cell (UDim2)").optional(),
        FillDirectionMaxCells: z.number().int().optional(),
        FillDirection: z.string().describe('e.g. "Horizontal"').optional(),
        HorizontalAlignment: z.string().describe('e.g. "Left"').optional(),
        VerticalAlignment: z.string().describe('e.g. "Top"').optional(),
        SortOrder: z.string().describe('e.g. "LayoutOrder"').optional(),
      })
      .strict()
      .describe(
        "Use when class=UIGridLayout. Auto-arranges sibling UI elements in a uniform grid with configurable cell size and padding.",
      ),
    z
      .object({
        ...surfaceGuiBaseProperties,
        DistanceLowerLimit: z.number().optional(),
        DistanceUpperLimit: z.number().optional(),
        ExtentsOffsetWorldSpace: vec3.optional(),
        PositionOffset: vec3.optional(),
        SizeOffset: z
          .object({ X: z.number(), Y: z.number() })
          .describe("Screen-space size offset (Vector2)")
          .optional(),
      })
      .strict()
      .describe(
        "Use when class=BillboardGui. World-space GUI anchored to an Adornee; configure visibility distance, offsets, and base surface properties.",
      ),
    z
      .object({
        ...surfaceGuiBaseProperties,
        Face: normalIdEnum.optional(),
        ZOffset: z.number().optional(),
      })
      .strict()
      .describe(
        "Use when class=SurfaceGui. GUI rendered on a Part surface; configure the target face and base surface properties.",
      ),
    z
      .object({})
      .strict()
      .describe("Use when class=BindableEvent. No configurable properties — just set parentGuid and name."),
    z
      .object({
        Axis: vec3.optional(),
        CFrame: z.object({ Position: vec3, Orientation: vec3 }).optional(),
        SecondaryAxis: vec3.optional(),
      })
      .strict()
      .describe(
        "Use when class=Attachment. Defines a local coordinate frame on a BasePart for constraints and effects.",
      ),
    z
      .object({
        Color: colorSequence.optional(),
        CurveSize0: z.number().optional(),
        CurveSize1: z.number().optional(),
        Enabled: z.boolean().optional(),
        FaceCamera: z.boolean().optional(),
        Texture: z.string().describe("Texture asset ID").optional(),
        TextureLength: z.number().optional(),
        TextureSpeed: z.number().optional(),
        Transparency: numberSequence.optional(),
        Width0: z.number().optional(),
        Width1: z.number().optional(),
      })
      .strict()
      .describe(
        "Use when class=Beam. Visual beam between two Attachments; configure color, curve, texture, width, and transparency.",
      ),
    z
      .object({
        Color: colorSequence.optional(),
        Enabled: z.boolean().optional(),
        Lifetime: z.number().optional(),
        Offset: vec3.optional(),
        Texture: z.string().describe("Texture asset ID").optional(),
        TextureLength: z.number().optional(),
        TextureSpeed: z.number().optional(),
        Transparency: numberSequence.optional(),
        Width: z.number().optional(),
        WidthScale: numberSequence.optional(),
      })
      .strict()
      .describe(
        "Use when class=Trail. Motion trail between two Attachments; configure color, lifetime, texture, width, and transparency.",
      ),
    z
      .object({
        Acceleration: vec3.optional(),
        Brightness: z.number().optional(),
        Color: colorSequence.optional(),
        Drag: z.number().optional(),
        EmissionDirection: normalIdEnum.optional(),
        Enabled: z.boolean().optional(),
        FlipbookFramerate: numberRange.optional(),
        FlipbookLayout: z.enum(["None", "Grid2x2", "Grid4x4", "Grid8x8"]).optional(),
        FlipbookMode: z.enum(["Loop", "OneShot", "PingPong", "Random"]).optional(),
        FlipbookStartRandom: z.boolean().optional(),
        LifeTime: numberRange.optional(),
        LightEmission: z.number().describe("(0~1)").optional(),
        LockedToPart: z.boolean().optional(),
        Orientation: z
          .enum(["FacingCamera", "FacingCameraWorldUp", "VelocityParallel", "VelocityPerpendicular"])
          .optional(),
        Rate: z.number().optional(),
        RotSpeed: z.number().optional(),
        Rotation: numberRange.optional(),
        Shape: z.enum(["Box", "Sphere", "Cylinder", "Disc"]).optional(),
        ShapeInOut: z.enum(["OutWard", "InWard"]).optional(),
        ShapeStyle: z.enum(["Volume", "Surface"]).optional(),
        Size: numberSequence.optional(),
        Speed: numberRange.optional(),
        SpreadAngle: z.number().optional(),
        Squash: numberSequence.optional(),
        Texture: z.string().describe("Texture asset ID").optional(),
        Transparency: numberSequence.optional(),
      })
      .strict()
      .describe(
        "Use when class=ParticleEmitter. Full particle system configuration: emission shape, color/size/transparency curves, flipbook animation, and physics.",
      ),
    z
      .object({
        Brightness: z.number().optional(),
        Color: rgb.optional(),
        Enabled: z.boolean().optional(),
        Range: z.number().describe("Radius of illumination in studs").optional(),
        Shadows: z.boolean().optional(),
      })
      .strict()
      .describe(
        "Use when class=PointLight. Omnidirectional light source; configure color, brightness, range, and shadows.",
      ),
    z
      .object({
        Angle: z.number().describe("Cone half-angle in degrees").optional(),
        Brightness: z.number().optional(),
        Color: rgb.optional(),
        Enabled: z.boolean().optional(),
        Face: normalIdEnum.optional(),
        Range: z.number().describe("Radius of illumination in studs").optional(),
        Shadows: z.boolean().optional(),
      })
      .strict()
      .describe(
        "Use when class=SpotLight. Cone-shaped directional light; configure angle, face, color, brightness, range, and shadows.",
      ),
    z
      .object({ Value: z.string().optional() })
      .strict()
      .describe("Use when class=StringValue. Stores a single string value."),
    z
      .object({ Value: z.number().optional() })
      .strict()
      .describe("Use when class=NumberValue. Stores a single floating-point value."),
    z
      .object({ Value: z.boolean().optional() })
      .strict()
      .describe("Use when class=BoolValue. Stores a single boolean value."),
    z
      .object({ Value: z.number().int().optional() })
      .strict()
      .describe("Use when class=IntValue. Stores a single integer value."),
    z
      .object({
        Shape: z.enum(["Block", "Ball", "Cylinder"]).optional(),
        CFrame: z.object({ Position: vec3, Orientation: vec3 }).optional(),
        Size: vec3.describe("units in cm").optional(),
        Anchored: z.boolean().optional(),
        CanCollide: z.boolean().optional(),
        CanQuery: z.boolean().optional(),
        CanTouch: z.boolean().optional(),
        CastShadow: z.boolean().optional(),
        CollisionGroup: z.string().optional(),
        Color: rgb.optional(),
        DoubleSided: z.boolean().optional(),
        EnableMeshShadowDetails: z.boolean().optional(),
        Locked: z.boolean().optional(),
        Massless: z.boolean().optional(),
        Material: materialEnum.optional(),
        MaterialVariant: z.string().optional(),
        MeshId: z.string().describe("Mesh asset ID").optional(),
        Reflectance: z.number().describe("(0~1)").optional(),
        RootPriority: z.number().optional(),
        TextureId: z.string().describe("Surface texture asset ID").optional(),
        Transparency: z.number().describe("(0~1)").optional(),
      })
      .strict()
      .describe(
        "Use when class=MeshPart. BasePart with a custom mesh; all Part physics/collision properties apply plus MeshId and TextureId.",
      ),
    z
      .object({ AnimationId: z.string().describe("Animation asset ID").optional() })
      .strict()
      .describe("Use when class=Animation. References an animation asset to be loaded by an Animator."),
    z
      .object({
        Head: z.string().describe("Head mesh asset ID").optional(),
        Torso: z.string().describe("Torso mesh asset ID").optional(),
        LeftArm: z.string().describe("Left arm mesh asset ID").optional(),
        RightArm: z.string().describe("Right arm mesh asset ID").optional(),
        LeftLeg: z.string().describe("Left leg mesh asset ID").optional(),
        RightLeg: z.string().describe("Right leg mesh asset ID").optional(),
        HeadColor: rgb.optional(),
        TorsoColor: rgb.optional(),
        LeftArmColor: rgb.optional(),
        RightArmColor: rgb.optional(),
        LeftLegColor: rgb.optional(),
        RightLegColor: rgb.optional(),
        HeadTextureId: z.string().describe("Head texture asset ID").optional(),
        TorsoTextureId: z.string().describe("Torso texture asset ID").optional(),
        LeftArmTextureId: z.string().describe("Left arm texture asset ID").optional(),
        RightArmTextureId: z.string().describe("Right arm texture asset ID").optional(),
        LeftLegTextureId: z.string().describe("Left leg texture asset ID").optional(),
        RightLegTextureId: z.string().describe("Right leg texture asset ID").optional(),
        IdleAnimation: z.string().describe("Animation asset ID").optional(),
        WalkAnimation: z.string().describe("Animation asset ID").optional(),
        RunAnimation: z.string().describe("Animation asset ID").optional(),
        JumpAnimation: z.string().describe("Animation asset ID").optional(),
        FallAnimation: z.string().describe("Animation asset ID").optional(),
        LandedAnimation: z.string().describe("Animation asset ID").optional(),
        ClimbAnimation: z.string().describe("Animation asset ID").optional(),
        SwimmingIdleAnimation: z.string().describe("Animation asset ID").optional(),
        SwimmingBreaststrokeAnimation: z.string().describe("Animation asset ID").optional(),
        SprintAnimation: z.string().describe("Animation asset ID").optional(),
        MoodAnimation: z.string().describe("Animation asset ID").optional(),
        DieAnimation: z.string().describe("Animation asset ID").optional(),
        HeightScale: z.number().describe("Character y-axis scale").optional(),
        DepthScale: z.number().describe("Character z-axis scale").optional(),
        WidthScale: z.number().describe("Character x-axis scale").optional(),
        HeadScale: z.number().optional(),
        BodyTypeScale: z.number().optional(),
        ProportionScale: z.number().optional(),
        Face: z.string().describe("Face asset ID").optional(),
        Shirt: z.string().describe("Shirt asset ID").optional(),
        Pants: z.string().describe("Pants asset ID").optional(),
        GraphicTShirt: z.string().describe("Graphic T-Shirt asset ID").optional(),
        HatAccessory: z.string().describe("Hat asset ID").optional(),
        HairAccessory: z.string().describe("Hair asset ID").optional(),
        FaceAccessory: z.string().describe("Face accessory asset ID").optional(),
        NeckAccessory: z.string().describe("Neck accessory asset ID").optional(),
        ShoulderAccessory: z.string().describe("Shoulder accessory asset ID").optional(),
        FrontAccessory: z.string().describe("Front accessory asset ID").optional(),
        BackAccessory: z.string().describe("Back accessory asset ID").optional(),
        WaistAccessory: z.string().describe("Waist accessory asset ID").optional(),
        AccessoryBlob: z.string().describe("JSON accessory blob").optional(),
      })
      .strict()
      .describe(
        "Use when class=HumanoidDescription. Configures character appearance: body part meshes, textures, colors, animations, scale, and accessories.",
      ),
  ])
  .optional();

// Shape spec for deep-stripping unknown keys when reading .ovdrjm nodes.
// `true` = keep the value as-is (primitive). Object = recurse and strip unknown keys.
// When the actual value is an array, the shape is applied to each element.
export type ShapeSpec = true | { readonly [key: string]: ShapeSpec };

const vec3Shape = { X: true, Y: true, Z: true } as const satisfies ShapeSpec;
const rgbShape = { R: true, G: true, B: true } as const satisfies ShapeSpec;
const udim2Shape = { XScale: true, XOffset: true, YScale: true, YOffset: true } as const satisfies ShapeSpec;
const udimShape = { Scale: true, Offset: true } as const satisfies ShapeSpec;
const cframeShape = { Position: vec3Shape, Orientation: vec3Shape } as const satisfies ShapeSpec;
const vec2Shape = { X: true, Y: true } as const satisfies ShapeSpec;

const guiObjectShape: Record<string, ShapeSpec> = {
  Active: true,
  AnchorPoint: vec2Shape,
  BackgroundColor3: rgbShape,
  BackgroundTransparency: true,
  ClipsDescendants: true,
  LayoutOrder: true,
  Position: udim2Shape,
  Rotation: true,
  Size: udim2Shape,
  Visible: true,
  ZIndex: true,
};

const textShape: Record<string, ShapeSpec> = {
  Bold: true,
  Text: true,
  TextColor3: rgbShape,
  TextScaled: true,
  TextSize: true,
  TextTransparency: true,
  TextWrapped: true,
  TextXAlignment: true,
  TextYAlignment: true,
};

export const classPropertyShapes: Record<string, Record<string, ShapeSpec>> = {
  Part: {
    Shape: true,
    CFrame: cframeShape,
    Size: vec3Shape,
    Anchored: true,
    CanCollide: true,
    CanQuery: true,
    CanTouch: true,
    CastShadow: true,
    CollisionGroup: true,
    Color: rgbShape,
    Locked: true,
    Mass: true,
    Massless: true,
    Material: true,
    MaterialVariant: true,
    Reflectance: true,
    RootPriority: true,
    Transparency: true,
  },
  Frame: { ...guiObjectShape, BorderColor3: rgbShape, BorderMode: true, BorderPixelSize: true },
  ImageButton: {
    Image: true,
    ImageColor3: rgbShape,
    ImageTransparency: true,
    PressImage: true,
    HoverImage: true,
    ...guiObjectShape,
  },
  ImageLabel: { Image: true, ImageColor3: rgbShape, ImageTransparency: true, ...guiObjectShape },
  TextButton: { ...textShape, ...guiObjectShape },
  TextLabel: { ...textShape, ...guiObjectShape },
  Sound: {
    SoundId: true,
    Volume: true,
    Looped: true,
    PlaybackSpeed: true,
    PlayOnRemove: true,
    RollOffMaxDistance: true,
    RollOffMinDistance: true,
    RollOffMode: true,
    StartTimePosition: true,
  },
  RemoteEvent: {},
  Tool: { CanBeDropped: true, Enabled: true, ManualActivationOnly: true, RequiresHandle: true, ToolTip: true },
  VFXPreset: {
    PresetName: true,
    Color: { Time: true, Color: rgbShape },
    Enabled: true,
    InfiniteLoop: true,
    LoopCount: true,
    Size: true,
    Transparency: true,
  },
  AngularVelocity: {
    AngularVelocity: vec3Shape,
    Enabled: true,
    MaxTorque: true,
    ReactionTorqueEnabled: true,
    RelativeTo: true,
    Visible: true,
  },
  LinearVelocity: {
    VelocityConstraintMode: true,
    VectorVelocity: vec3Shape,
    LineDirection: vec3Shape,
    LineVelocity: true,
    PlaneVelocity: vec2Shape,
    PrimaryTangentAxis: vec3Shape,
    SecondaryTangentAxis: vec3Shape,
    Enabled: true,
    ForceLimitsEnabled: true,
    ForceLimitMode: true,
    MaxForce: true,
    MaxAxesForce: vec3Shape,
    RelativeTo: true,
    Visible: true,
  },
  VectorForce: { Force: vec3Shape, ApplyAtCenterOfMass: true, Enabled: true, RelativeTo: true, Visible: true },
  Model: { PrimaryPart: true, WorldPivot: cframeShape },
  Folder: {},
  ScrollingFrame: {
    AutomaticCanvasSize: true,
    CanvasPosition: vec2Shape,
    CanvasSize: udim2Shape,
    ScrollBarImageColor3: rgbShape,
    ScrollBarImageTransparency: true,
    ScrollBarThickness: true,
    ScrollingDirection: true,
    ScrollingEnabled: true,
    ...guiObjectShape,
  },
  UIListLayout: {
    Padding: udimShape,
    Wraps: true,
    FillDirection: true,
    HorizontalAlignment: true,
    VerticalAlignment: true,
    SortOrder: true,
  },
  UIGridLayout: {
    CellPadding: udim2Shape,
    CellSize: udim2Shape,
    FillDirectionMaxCells: true,
    FillDirection: true,
    HorizontalAlignment: true,
    VerticalAlignment: true,
    SortOrder: true,
  },
  BillboardGui: {
    Active: true,
    AlwaysOnTop: true,
    Brightness: true,
    ClipsDescendants: true,
    DistanceLowerLimit: true,
    DistanceUpperLimit: true,
    Enabled: true,
    ExtentsOffsetWorldSpace: vec3Shape,
    LightInfluence: true,
    MaxDistance: true,
    PositionOffset: vec3Shape,
    Size: udim2Shape,
    SizeOffset: vec2Shape,
    ZIndexBehavior: true,
  },
  SurfaceGui: {
    Active: true,
    AlwaysOnTop: true,
    Brightness: true,
    ClipsDescendants: true,
    Enabled: true,
    Face: true,
    LightInfluence: true,
    MaxDistance: true,
    Size: udim2Shape,
    ZIndexBehavior: true,
    ZOffset: true,
  },
  BindableEvent: {},
  Attachment: { Axis: vec3Shape, CFrame: cframeShape, SecondaryAxis: vec3Shape },
  Beam: {
    Color: { Time: true, Color: rgbShape },
    CurveSize0: true,
    CurveSize1: true,
    Enabled: true,
    FaceCamera: true,
    Texture: true,
    TextureLength: true,
    TextureSpeed: true,
    Transparency: { Time: true, Value: true, Envelope: true },
    Width0: true,
    Width1: true,
  },
  Trail: {
    Color: { Time: true, Color: rgbShape },
    Enabled: true,
    Lifetime: true,
    Offset: vec3Shape,
    Texture: true,
    TextureLength: true,
    TextureSpeed: true,
    Transparency: { Time: true, Value: true, Envelope: true },
    Width: true,
    WidthScale: { Time: true, Value: true, Envelope: true },
  },
  ParticleEmitter: {
    Acceleration: vec3Shape,
    Brightness: true,
    Color: { Time: true, Color: rgbShape },
    Drag: true,
    EmissionDirection: true,
    Enabled: true,
    FlipbookFramerate: { Min: true, Max: true },
    FlipbookLayout: true,
    FlipbookMode: true,
    FlipbookStartRandom: true,
    LifeTime: { Min: true, Max: true },
    LightEmission: true,
    LockedToPart: true,
    Orientation: true,
    Rate: true,
    RotSpeed: true,
    Rotation: { Min: true, Max: true },
    Shape: true,
    ShapeInOut: true,
    ShapeStyle: true,
    Size: { Time: true, Value: true, Envelope: true },
    Speed: { Min: true, Max: true },
    SpreadAngle: true,
    Squash: { Time: true, Value: true, Envelope: true },
    Texture: true,
    Transparency: { Time: true, Value: true, Envelope: true },
  },
  PointLight: { Brightness: true, Color: rgbShape, Enabled: true, Range: true, Shadows: true },
  SpotLight: { Angle: true, Brightness: true, Color: rgbShape, Enabled: true, Face: true, Range: true, Shadows: true },
  StringValue: { Value: true },
  NumberValue: { Value: true },
  BoolValue: { Value: true },
  IntValue: { Value: true },
  MeshPart: {
    Shape: true,
    CFrame: cframeShape,
    Size: vec3Shape,
    Anchored: true,
    CanCollide: true,
    CanQuery: true,
    CanTouch: true,
    CastShadow: true,
    CollisionGroup: true,
    Color: rgbShape,
    DoubleSided: true,
    EnableMeshShadowDetails: true,
    Locked: true,
    Massless: true,
    Material: true,
    MaterialVariant: true,
    MeshId: true,
    Reflectance: true,
    RootPriority: true,
    TextureId: true,
    Transparency: true,
  },
  Animation: { AnimationId: true },
  HumanoidDescription: {
    Head: true,
    Torso: true,
    LeftArm: true,
    RightArm: true,
    LeftLeg: true,
    RightLeg: true,
    HeadColor: rgbShape,
    TorsoColor: rgbShape,
    LeftArmColor: rgbShape,
    RightArmColor: rgbShape,
    LeftLegColor: rgbShape,
    RightLegColor: rgbShape,
    HeadTextureId: true,
    TorsoTextureId: true,
    LeftArmTextureId: true,
    RightArmTextureId: true,
    LeftLegTextureId: true,
    RightLegTextureId: true,
    IdleAnimation: true,
    WalkAnimation: true,
    RunAnimation: true,
    JumpAnimation: true,
    FallAnimation: true,
    LandedAnimation: true,
    ClimbAnimation: true,
    SwimmingIdleAnimation: true,
    SwimmingBreaststrokeAnimation: true,
    SprintAnimation: true,
    MoodAnimation: true,
    DieAnimation: true,
    HeightScale: true,
    DepthScale: true,
    WidthScale: true,
    HeadScale: true,
    BodyTypeScale: true,
    ProportionScale: true,
    Face: true,
    Shirt: true,
    Pants: true,
    GraphicTShirt: true,
    HatAccessory: true,
    HairAccessory: true,
    FaceAccessory: true,
    NeckAccessory: true,
    ShoulderAccessory: true,
    FrontAccessory: true,
    BackAccessory: true,
    WaistAccessory: true,
    AccessoryBlob: true,
  },
};
