// @summary Sidecar-owned notes and supplementary properties merged into live instance schema search results.

/** A property Studio's schema omits but Editor Luau can read and write. */
export interface SupplementProperty {
  declaredOn: string;
  valueSchema: Record<string, unknown>;
  note: string;
}

const number = { type: "number" } as const;
const unit = { type: "number", minimum: 0, maximum: 1 } as const;
const channel = { type: "integer", minimum: 0, maximum: 255 } as const;
const vector3 = {
  type: "object",
  struct: "Vector3",
  properties: { X: number, Y: number, Z: number },
  required: ["X", "Y", "Z"],
} as const;
const colorKeypoints = {
  type: "array",
  items: {
    type: "object",
    properties: { R: channel, G: channel, B: channel, Time: unit },
    required: ["R", "G", "B", "Time"],
  },
} as const;
const alphaKeypoints = {
  type: "array",
  items: { type: "object", properties: { Time: unit, Value: unit }, required: ["Time", "Value"] },
} as const;

/** Instance-level notes. Studio's catalog carries no class descriptions in current builds. */
export const classNotes: Readonly<Record<string, string>> = {
  Part: "A 3D primitive shape (Block, Ball, Cylinder) with physics and collision.",
  MeshPart: "BasePart with a custom mesh asset; shares Part physics and collision properties.",
  SpawnLocation: "Player spawn point; shares Part physics and collision properties.",
  Model: "Groups BaseParts into one unit for physics, movement and rotation.",
  ProceduralModel:
    "A recipe-backed Model with writable pivots, build dimensions and automatic rebuilding. Author recipes with the procedural-model-builder workflow.",
  Folder: "Logical organizer with no class-specific properties; use it to group scripts or non-physical instances.",
  Outline: "Overlay effect drawing an edge color/thickness around its Adornee.",
  Fill: "Overlay effect filling its Adornee with a color.",
  Attachment: "Local coordinate frame on a BasePart for constraints and effects.",
  Bone: "Named transform node inside a Skeleton.",
  Skeleton: "Bone hierarchy driving a skinned mesh.",
  WrapLayer: "Clothing wrap layer ordering.",
  Constraint: "Abstract base for physics constraints between two Attachments; create a concrete subclass.",
  AngularVelocity: "Applies a target rotational velocity to a physics body.",
  LinearVelocity: "Applies a target linear velocity to a physics body.",
  VectorForce: "Applies a constant force vector to a physics body, optionally at its center of mass.",
  PointLight: "Omnidirectional point light.",
  SpotLight: "Cone-shaped directional light.",
  Beam: "Visual beam rendered between Attachment0 and Attachment1.",
  Trail: "Motion trail rendered between Attachment0 and Attachment1.",
  ParticleEmitter: "Particle system with emission shape, flipbook animation and physics.",
  VFXPreset:
    "A named built-in visual effect. Select it with PresetName using the PresetName column of the vfx-recipe skill's references/presets.md.",
  VFXRecipe:
    "Custom layered VFX: Base/Detail/Extra layer items, each playing a VFX source asset with per-source parameters. Studio reports creatable:false and omits the layer arrays; create and edit recipes with studiorpc_vfx_recipe_upsert (vfx-recipe skill), not Editor Luau, and read complete layers with studiorpc_instance_read.",
  Sound: "Audio source with 3D spatial roll-off.",
  SoundGroup: "Groups Sounds under a shared volume multiplier.",
  Animation: "References an animation asset loaded by an Animator.",
  Humanoid: "Character controller: health, movement, jumping and camera behaviour.",
  HumanoidDescription: "A character's appearance: body parts, animations and accessories.",
  Camera: "The world camera view and behaviour.",
  MaterialVariant: "Custom material override with PBR texture maps.",
  SimulationBall: "Physics-simulated ball with trajectory and path markers.",
  Tool: "An equippable item a player can pick up and activate.",
  ProximityPrompt: "Interaction prompt shown when a player approaches.",
  ActionSequence: "Its sequence payload is owned by the Action Sequencer editor.",
  Team: "Player team identified by its BrickColor.",
  RemoteEvent: "No configurable properties beyond Name.",
  BindableEvent: "No configurable properties beyond Name.",
  StringValue: "Stores one string Value.",
  NumberValue: "Stores one floating-point Value.",
  BoolValue: "Stores one boolean Value.",
  IntValue: "Stores one integer Value.",
  Script: "Server Lua script. Edit Source with the script tools.",
  LocalScript: "Client Lua script. Edit Source with the script tools.",
  ModuleScript: "Lua module returned by require(). Edit Source with the script tools.",
  ScreenGui: "Full-screen GUI container for HUD and menus.",
  BillboardGui: "World-space GUI that faces the camera, anchored to its Adornee.",
  SurfaceGui: "GUI rendered on one face of a Part.",
  Frame: "GUI container with optional border styling.",
  ScrollingFrame: "Scrollable GUI container for overflowing content such as inventories or logs.",
  ImageButton: "Clickable GUI image with press/hover images.",
  ImageLabel: "Non-interactive GUI image.",
  TextButton: "Clickable GUI text.",
  TextLabel: "Non-interactive GUI text.",
  ProgressBar: "GUI progress bar with separately styled track and fill; linear or radial fill.",
  UIListLayout: "Arranges sibling GUI elements in a horizontal or vertical list.",
  UIGridLayout: "Arranges sibling GUI elements in a uniform grid.",
  UIGridStyleLayout: "Abstract base of UIListLayout and UIGridLayout; create one of those instead.",
  UIAspectRatioConstraint: "Locks the aspect ratio of its parent GUI element.",
  UIStroke: "Outline stroke on the parent GuiObject's border or text.",
  Workspace: "Service: world gravity and hitbox type.",
  Lighting: "Service: time of day, sun/moon, sky colors and ambient lighting.",
  Atmosphere: "Service: fog, haze, glare and clouds.",
  Players: "Service: character auto-loading and respawn.",
  StarterPlayer: "Service: character movement, physics and camera defaults.",
  MaterialService: "Service: each property maps a base material to the name of its custom MaterialVariant.",
};

