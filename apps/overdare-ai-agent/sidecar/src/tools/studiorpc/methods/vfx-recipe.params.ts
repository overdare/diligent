// @summary Defines the VFXRecipe property schema and source-name expansion for the dedicated recipe tool.
import { z } from "zod";

/**
 * Studio names the type inside the value (`{"ObjectType":"Vector3", ...}`) in the .ovdrjm and over
 * instance.create/instance.update alike, and the RPCs reject an untagged value. Callers write the
 * bare shape; the literal default adds the tag. Measured against Studio 2026-08-27.
 */
function tagged<const N extends string, S extends z.ZodRawShape>(name: N, shape: S) {
  return z.object({ ObjectType: z.literal(name).default(name), ...shape });
}

const vec3 = tagged("Vector3", { X: z.number(), Y: z.number(), Z: z.number() });
const colorChannel = z.number().int().min(0).max(255);
const mobilityEnum = z
  .enum(["Static", "Movable"])
  .describe("Movable or Static; settable only on top-level Workspace objects (direct children of Workspace).");

const vfxColorSequence = z
  .array(
    z.object({
      ObjectType: z.literal("Color3").default("Color3"),
      R: colorChannel,
      G: colorChannel,
      B: colorChannel,
      Time: z.number().describe("(0~1)"),
    }),
  )
  .describe("Particle color keypoints over the source lifetime [{R,G,B,Time}]");
/**
 * A VFXRecipe layer takes Alpha keypoints as the list itself; the `Keypoints`-wrapped form an
 * instance property uses is accepted and then stored empty, with nothing on the response to say so.
 * Measured 2026-08-27.
 */
const vfxNumberSequence = z
  .array(z.object({ Time: z.number(), Value: z.number(), Envelope: z.number().optional() }))
  .describe("Alpha (opacity) keypoints over the source lifetime [{Time,Value}], 0~1");

// The full serving-asset path is derivable from layer + source name, so the model-facing enum
// carries only short names and the sidecar expands them. Full paths pasted from recipe-template
// payloads are also accepted: preprocess strips them back to the short name, and the per-layer enum
// still rejects sources belonging to another layer.
const vfxSourceShortName = (value: unknown) =>
  typeof value === "string" ? value.replace(/^.*VFX_UGC_(?:Base|Detail|Extra)_/, "").split(".")[0] : value;

/** Builds the per-layer NiagaraSystem field: short-name enum in, full serving-asset path out. */
function vfxNiagaraSystem(layerDir: string, prefix: string, names: readonly [string, ...string[]]) {
  return z
    .preprocess(
      vfxSourceShortName,
      z
        .enum(names)
        .describe(
          "VFX source to play, by short name. Sources with _R in the name are Rate emitters (Duration/SpawnRate); the rest are Burst emitters (SpawnCount).",
        ),
    )
    .transform(
      (name) => `/CommonContent/VFX/Layer/${layerDir}/${name}/VFX_UGC_${prefix}_${name}.VFX_UGC_${prefix}_${name}`,
    );
}

/**
 * One source item inside a VFXRecipe layer. Every serving source exposes a subset of these user
 * parameters — unsupported parameters are ignored by the source asset, so set only the ones the
 * chosen NiagaraSystem provides.
 */
function vfxLayerSourceArray(niagaraSystem: z.ZodTypeAny) {
  return z.array(
    z
      .object({
        Name: z.string().describe("Source identifier used by GetParam/SetParam/GetParamAt/SetParamAt"),
        NiagaraSystem: niagaraSystem,
        Texture: z
          .object({
            ObjectType: z.literal("Content").default("Content"),
            Content: z.string().describe('Texture asset ID, e.g. "ovdrassetid://2793112"'),
          })
          .describe("Overrides the source texture; omit to keep the asset default")
          .optional(),
        Position: vec3.describe("Local position relative to the VFXRecipe root").optional(),
        Rotation: vec3.describe("Local rotation relative to the VFXRecipe root").optional(),
        Acceleration: vec3.describe("Particle acceleration").optional(),
        BoundSize: vec3.describe("Size of the particle spawn bounds").optional(),
        Color: vfxColorSequence.optional(),
        Alpha: vfxNumberSequence.optional(),
        Delay: z.number().describe("Playback start delay in seconds").optional(),
        Duration: z.number().describe("Emitter duration in seconds (Rate sources only)").optional(),
        SpawnRate: z.number().describe("Particles per second (Rate sources only)").optional(),
        SpawnCount: z.number().describe("Particles per activation (Burst sources only)").optional(),
        Lifetime_Min: z.number().describe("Particle minimum lifetime in seconds").optional(),
        Lifetime_Max: z.number().describe("Particle maximum lifetime in seconds").optional(),
        LoopDuration: z
          .number()
          .describe("Auto-filled from the recipe across all sources; keep identical on every source item")
          .optional(),
        Size: z.number().describe("Particle size scale").optional(),
        Size2D: z
          .object({ X: z.number(), Y: z.number() })
          .describe("Particle width/height (sprite sources)")
          .optional(),
        Scale: z.number().describe("Scale value used by decal-type sources").optional(),
        Speed: z.number().describe("Particle movement/playback speed").optional(),
        Transparency: z.number().describe("(0~1)").optional(),
        FlipbookMode: z.number().int().describe("Flipbook animation playback mode").optional(),
        FlipbookRows: z.number().int().optional(),
        FlipbookColumns: z.number().int().optional(),
      })
      .strict(),
  );
}

