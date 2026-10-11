// @summary Runs a draft geometry recipe without changing a placed ProceduralModel.
import { z } from "zod";

export const method = "proceduralmodel.run";
// Native runs take up to 240 seconds; allow the reply to arrive after that deadline.
export const timeoutMs = 300_000;
// Drafts write recipe files. Serialize them without capturing an unrelated map snapshot.
export const serialize = true;
export const description =
  "Run a Python geometry recipe as a draft, without placing a model. The world must already be saved. " +
  "id identifies .overdare/geometry/<id>/main.py in Studio's world directory. Pass code to write the " +
  "recipe there, or omit it to reuse the saved recipe. parameters supplies the draft's parameters. " +
  "Returns run metadata and generated output. timeoutSeconds is 5–240 (default 240). Only action " +
  "draft is supported; use studiorpc_proceduralmodel_set to author a placed model. Do not automatically " +
  "retry an unknown outcome after timeout or cancellation.";
const draftFields = {
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[\p{L}\p{N}_-][\p{L}\p{N}_.-]*$/u)
    .describe("Recipe ID, up to 64 letters/digits/dots/underscores/hyphens; must not start with a dot."),
  action: z.literal("draft").optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  timeoutSeconds: z.number().finite().min(5).max(240).optional(),
};
// Distinguish omission from malformed inline source. The shared argument normalizer must not
// drop an empty code string and accidentally rerun an older recipe under the same ID.
export const params = z.union([
  z.object({ ...draftFields, code: z.string().min(1).describe("Inline Python recipe to save and run.") }).strict(),
  z.object(draftFields).strict(),
]);