const assetId = 'Asset ID string, e.g. "ovdrassetid://<id>".';
const assetNotes = (keys: readonly string[], prefix = ""): Record<string, string> =>
  Object.fromEntries(keys.map((key) => [key, `${prefix}${assetId}`]));
const humanoidDescription = (names: readonly string[], kind: string): Record<string, string> =>
  assetNotes(
    names.map((name) => `HumanoidDescription.${name}`),
    `${kind} `,
  );
const cframeNote = "Position in cm; Orientation in degrees.";
const retiredCap = (max: number) =>
  `Keep at or below ${max}; the retired upsert validator capped it there and Studio publishes no maximum.`;

/**
 * Notes keyed by `<Class>.<Property>` or `<declaredOn>.<Property>`; the exact class key wins, so an inherited
 * property can be annotated once on its declaring class.
 */
export const propertyNotes: Readonly<Record<string, string>> = {
  "Instance.Mobility":
    "Settable only on top-level Workspace objects (direct children of Workspace). Use Enum.MobilityMode.Static or Enum.MobilityMode.Movable.",
  "BasePart.Size": "Centimeters.",
  "BasePart.CFrame": cframeNote,
  "Attachment.CFrame": `Local to the parent part. ${cframeNote}`,
  "Camera.CFrame": cframeNote,
  "SimulationBall.CFrame": cframeNote,
  "PVInstance.PivotOffsetCFrame": `${cframeNote} Its writeCondition flag bActivePivotOffset is internal and not in the schema; read the value back after assigning.`,
  "MaterialVariant.BaseMaterial":
    "Its writeCondition flag bIsPresetMaterial is internal and not in the schema; read the value back after assigning.",
  "ProceduralModel.Size": "Build dimensions in cm, Y up.",
  "ProceduralModel.AutoRebuild": "Whether input changes automatically rebuild the recipe.",
  "Attachment.WorldAxis": "Unit direction of the X axis in world space.",
  "Attachment.WorldSecondaryAxis": "Unit direction of the Y axis in world space.",
  "Bone.Transform": "Current animated offset of the bone in its local space.",
  "Tool.Grip": "The tool's grip offset as one CFrame.",
  "BackpackItem.TextureId": `Backpack icon. ${assetId}`,
  "LinearVelocity.VelocityConstraintMode":
    "Use Vector. Line and Plane exist in the editor, but their parameters are not serialized.",
  "PointLight.Range": "Illumination radius in world units (cm).",
  "SpotLight.Range": "Illumination radius in world units (cm).",
  "SpotLight.Angle": "Cone half-angle in degrees.",
  "Sound.Volume": "Volume multiplier.",
  "Sound.TimePosition": "Playback position in seconds; settable before and during playback.",
  "SoundGroup.Volume": "Volume multiplier applied to grouped Sounds, 0-10.",
  "ImageButton.ScaleType": "How the image fills the element. Slice keeps the corners at their source size.",
  "ImageLabel.ScaleType": "How the image fills the element. Slice keeps the corners at their source size.",
  "ImageButton.SliceCenter":
    "9-slice boundaries in source-image pixels from the top-left; MinX <= MaxX and MinY <= MaxY.",
  "ImageLabel.SliceCenter":
    "9-slice boundaries in source-image pixels from the top-left; MinX <= MaxX and MinY <= MaxY.",
  "ImageButton.SliceScale": "Multiplier for 9-slice edge thickness.",
  "ImageLabel.SliceScale": "Multiplier for 9-slice edge thickness.",
  "ScrollingFrame.CanvasPosition": "Scroll offset.",
  "ScrollingFrame.CanvasSize": "Total scrollable area.",
  "UIListLayout.Padding": "Space between list items.",
  "UIGridLayout.CellPadding": "Space between grid cells.",
  "UIGridLayout.CellSize": "Uniform size of each grid cell.",
  "UIGridStyleLayout.HorizontalAlignment":
    "Engine default is Left; set it only when the design needs another alignment.",
  "UIGridStyleLayout.VerticalAlignment": "Engine default is Top; set it only when the design needs another alignment.",
  "SurfaceGuiBase.Size": "Canvas size.",
  "BillboardGui.SizeOffset": "Screen-space size offset.",
  "UIStroke.ApplyStrokeMode": "Contextual is valid only on TextLabel/TextButton; use Border otherwise.",
  "UIStroke.ZIndex": "Display priority among overlapping UIStrokes, not the general GUI ZIndex.",
  "ProgressBar.Value": "Fill amount, 0-1.",
  "Humanoid.AutomaticScalingEnabled": "Scale the character to the HumanoidDescription values.",
  "Humanoid.DisplayDistanceType": "Distance behaviour of the name and health display.",
  "HumanoidDescription.HeightScale": "Character Y-axis scale.",
  "HumanoidDescription.DepthScale": "Character Z-axis scale.",
  "HumanoidDescription.WidthScale": "Character X-axis scale.",
  "HumanoidDescription.AccessoryBlob": "JSON accessory blob.",
  "WorldRoot.AllowDebugDraw": "Enables WorldRoot Draw* debug rendering.",
  ...assetNotes([
    "ImageButton.Image",
    "ImageButton.PressImage",
    "ImageButton.HoverImage",
    "ImageLabel.Image",
    "ProgressBar.FillImage",
    "ProgressBar.TrackImage",
    "Beam.Texture",
    "Trail.Texture",
    "ParticleEmitter.Texture",
    "MeshPart.MeshId",
    "MeshPart.TextureId",
    "SimulationBall.TextureId",
    "Sound.SoundId",
    "Animation.AnimationId",
    "Atmosphere.CloudTexture",
    "Skeleton.SkeletonId",
  ]),
  ...humanoidDescription(["Head", "Torso", "LeftArm", "RightArm", "LeftLeg", "RightLeg"], "Mesh."),
  ...humanoidDescription(
    [
      "HeadTextureId",
      "TorsoTextureId",
      "LeftArmTextureId",
      "RightArmTextureId",
      "LeftLegTextureId",
      "RightLegTextureId",
    ],
    "Texture.",
  ),
  ...humanoidDescription(
    [
      "IdleAnimation",
      "WalkAnimation",
      "RunAnimation",
      "JumpAnimation",
      "FallAnimation",
      "LandedAnimation",
      "ClimbAnimation",
      "SwimmingIdleAnimation",
      "SwimmingBreaststrokeAnimation",
      "SprintAnimation",
      "MoodAnimation",
      "DieAnimation",
    ],
    "Animation.",
  ),
  ...humanoidDescription(
    [
      "Face",
      "Shirt",
      "Pants",
      "GraphicTShirt",
      "HatAccessory",
      "HairAccessory",
      "FaceAccessory",
      "NeckAccessory",
      "ShoulderAccessory",
      "FrontAccessory",
      "BackAccessory",
      "WaistAccessory",
    ],
    "Clothing or accessory.",
  ),
  "SimulationBall.AfterBounceAngularMultiply":
    "Multiplier for angular velocity from contact friction after a bounce; 1.0 = 100%.",
  "SimulationBall.BeforeBounceAngularRetention": "Fraction of pre-bounce angular velocity retained after impact.",
  "SimulationBall.BPStaticStepAheadSteps": "Static simulation steps covered by one broad-phase AABB.",
  "SimulationBall.BallRadius": "Collision radius in cm.",
  "SimulationBall.TargetRadius": "Target hit radius in cm for trajectory-to-target tests.",
  "SimulationBall.DetectBounceThreshold": "Normal impulse separating a bounce from a sliding contact.",
  "SimulationBall.MaxAllowedImpulse": "Cap on normal impulse during collision response.",
  "SimulationBall.RestingMovementEpsilon": "Max per-frame movement in cm still counted as resting.",
  "SimulationBall.RestingSpinSpeedThreshold": "Spin speed in RPM below which resting spin snaps to zero.",
  "SimulationBall.RestingToSleepingFrameThreshold": "Resting frames required before angular velocity snaps to zero.",
  "SimulationBall.SameSurfaceNormalDegree": "Max normal angle in degrees for treating two contacts as one surface.",
  "SimulationBall.SimulationTraceChannel": "Trace channel for static collision sweeps.",
  "SimulationBall.SlomoFactor": "Preview playback speed multiplier; 1.0 is normal speed.",
  "SimulationBall.bEnableBroadPhase": "Skip expensive sweeps when the broad-phase AABB finds no candidates.",
  "SimulationBall.bEnableMicroBounceRemoval": "Remove micro-bounces on low-speed ground contacts.",
  "SimulationBall.bKeepPassedMarkers": "Keep markers for the already-played path visible.",
  "SimulationBall.bPausedWhenSleeping": "Pause playback while the simulation snapshot is sleeping.",
  "SimulationBall.bTraceComplex": "Use complex triangle-mesh collision instead of simple shapes.",
  "SimulationBall.bUseRestingContactToSleep": "Let near-static ground contacts put the ball to sleep.",
  "Lighting.AmbientSkyBrightness": retiredCap(10),
  "Lighting.Contrast": retiredCap(2),
  "Lighting.MoonBrightness": retiredCap(3),
  "Lighting.MoonMaxHeight": retiredCap(90),
  "Lighting.NightBrightness": retiredCap(3),
  "Lighting.StarsBrightness": retiredCap(8),
  "Lighting.SunBrightness": retiredCap(50),
  "Lighting.SunMaxHeight": retiredCap(85),
};

