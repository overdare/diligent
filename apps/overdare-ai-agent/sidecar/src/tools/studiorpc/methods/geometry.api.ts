// @summary Declares the Studio RPC method that returns the geometry-recipe API reference.
import { z } from "zod";

export const method = "geometry.api";

export const description =
  "Fetch the live authoring reference for OVERDARE geometry recipes — the Python `on_generate(model, " +
  "size, attributes)` system that bakes real MeshParts with presets and tints, distinct from the Luau " +
  "GeometryPrimitives runner (studiorpc_procedural_run). Call it ONCE at the start of a recipe task and " +
  "work from what it returns; it is the source of truth, not this description. The reply carries `template` " +
  "(a complete working recipe to copy and edit), `lookup` (every G.*/parts.*/layout.* signature keyed " +
  "exactly as you write it in code), `presets` (the ~94 material preset names, asked of the service so they " +
  "cannot drift — there is no Iron/Steel/Stone/Leather, a wrong name is refused not rendered grey), and " +
  "`notes` (the full reference, for when a number comes back wrong). Nothing is pre-injected into a recipe: " +
  "the header imports it needs are in `template`. Costs a few seconds; read it before writing any recipe.";

export const params = z
  .object({
    maxNoteBytes: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Cap on the `notes` payload in bytes. Omit for the whole reference; set it to trim a large reply."),
  })
  .strict();
