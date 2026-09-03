// @summary Declares the Studio RPC method that statically checks a geometry recipe before it runs.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

export const method = "geometry.validate";

export const description =
  "Statically check a Python geometry recipe against the contract before baking it — cheaper than a full " +
  "run and it never touches the scene. Reports `findings`: the recipe must define `def on_generate(model, " +
  "size, attributes):`, keep module level declarative (imports, constants, helper defs — geometry belongs " +
  "inside on_generate), and declare at least one part with model.part(...). Pass the recipe as `code` " +
  "(inline source) or `sourcePath` (a recipe file to reuse as-is), or `id` to check a recipe already saved " +
  "under that id — exactly one. Use it after writing or editing a recipe and before studiorpc_proceduralmodel_set, " +
  "so a contract slip is caught without a bake. An empty findings list means the shape is right; it does not " +
  "promise the geometry looks good — bake and photograph for that.";

// Pass exactly one of `code`, `sourcePath`, or `id`. Kept as a plain object (no zod .refine, which would
// make the top-level schema a union the provider must not advertise); preCall enforces the choice and the
// Studio side rejects an empty call with the same guidance.
export const params = z
  .object({
    code: z.string().min(1).optional().describe("The recipe source to validate. Pass this, `sourcePath`, or `id`."),
    sourcePath: z
      .string()
      .min(1)
      .optional()
      .describe("Path to an existing recipe file to validate as-is (read host-side). Use instead of `code`."),
    id: z.string().min(1).optional().describe("Instead of source, the id of a recipe already saved in this world."),
  })
  .strict();

type Args = Record<string, unknown>;

/** Resolves `sourcePath` into `code` before the RPC, host-side. */
export async function preCall(args: Args): Promise<void> {
  if (args.sourcePath === undefined) return;
  if (args.code !== undefined || args.id !== undefined) {
    throw new Error("Provide exactly one of `code`, `sourcePath`, or `id`.");
  }
  const path = resolve(String(args.sourcePath));
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch (error) {
    throw new Error(`Could not read the recipe file at sourcePath: ${path} (${(error as Error).message})`);
  }
  args.code = text.replace(/^﻿/, ""); // strip BOM
}

/** Forwards only the keys Studio's geometry.validate RPC knows; drops the tool-only file field. */
export function normalizeArgs(args: Args): Args {
  const out: Args = {};
  if (args.code !== undefined) out.code = args.code;
  if (args.id !== undefined) out.id = args.id;
  return out;
}
