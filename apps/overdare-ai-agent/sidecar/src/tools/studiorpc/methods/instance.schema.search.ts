// @summary Discovers the live Studio class catalog and selected property/function/event schemas with sidecar annotations.
import { toToolInputSchema } from "@diligent/core/tool-contract";
import { z } from "zod";
import { annotateCatalogEntry, annotateDetailResult } from "./instance-schema-overlay";

export const method = "instance.schema.search";
export const readOnly = true;
export const truncateDirection = "head" as const;
export const description =
  'Discover Studio classes, property availability, and gameplay functions/events. Use {} for the compact full class catalog when the appropriate class is unknown. Use {"classes":["TextLabel","UIGridLayout","Script"]} for all members of known classes, or {"classes":["MeshPart"],"query":"Material"} to filter members. Set kinds:["properties"], kinds:["functions"], kinds:["events"], or a combination to return only those member collections. Combine kinds with classes/query to keep results focused; kinds alone requests those members across all classes. Diligent filters kinds after the native query. Omit query entirely when no substring filter is needed, including class-only requests; never pass query:"". An empty query is invalid, not a full-search option. A non-empty query is a case-insensitive literal class/property/function/event substring. The catalog includes class names, descriptions and availability metadata, omitting property/function/event payloads. Preserve Korean descriptions as UTF-8. Check creatable for Editor placement, scriptCreatable for gameplay Instance.new, and property available (editor/game), access, writeCondition and valueSchema before editing. Gameplay-only properties can omit valueSchema; their presence does not imply Editor support. Native type and valueSchema.luaEnum identify Luau enum types when present. Detailed results add sidecar notes (units, contextual limits), source:"sidecar" property supplements, and valueTypes describing how each JSON value shape is written in Luau. Functions/events describe gameplay members, not guaranteed Editor VM support. Custom Luau members and globals may be absent; this is not the native Python API. No limit, cursor or wildcard options. Report a full-search error instead of inventing a partial catalog. VFXRecipe is a dedicated authoring exception: use studiorpc_vfx_recipe_upsert for creation and layer editing, and studiorpc_instance_read for complete layer JSON; creatable=false or missing layer properties here do not describe that tool. For ActionSequence authoring, load the actionsequence skill and use studiorpc_action_sequence_write.';
const filters = z
  .object({
    query: z
      .string()
      .min(
        1,
        'Omit query instead of sending an empty string: use {} for the catalog or {"classes":[...]} for class details.',
      )
      .describe(
        "Optional non-empty literal class/property/function/event substring. Omit for {} catalog discovery or all members of classes; never use an empty string.",
      ),
    classes: z.array(z.string().min(1)).min(1).max(20).optional().describe("Exact class names for detailed schemas."),
    kinds: z
      .array(z.enum(["properties", "functions", "events"]))
      .min(1)
      .max(3)
      .optional()
      .describe(
        "Return only these member kinds, selected by Diligent. Combine with classes/query to narrow results; omit for all kinds in detailed lookups or the compact catalog with {}.",
      ),
  })
  .strict();

// A present query must stay required during shared empty-optional cleanup.
// Advertise the equivalent flat object so providers need no top-level union.
export const params = z.union([filters, filters.omit({ query: true })]);
export const inputSchema = toToolInputSchema({ parameters: filters.partial({ query: true }) });

/** Member-kind selection is sidecar-only; Studio receives its native class/name filters. */
export function normalizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const { kinds: _kinds, ...nativeArgs } = args;
  return nativeArgs;
}

/** Keep the catalog small without discarding descriptions; annotate targeted results with the sidecar overlay. */
export function postProcess(result: unknown, args: Record<string, unknown>): unknown {
  if (args.classes !== undefined || args.query !== undefined || args.kinds !== undefined) {
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
      return annotateCatalogEntry(
        Object.fromEntries(
          Object.entries(entry).filter(([key]) => !["properties", "functions", "events"].includes(key)),
        ),
      );
    }),
    hint: "Pass classes with exact names for details; optionally select kinds (properties/functions/events) and query a member name. Check availability and write access before editing.",
  };
}
