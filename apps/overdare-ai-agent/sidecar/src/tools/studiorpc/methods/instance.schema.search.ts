// @summary Discovers the live Studio class catalog and targeted JSON editing schemas, annotated by the sidecar overlay.
import { z } from "zod";
import { annotateCatalogEntry, annotateDetailResult } from "./instance-schema-overlay";

export const method = "instance.schema.search";
export const readOnly = true;
export const truncateDirection = "head" as const;
export const description =
  'If the appropriate Studio class is unknown, call with no filters ({}) for a compact full class catalog; it includes class names, descriptions and availability metadata, omitting property payloads. For a known or discovered class, pass classes (1-20 exact names) and optionally a property query for detailed schemas. A non-empty query is a case-insensitive literal class/property substring. Preserve Korean descriptions as UTF-8. Check creatable, writeCondition and valueSchema before editing through Editor Luau. Detailed results add sidecar notes (units, contextual limits), source:"sidecar" properties that Studio omits but Editor Luau supports (for example VFXPreset.PresetName), and valueTypes describing how each JSON value shape is written in Luau. This is not the complete Luau or native Python method API. No limit, cursor or wildcard options. A full-search error can indicate an older Studio; report it instead of inventing a partial catalog. VFXRecipe is a dedicated authoring exception: use studiorpc_vfx_recipe_upsert for creation and layer editing, and studiorpc_instance_read for complete layer JSON; creatable=false or missing layer properties here do not describe that tool. For ActionSequence authoring, load the actionsequence skill and use studiorpc_action_sequencer_service_apply_json.';
export const params = z
  .object({
    query: z
      .string()
      .optional()
      .describe("Omit for full class discovery; otherwise a literal class/property substring."),
    classes: z.array(z.string().min(1)).min(1).max(20).optional().describe("Exact class names for detailed schemas."),
  })
  .strict();

/** Studio performs full discovery for an empty request and rejects `query:""`; drop an empty query. */
export function normalizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  if (args.query !== "") return args;
  const { query: _empty, ...rest } = args;
  return rest;
}

/** Keep the catalog small without discarding descriptions; annotate targeted results with the sidecar overlay. */
export function postProcess(result: unknown, args: Record<string, unknown>): unknown {
  if (args.classes !== undefined || (args.query !== undefined && args.query !== "")) {
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
