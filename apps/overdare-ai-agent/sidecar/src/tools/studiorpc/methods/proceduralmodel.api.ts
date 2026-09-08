// @summary Declares the Studio RPC method that returns the geometry-recipe API reference.
import { MAX_OUTPUT_BYTES } from "@diligent/core/tool-contract";
import { z } from "zod";

export const method = "proceduralmodel.api";

export const description =
  "Fetch the live Python geometry-recipe API for baking ProceduralModel MeshParts. " +
  "For Editor scene layout from primitive blocks, use studiorpc_execute_luau. " +
  "Call once at the start for a working template, material presets, enums, and availableFunctions (names only). " +
  "Use query with API names/keywords to get matching signatures and docs. When query is present, document sections " +
  "template, quickref, notes, presets, and enums are included only when named explicitly in a query. " +
  "Request long document sections separately. Unmatched queries are reported; model.part authoring guidance " +
  "is in template and quickref. If a selection is too large, needsNarrowerQuery returns an index instead of cut-off content. Read the returned API before writing a recipe.";

export const params = z
  .object({
    query: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .describe(
        "API names/keywords, or section names: template, quickref, notes, presets, enums. Omit for the starter kit.",
      ),
  })
  .strict();

type Args = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/** Query terms, lowercased. Blanks and single-char placeholders ("x", ".") from strict providers are dropped. */
function toTerms(query: unknown): string[] {
  const raw = Array.isArray(query) ? query : typeof query === "string" ? query.split(/[\s,]+/) : [];
  return raw
    .map((term) => String(term).trim().toLowerCase())
    .filter((term) => term.length >= 2 && /[a-z0-9]/.test(term));
}

/** Entries of a name→value map whose key contains any term. */
function filterMap(map: unknown, terms: string[]): Record<string, unknown> {
  if (!isRecord(map)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(map)) {
    if (terms.some((term) => key.toLowerCase().includes(term))) out[key] = value;
  }
  return out;
}

/** Array entries (each `{ name, ... }`) whose name contains any term. */
function filterFunctions(functions: unknown, terms: string[]): Record<string, unknown>[] {
  if (!Array.isArray(functions)) return [];
  return functions.filter((fn): fn is Record<string, unknown> => {
    const name = isRecord(fn) && typeof fn.name === "string" ? fn.name.toLowerCase() : "";
    return terms.some((term) => name.includes(term));
  });
}

/** Studio's proceduralmodel.api RPC takes no arguments; `query` is applied host-side in postProcess. */
export function normalizeArgs(_args: Args): Args {
  return {};
}

/** Keep complete JSON under the shared tool cap; a broad selection returns an index to narrow. */
function boundedReference(response: Record<string, unknown>, index: Record<string, unknown>): Record<string, unknown> {
  if (Buffer.byteLength(JSON.stringify(response, null, 2), "utf8") <= MAX_OUTPUT_BYTES) return response;
  return {
    ...index,
    needsNarrowerQuery: true,
    hint: "The selected documentation exceeds one tool response. Request fewer exact API names or one document section; no document text was returned.",
  };
}

const SECTION_NAMES = ["template", "quickref", "notes", "presets", "enums"] as const;

/** Return a starter kit, or only the API entries and document sections the query requests. */
export function postProcess(result: unknown, args: Args): unknown {
  if (!isRecord(result)) return result;
  const base: Record<string, unknown> = {};
  for (const key of ["class", "success"]) {
    if (result[key] !== undefined) base[key] = result[key];
  }
  const availableSections = SECTION_NAMES.filter((key) => result[key] !== undefined);
  const terms = toTerms(args.query);
  if (terms.length === 0) {
    const starter = { ...base };
    for (const key of ["template", "presets", "enums"]) {
      if (result[key] !== undefined) starter[key] = result[key];
    }
    const index = {
      ...base,
      availableFunctions: isRecord(result.lookup) ? Object.keys(result.lookup) : [],
      availableSections,
    };
    return boundedReference(
      {
        ...starter,
        ...index,
        hint: "Use query with API names for signatures and details. Request quickref or notes separately for authoring guidance.",
      },
      index,
    );
  }

  const selectedSections = availableSections.filter((key) => terms.includes(key));
  const sections = Object.fromEntries(selectedSections.map((key) => [key, result[key]]));
  const lookup = filterMap(result.lookup, terms);
  const signatures = filterMap(result.signatures, terms);
  const functions = filterFunctions(result.functions, terms);
  const matchedNames = [
    ...selectedSections,
    ...Object.keys(lookup),
    ...Object.keys(signatures),
    ...functions.map((entry) => String(entry.name)),
  ].map((name) => name.toLowerCase());
  const unmatchedQueries = terms.filter((term) => !matchedNames.some((name) => name.includes(term)));

  const response = {
    ...base,
    ...sections,
    query: terms,
    ...(Object.keys(lookup).length > 0 ? { lookup } : {}),
    ...(Object.keys(signatures).length > 0 ? { signatures } : {}),
    ...(functions.length > 0 ? { functions } : {}),
    ...(unmatchedQueries.length > 0
      ? {
          unmatchedQueries,
          availableSections,
          hint: "No API entry matched these queries. Try another name, or query template/quickref for authoring guidance such as model.part.",
        }
      : {}),
  };
  return boundedReference(response, {
    ...base,
    query: terms,
    availableFunctions: [
      ...new Set([...Object.keys(lookup), ...Object.keys(signatures), ...functions.map((entry) => String(entry.name))]),
    ],
    availableSections,
  });
}
