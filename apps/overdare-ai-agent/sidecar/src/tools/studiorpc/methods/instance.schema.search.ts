// @summary Discovers the live Studio class catalog and targeted JSON editing schemas, annotated by the sidecar overlay.
import { toToolInputSchema } from "@diligent/core/tool-contract";
import { z } from "zod";
import { annotateCatalogEntry, annotateDetailResult } from "./instance-schema-overlay";

export const method = "instance.schema.search";
export const readOnly = true;
export const truncateDirection = "head" as const;
export const description =
  'Discover Studio classes and their editable properties. Use {} for the compact full class catalog when the appropriate class is unknown. Use {"classes":["TextLabel","UIGridLayout","Script"]} for all properties of known classes, or {"classes":["MeshPart"],"query":"Material"} to filter properties. Omit query entirely when no substring filter is needed, including class-only requests; never pass query:"". An empty query is invalid, not a full-search option. A non-empty query is a case-insensitive literal class/property substring. The catalog includes class names, descriptions and availability metadata, omitting property payloads. Preserve Korean descriptions as UTF-8. Check creatable, writeCondition and valueSchema before editing through Editor Luau. Detailed results add sidecar notes (units, contextual limits), source:"sidecar" properties that Studio omits but Editor Luau supports (for example VFXPreset.PresetName), and valueTypes describing how each JSON value shape is written in Luau. This is not the complete Luau or native Python method API. No limit, cursor or wildcard options. Report a full-search error instead of inventing a partial catalog. VFXRecipe is a dedicated authoring exception: use studiorpc_vfx_recipe_upsert for creation and layer editing, and studiorpc_instance_read for complete layer JSON; creatable=false or missing layer properties here do not describe that tool. For ActionSequence authoring, load the actionsequence skill and use studiorpc_action_sequence_write.';
const filters = z
  .object({
    query: z
      .string()
      .min(
        1,
        'Omit query instead of sending an empty string: use {} for the catalog or {"classes":[...]} for class details.',
      )
      .describe(
        "Optional non-empty literal class/property substring. Omit for {} catalog discovery or all properties of classes; never use an empty string.",
      ),
    classes: z.array(z.string().min(1)).min(1).max(20).optional().describe("Exact class names for detailed schemas."),
  })
  .strict();

// A present query must stay required during shared empty-optional cleanup.
// Advertise the equivalent flat object so providers need no top-level union.
export const params = z.union([filters, filters.omit({ query: true })]);
export const inputSchema = toToolInputSchema({ parameters: filters.partial({ query: true }) });

/** Keep the catalog small without discarding descriptions; annotate targeted results with the sidecar overlay. */
export function postProcess(result: unknown, args: Record<string, unknown>): unknown {
  if (args.classes !== undefined || args.query !== undefined) {
    return annotateDetailResult(result, args);
  }
  if (!result || typeof result !== "object" || !Array.isArray((result as Record<string, unknown>).classes))
    return result;
  const data = result as Record<string, unknown> & { classes: unknown[] };
  return {
    ...data,
    view: "classes",
    classes: data.classes.map((entry) => {
      if (!entry || typeof entry !== "object") return entry;
      return annotateCatalogEntry(Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "properties")));
    }),
    hint: "Pass classes with exact names to inspect properties; a readback field is not necessarily writable.",
  };
}