/** Engine sentinel enum members that Studio exports but that are not real choices. */
const materialSentinels = ["Max", "LastMaterial"] as const;
export const hiddenEnumValues: Readonly<Record<string, readonly string[]>> = {
  "BasePart.Material": materialSentinels,
  "MaterialVariant.BaseMaterial": materialSentinels,
  "SimulationBall.Material": materialSentinels,
};

/** Properties Studio's schema omits but Editor Luau reads and writes (verified against a live Studio build). */
export const supplementProperties: Readonly<Record<string, Readonly<Record<string, SupplementProperty>>>> = {
  VFXPreset: {
    PresetName: {
      declaredOn: "VFXPreset",
      valueSchema: { type: "string" },
      note: 'The exact PresetName column of the vfx-recipe skill\'s references/presets.md, e.g. "Muzzle"; not the Resource or upstream DisplayName, and never an UNAVAILABLE row. Unknown names are silently ignored and keep the previous value (a new preset starts as "Fire"), so read PresetName back to confirm before setting other parameters.',
    },
    Color: {
      declaredOn: "VFXPreset",
      valueSchema: colorKeypoints,
      note: "Color keypoints over the effect lifetime. Read the value back after assigning from Luau.",
    },
    Alpha: {
      declaredOn: "VFXPreset",
      valueSchema: alphaKeypoints,
      note: "Opacity keypoints over the effect lifetime. Read the value back after assigning from Luau.",
    },
    Size: { declaredOn: "VFXPreset", valueSchema: number, note: "Effect scale multiplier." },
    Transparency: { declaredOn: "VFXPreset", valueSchema: unit, note: "Overall transparency." },
    Importance: {
      declaredOn: "VFXPreset",
      valueSchema: { type: "string" },
      note: 'Reads back as "Default"; Editor Luau rejects other tried values (Low, High, Normal). Leave it unset.',
    },
  },
  MaterialVariant: {
    UseCustomPhysicsProperties: {
      declaredOn: "MaterialVariant",
      valueSchema: { type: "boolean" },
      note: "Enables CustomPhysicalProperties for parts using this variant.",
    },
  },
  SimulationBall: {
    MicroBounceThresholdMult: {
      declaredOn: "SimulationBall",
      valueSchema: number,
      note: "Micro-bounce detection threshold multiplier used with bEnableMicroBounceRemoval.",
    },
    BallSimParams: {
      declaredOn: "SimulationBall",
      valueSchema: {
        type: "object",
        struct: "BallSimParams",
        properties: Object.fromEntries([
          ...[
            "BaseGravity",
            "DampingAngular",
            "DampingLinear",
            "Friction",
            "GravityFalloffEndHeight",
            "GravityFalloffStartHeight",
            "InertiaScale",
            "InitialSpeed",
            "InitialSpinSpeed",
            "Mass",
            "MaxSpeedForMagnus",
            "MinFalloffGravity",
            "MinSpeedForMagnus",
            "MinSpinForMagnus",
            "Restitution",
            "RollingFriction",
            "Simsteps",
            "SpinMagnusWeight",
            "StepsPerSecond",
          ].map((key) => [key, number]),
          ["EnableGravityFalloff", { type: "boolean" }],
          ["bForwardSpaceSpinAxis", { type: "boolean" }],
          ["InitialDirection", vector3],
          ["InitialSpinAxis", vector3],
          [
            "InitialCFrame",
            {
              type: "object",
              struct: "CFrame",
              properties: { Position: vector3, Orientation: vector3 },
              required: ["Position", "Orientation"],
            },
          ],
        ]),
      },
      note: "Solver seed state; supply every field when assigning. Read the value back after assigning from Luau.",
    },
  },
};

