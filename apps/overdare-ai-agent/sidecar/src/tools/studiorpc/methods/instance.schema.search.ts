// @summary Discovers the live Studio class catalog and targeted JSON editing schemas.
import { z } from "zod";

export const method = "instance.schema.search";
export const readOnly = true;
export const truncateDirection = "head" as const;
export const description =
  'Discover supported Studio classes before authoring. Use query:"" (or no filters) for a compact full class catalog; it includes class names, descriptions and availability metadata, omitting property payloads. Then pass classes (1-20 exact names) and optionally a property query for detailed schemas. A non-empty query is a case-insensitive literal class/property substring. Preserve Korean descriptions as UTF-8. Check creatable, writeCondition and valueSchema before editing through Editor Luau. This is not the complete Luau or native Python method API. No limit, cursor or wildcard options. A full-search error can indicate an older Studio; report it instead of inventing a partial catalog.';
export const params = z
  .object({
    query: z
      .string()
      .optional()
      .describe("Empty means full class discovery; otherwise a literal class/property substring."),
    classes: z.array(z.string().min(1)).min(1).max(20).optional().describe("Exact class names for detailed schemas."),
  })
  .strict();

/** The shared executor drops empty optional strings; restore the explicit full-search request. */
export function normalizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  return args.query === undefined && args.classes === undefined ? { query: "" } : args;
}

/** Keep the catalog small without discarding descriptions or altering targeted property results. */
export function postProcess(result: unknown, args: Record<string, unknown>): unknown {
  if (args.classes !== undefined || (args.query !== undefined && args.query !== "")) return result;
  if (!result || typeof result !== "object" || !Array.isArray((result as Record<string, unknown>).classes))
    return result;
  const data = result as Record<string, unknown> & { classes: unknown[] };
  return {
    ...data,
    view: "classes",
    classes: data.classes.map((entry) => {
      if (!entry || typeof entry !== "object") return entry;
      return Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "properties"));
    }),
    hint: "Pass classes with exact names to inspect properties; a readback field is not necessarily writable.",
  };
}
