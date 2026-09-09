// @summary Declares the Studio RPC method that statically checks a geometry recipe before it runs.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

export const method = "proceduralmodel.validate";

export const description =
  "Statically check a Python geometry recipe against the contract before baking it — cheaper than a full " +
  "run and it never touches the scene. Reports `findings`: the recipe must define `def on_generate(model, " +
  "size, attributes):`, keep module level declarative (imports, constants, helper defs — geometry belongs " +
  "inside on_generate), and declare at least one part with model.part(...). Give the recipe ONE way: inline " +
  "in `code`, or a recipe file in `sourcePath`. You may leave the other field blank — blanks and obvious " +
  "placeholders are ignored, and a real file path wins over inline source. Use it after writing or editing a " +
  "recipe and before studiorpc_proceduralmodel_set. An empty findings list means the shape is right; it does " +
  "not promise the geometry looks good — bake and photograph for that.";

// Two ways to give the recipe, but callers (and some strict function-calling providers that must emit every
// declared property) often fill both. Keep the top-level schema a plain object (no zod .refine, which would
// advertise a union the provider must not see); preCall resolves the ONE real input by value.
export const params = z
  .object({
    code: z.string().min(1).optional().describe("The recipe source to validate. Or use `sourcePath`."),
    sourcePath: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Path to an existing recipe file to validate as-is (read host-side). Wins over `code` when both are real.",
      ),
  })
  .strict();

type Args = Record<string, unknown>;

function stripBom(text: string): string {
  return text.replace(/^﻿/, "");
}

/** Trimmed string, or "" for non-strings — a bare "" or "   " never counts as a provided value. */
function trimmedStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** A real recipe body: has the entry point, spans lines, or is simply too long to be a placeholder. */
function looksLikeRecipe(v: unknown): boolean {
  const s = trimmedStr(v);
  return s.length > 0 && (/\bon_generate\b/.test(s) || /\bdef\s/.test(s) || s.includes("\n") || s.length >= 24);
}

/** A real filesystem path: has a separator or a .py suffix. Rules out "x", ".", " ". */
function looksLikePath(v: unknown): boolean {
  const s = trimmedStr(v);
  return s.length > 0 && (/[\\/]/.test(s) || /\.py$/i.test(s));
}

/**
 * Resolves which of `code` / `sourcePath` the caller actually meant and reads `sourcePath` into `code`,
 * host-side. A provider that must emit every declared property fills the unused input with blanks or
 * placeholders ("", " ", "x", "."); those are ignored so the recipe still validates instead of the call
 * looping forever on "provide exactly one". Precedence: a real file path, else a real recipe body.
 */
export async function preCall(args: Args): Promise<void> {
  const path = looksLikePath(args.sourcePath) ? trimmedStr(args.sourcePath) : "";
  const code = looksLikeRecipe(args.code) ? String(args.code) : "";

  // Clear everything, then set the single resolved input; normalizeArgs forwards a clean call.
  args.code = undefined;
  delete args.sourcePath;

  if (path) {
    const abs = resolve(path);
    try {
      args.code = stripBom(readFileSync(abs, "utf-8"));
    } catch (error) {
      throw new Error(`Could not read the recipe file at sourcePath: ${abs} (${(error as Error).message})`);
    }
    return;
  }
  if (code) {
    args.code = code;
    return;
  }
  throw new Error(
    "No recipe to validate. Put the recipe inline in `code` or a file path in `sourcePath` — only one is " +
      'used, and blanks/placeholders like "x" or "." are ignored.',
  );
}

/** Forwards only the keys Studio's proceduralmodel.validate RPC knows; drops the tool-only file field. */
export function normalizeArgs(args: Args): Args {
  const out: Args = {};
  if (args.code !== undefined) out.code = args.code;
  return out;
}