/**
 * How each JSON value shape is written in Editor Luau. Keys are valueSchema `struct` names plus the
 * pseudo-types Enum and Reference. Constructors and conversions were checked against a live Editor VM.
 */
export const valueTypeNotes: Readonly<Record<string, string>> = {
  Vector3: "Vector3.new(X, Y, Z). Distances are cm.",
  Vector2: "Vector2.new(X, Y).",
  Color3:
    "JSON R/G/B are 0-255 and equal Color3.fromRGB(R, G, B). Color3.new takes linear 0-1 values (Color3.new(1, 0.5, 0) stores G=188), so do not divide by 255.",
  UDim: "UDim.new(Scale, Offset).",
  UDim2: "UDim2.new(XScale, XOffset, YScale, YOffset); UDim2.fromScale/fromOffset are unavailable in the Editor VM.",
  CFrame:
    "Position is cm and Orientation is degrees: CFrame.new(X, Y, Z) * CFrame.fromOrientation(math.rad(OX), math.rad(OY), math.rad(OZ)).",
  Rect: "Rect.new(MinX, MinY, MaxX, MaxY).",
  PhysicalProperties: "PhysicalProperties.new(Density, Friction, Elasticity).",
  NumberRange: "NumberRange.new(Min, Max).",
  ColorSequence:
    "ColorSequence.new({ ColorSequenceKeypoint.new(time, Color3.fromRGB(r, g, b)), ... }); JSON keypoints use lowercase time/value/r/g/b.",
  NumberSequence: "NumberSequence.new({ NumberSequenceKeypoint.new(time, value), ... }).",
  Font: "Font.fromName(Family, Enum.FontWeight.<Weight>, Enum.FontStyle.<Style>); see the gui-builder fonts reference for families.",
  BrickColor: 'BrickColor.new("Bright red") (palette name).',
  Content: 'Asset reference; JSON {"Content": "ovdrassetid://<id>"}. Read the value back after assigning from Luau.',
  Value: 'ValueBase JSON is {Type, <Type>: value}; in Luau assign the plain value (stringValue.Value = "text").',
  Enum: 'Assign Enum.<EnumType>.<Value> or the plain value string (part.Material = "Wood"). The schema lists values, not enum type names.',
  Reference:
    "Instance reference; the JSON {Type, Value} pair is an internal handle. In Luau assign the instance itself (model.PrimaryPart = part).",
};
