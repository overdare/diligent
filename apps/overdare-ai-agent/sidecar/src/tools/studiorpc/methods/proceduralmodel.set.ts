// @summary Declares the Studio RPC method that authors and bakes a ProceduralModel from a geometry recipe.
import { z } from "zod";

export const method = "proceduralmodel.set";

export const description =
  "Author and bake a ProceduralModel: write its recipe, Size and parameters, then (with rebuild) run the " +
  "Python recipe and place the resulting MeshParts as its children. This is the main authoring step for the " +
  "geometry-recipe system — read studiorpc_geometry_api first for the contract and API. `guid` is a " +
  "ProceduralModel that already exists; create one with studiorpc_instance_upsert (className " +
  '"ProceduralModel") and pass its guid here. `source` is the whole recipe (a module defining ' +
  "`on_generate(model, size, attributes)`); omit it to change only Size or attributes. `size` is the model's " +
  "Size in cm as [x, y, z] with Y up — the same three numbers the Transform panel shows; changing it re-runs " +
  "the recipe at the new footprint. `attributes` sets the recipe's declared parameters by name. `rebuild: " +
  "true` bakes now; the reply then carries the whole run — `parts` (with triangles, boundsCm, tint, tier), " +
  "`modelBoundsCm`, `warnings`, `stdout`, and on failure `error` — so judge on the numbers first, then " +
  "photograph the model with game.screenshot(instanceId=<guid>) to see it. A recipe that breaks the contract " +
  "is refused before a line of it runs, with the expected shape in the message.";

const attributeValue = z.union([
  z.number(),
  z.boolean(),
  z.string(),
  z.null(),
  z.array(z.number()),
  z.record(z.string(), z.unknown()),
]);

export const params = z
  .object({
    guid: z.string().min(1).describe("The ProceduralModel to author. Create one first with studiorpc_instance_upsert."),
    source: z
      .string()
      .optional()
      .describe(
        "The whole recipe. A module that defines on_generate(model, size, attributes). Omit to keep the current one.",
      ),
    size: z
      .array(z.number())
      .length(3)
      .optional()
      .describe("Model Size in cm as [x, y, z], Y up — the numbers the Transform panel shows. Re-runs the recipe."),
    attributes: z
      .record(z.string(), attributeValue)
      .optional()
      .describe(
        "The recipe's declared parameters by name. A null value clears one. Types follow the Add Attribute panel.",
      ),
    autoRebuild: z
      .boolean()
      .optional()
      .describe("Whether an edit re-bakes automatically. Leave unset to keep the model's setting."),
    rebuild: z
      .boolean()
      .optional()
      .describe("Bake now and return the run report. Set true after changing source, size, or attributes."),
  })
  .strict();
