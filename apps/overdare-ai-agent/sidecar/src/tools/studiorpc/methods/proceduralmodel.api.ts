// @summary Declares the Studio RPC method that returns the geometry-recipe API reference.
import { z } from "zod";

export const method = "proceduralmodel.api";

export const description =
  "Fetch the live authoring reference for OVERDARE geometry recipes — the Python `on_generate(model, " +
  "size, attributes)` system that bakes real MeshParts with presets and tints. For Editor scene layout from primitive blocks, " +
  "use studiorpc_execute_luau. Call it ONCE at the start of a recipe task and " +
  "work from what it returns; it is the source of truth, not this description. By default the reply is the " +
  "COMPACT authoring kit — `template` (a complete working recipe to copy), `lookup` (every G.*/parts.*/" +
  "layout.* signature on one line, keyed exactly as you write it), `presets` (the ~94 material preset names, " +
  "a wrong name is refused not rendered grey), `enums`, and `quickref`. This is small on purpose — you do not " +
  "need to read a file or grep it. When a call's exact arguments or a number come back wrong, call again with " +
  '`query` (names or keywords, e.g. ["append_sphere", "rib", "bounds"]) to get the verbose per-argument ' +
  "docs and notes for just those calls. Costs a few seconds; read the compact kit before writing any recipe.";

export const params = z
  .object({
    query: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .describe(
        'Names or keywords to expand into verbose signatures/docs, e.g. ["append_sphere","rib"]. Omit for the compact kit.',
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
function filterFunctions(functions: unknown, terms: string[]): unknown[] {
  if (!Array.isArray(functions)) return [];
  return functions.filter((fn) => {
    const name = isRecord(fn) && typeof fn.name === "string" ? fn.name.toLowerCase() : "";
    return terms.some((term) => name.includes(term));
  });
}

/** Studio's proceduralmodel.api RPC takes no arguments; `query` is applied host-side in postProcess. */
export function normalizeArgs(_args: Args): Args {
  return {};
}

/**
 * Trims the reference so an agent never has to read or grep a spilled file. The default reply keeps the
 * one-line `lookup` signatures, `template`, `presets`, `enums`, and `quickref` but drops the verbose
 * `functions` docs and prose `notes`; a `query` expands just the requested calls back to full detail.
 */
export function postProcess(result: unknown, args: Args): unknown {
  if (!isRecord(result)) return result;
  const r = result;
  const base: Record<string, unknown> = {};
  for (const key of ["class", "success", "template", "presets", "enums", "quickref"]) {
    if (r[key] !== undefined) base[key] = r[key];
  }

  const terms = toTerms(args.query);
  if (terms.length > 0) {
    return {
      ...base,
      query: terms,
      lookup: filterMap(r.lookup, terms),
      signatures: filterMap(r.signatures, terms),
      functions: filterFunctions(r.functions, terms),
      ...(r.notes !== undefined ? { notes: r.notes } : {}),
    };
  }

  return {
    ...base,
    lookup: r.lookup,
    hint: 'Compact kit. For verbose per-argument docs or notes on specific calls, call again with `query`, e.g. query: ["append_sphere","rib"].',
  };
}
