// @summary Declares the Studio RPC method that statically checks a geometry recipe before it runs.
import { z } from "zod";

export const method = "geometry.validate";

export const description =
  "Statically check a Python geometry recipe against the contract before baking it — cheaper than a full " +
  "run and it never touches the scene. Reports `findings`: the recipe must define `def on_generate(model, " +
  "size, attributes):`, keep module level declarative (imports, constants, helper defs — geometry belongs " +
  "inside on_generate), and declare at least one part with model.part(...). Pass `code` with the recipe " +
  "source, or `id` to check a recipe already saved under that id. Use it after writing or editing a recipe " +
  "and before studiorpc_proceduralmodel_set, so a contract slip is caught without a bake. An empty findings " +
  "list means the shape is right; it does not promise the geometry looks good — bake and photograph for that.";

// Pass exactly one of `code` or `id`. Kept as a plain object (no zod .refine, which would make the
// top-level schema a union the provider must not advertise); the Studio side rejects an empty call
// with the same guidance.
export const params = z
  .object({
    code: z.string().min(1).optional().describe("The recipe source to validate. Pass this or `id`."),
    id: z.string().min(1).optional().describe("Instead of `code`, the id of a recipe already saved in this world."),
  })
  .strict();