/** Per-layer VFX source short names — single source of truth for the NiagaraSystem enums. */
export const vfxLayerSourceNames = {
  Base: [
    "EmptySprite",
    "EmptySprite_R",
    "FireBurst_A",
    "FireRise_A",
    "LightBurst_A",
    "LightFlash_A",
    "LightFlash_B",
    "LightFlash_C",
    "LightRise_R_A",
    "LiquidFlash_A",
    "LiquidScatter_R_A",
    "NeutralBurst_A",
    "NeutralBurst_B",
    "NeutralTrail_A",
    "SmokeBurst_A",
    "SmokeRing_A",
    "TechDecal_R_A",
  ],
  Detail: [
    "FireDecal_A",
    "FireFlash_A",
    "FireScatter_B",
    "LightBurst_R_A",
    "LightRise_R_B",
    "LightRise_R_C",
    "LightShimmer_A",
    "LightShimmer_R_B",
    "NeutralDecal_A",
    "NeutralFlash_C",
    "NeutralPulse_R_A",
    "NeutralRing_B",
    "SmokeBurst_A",
    "SmokeTrail_A",
  ],
  Extra: [
    "FireScatter_C",
    "FireScatter_D",
    "LightRise_R_A",
    "LightningScatter_A",
    "LiquidScatter_R_A",
    "MagicRing_A",
    "NeutralRing_A",
    "SmokeRise_A",
  ],
} as const;

export const vfxRecipePropertiesSchema = z
  .object({
    AutoActivate: z.boolean().default(true),
    InfiniteLoop: z.boolean().default(true),
    LoopCount: z.number().default(1),
    // Read-only derived value: accepted so recipe-template payloads can be pasted verbatim,
    // then stripped (undefined is dropped by JSON.stringify) — Studio re-derives it.
    LoopDuration: z
      .number()
      .optional()
      .transform(() => undefined)
      .describe("Read-only derived value; accepted for template-payload compatibility and ignored."),
    BaseLayer: vfxLayerSourceArray(vfxNiagaraSystem("0_Base", "Base", vfxLayerSourceNames.Base)).optional(),
    DetailLayer: vfxLayerSourceArray(vfxNiagaraSystem("1_Detail", "Detail", vfxLayerSourceNames.Detail)).optional(),
    ExtraLayer: vfxLayerSourceArray(vfxNiagaraSystem("2_Extra", "Extra", vfxLayerSourceNames.Extra)).optional(),
    Mobility: mobilityEnum.optional(),
  })
  .strict()
  .describe(
    "Custom layered VFX composed of Base/Detail/Extra layer source items, each playing a serving VFX source asset " +
      "with per-source user parameters. Compose via the vfx-recipe skill (bundled templates in references/templates/).",
  );

function propertyRecord(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("VFXRecipe properties must be an object.");
  }
  return value as Record<string, unknown>;
}

function formatIssues(error: z.ZodError): Error {
  return new Error(
    error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? `.${issue.path.join(".")}` : "";
        return `  [properties${path}] (class=VFXRecipe) ${issue.message}`;
      })
      .join("\n"),
  );
}

/** Validates a new recipe and returns schema defaults. */
export function parseVfxRecipeCreateProperties(value: unknown): Record<string, unknown> {
  const result = vfxRecipePropertiesSchema.safeParse(propertyRecord(value));
  if (!result.success) throw formatIssues(result.error);
  return result.data;
}

/** Validates only supplied update keys and never injects create defaults. */
export function parseVfxRecipePatchProperties(value: unknown): Record<string, unknown> {
  const raw = propertyRecord(value);
  const result = vfxRecipePropertiesSchema.partial().safeParse(raw);
  if (!result.success) throw formatIssues(result.error);
  const data = result.data as Record<string, unknown>;
  return Object.fromEntries(Object.keys(raw).map((key) => [key, data[key]]));
}
