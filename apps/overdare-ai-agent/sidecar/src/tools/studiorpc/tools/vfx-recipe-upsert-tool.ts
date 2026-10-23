// @summary Edits VFXRecipe layers through the existing validated instance create/update codecs.
import { z } from "zod";
import { classPropertiesSchemas } from "../methods/instance.params";
import { parseInstanceCreateProperties, parseInstancePatchProperties } from "../methods/instance-properties";
import { applyLevelChanges as applyLevelChangesDefault } from "../rpc";
import type { Tool } from "../types";
import type { WriteLock } from "../write-lock";
import { executeInstanceUpsert } from "./instance-upsert-tool";

const TOOL_NAME = "studiorpc_vfx_recipe_upsert";
const properties = classPropertiesSchemas.get("VFXRecipe") as z.AnyZodObject;
const items = (propertySchema: z.ZodTypeAny) =>
  z
    .array(
      z.union([
        z
          .object({ parentGuid: z.string().min(1), name: z.string().min(1), properties: propertySchema.optional() })
          .strict(),
        z
          .object({ guid: z.string().min(1), name: z.string().optional(), properties: propertySchema.optional() })
          .strict(),
      ]),
    )
    .min(1)
    .max(100);
const input = z.object({ items: items(z.record(z.unknown())) }).strict();
function parseInput(value: unknown) {
  const parsed = input.parse(value);
  const updates = parsed.items.filter((item) => "guid" in item).length;
  if (updates > 0 && updates < parsed.items.length)
    throw new Error("Do not mix recipe creates and updates in one call.");
  for (const item of parsed.items) {
    if ("guid" in item) parseInstancePatchProperties("VFXRecipe", item.properties);
    else parseInstanceCreateProperties("VFXRecipe", item.properties);
  }
  // Keep original input: the shared writer performs JSON transformations exactly once.
  return parsed;
}
export function createVfxRecipeUpsertTool(
  cwd: string,
  writeLock: WriteLock,
  applyLevelChanges: () => Promise<unknown> = applyLevelChangesDefault,
): Tool {
  return {
    name: TOOL_NAME,
    description:
      "Create or update VFXRecipe instances and BaseLayer/DetailLayer/ExtraLayer arrays. Use this dedicated tool instead of execute_luau for recipe creation and layer edits. Create with parentGuid/name/properties (class is always VFXRecipe); update with guid and optional name/properties. Do not mix creates and updates. Read existing recipes with studiorpc_instance_read, then send the complete modified layer array; omitted properties and layers are preserved on update, and [] clears a layer. Accepts per-layer short source names, resource names or full serving paths; validates layer membership and adds JSON type tags. Alpha stays a bare keypoint array. Top-level LoopDuration is derived and ignored. Unsupported source-specific parameters may be ignored by Studio; use the vfx-recipe skill and supplied source references. Uses the existing instance create/update path and automatically saves. Runtime SetParam/SetParamAt and Play/Stop are gameplay APIs, not commands of this tool.",
    parameters: z.object({ items: items(properties.partial()) }).strict(),
    parseArgs: parseInput,
    async execute(args, ctx) {
      const parsed = parseInput(args);
      return executeInstanceUpsert(
        { items: parsed.items.map((item) => ("guid" in item ? item : { ...item, class: "VFXRecipe" })) },
        ctx,
        cwd,
        writeLock,
        applyLevelChanges,
        { toolName: TOOL_NAME, expectedClass: "VFXRecipe" },
      );
    },
  };
}
