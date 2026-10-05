// @summary Exposes agent-authored non-ODA geometry, rigs and clips through ordinary Studio tools.
import { z } from "zod";

const buildId = z.string().regex(/^[A-Fa-f0-9]{32}$/);
const hash = z
  .string()
  .regex(/^[A-Fa-f0-9]{40}$/)
  .transform((value) => value.toUpperCase());
const revisions = z
  .object({ sourceRevision: hash, geometryHash: hash, rigRevision: hash, animationRevision: hash })
  .strict();

export const api = {
  method: "proceduralcharacter.api",
  readOnly: true,
  description:
    "Read the live non-ODA custom character contract, rig/weight/motion schemas and existing Lua instance contract. Use for arbitrary creatures, animals or custom skeletal characters. The agent authors anatomy and motion; Studio imports, measures, renders and saves it. Read proceduralmodel.api for geometry functions. ODA costume templates and animation.read/write are separate workflows.",
  params: z.object({}).strict(),
};
export const build = {
  method: "proceduralcharacter.build",
  timeoutMs: 900_000,
  description:
    "Build agent-authored geometry, rig weights and animation from an inline recipe, an existing ProceduralModel GUID, or an inspected static Model using authored_v1. Procedural inputs author rig.json and motion.json in the recipe. static_model requires the inspected geometryRevision plus direct rig and motion.document objects from the live API schema; stale geometry is rejected before applying weights. Studio freezes source inputs for each requestId; retries and commit reuse the saved draft even if the source changes or is removed. Use a new requestId to capture new inputs. Read proceduralcharacter.api first. commit=false creates a saved draft with real observation images. Inspect images, verify-source in a fresh process with character_poc.py, then commit the exact four reviewed revisions. Final assets require existing FBX import/upload and saved-map Lua playback verification. This does not change the source model or install into the map.",
  params: z
    .object({
      requestId: z.string().min(1).max(128),
      source: z.discriminatedUnion("kind", [
        z
          .object({
            kind: z.literal("procedural_recipe"),
            recipeId: z.string().min(1),
            recipeSource: z
              .string()
              .min(1)
              .refine((source) => Buffer.byteLength(source, "utf8") <= 256 * 1024, "Recipe exceeds 256 KiB"),
            recipeRevision: hash,
          })
          .strict(),
        z
          .object({
            kind: z.literal("procedural_model"),
            guid: z.string().regex(/^(?:[A-Fa-f0-9]{32}|[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12})$/),
          })
          .strict(),
        z
          .object({
            kind: z.literal("static_model"),
            guid: z.string().regex(/^(?:[A-Fa-f0-9]{32}|[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12})$/),
            geometryRevision: hash,
          })
          .strict(),
      ]),
      target: z.object({ kind: z.literal("new_custom_character"), name: z.string().min(1).max(64) }).strict(),
      rigProfile: z.literal("authored_v1"),
      rig: z.record(z.string(), z.unknown()).optional(),
      motion: z
        .object({
          preset: z.literal("authored_v1"),
          speedCmPerSec: z.number().finite().positive().max(1000),
          document: z.record(z.string(), z.unknown()).optional(),
        })
        .strict(),
      overrides: z.record(z.string(), z.number().finite()).optional(),
      commit: z.boolean(),
      expectedRevision: revisions.optional(),
    })
    .strict()
    .superRefine((request, context) => {
      if (request.source.kind === "static_model") {
        if (!request.rig || !request.motion.document) {
          context.addIssue({ code: "custom", message: "static_model requires rig and motion.document" });
        }
        if (request.overrides && Object.keys(request.overrides).length) {
          context.addIssue({ code: "custom", message: "Recipe overrides do not apply to static geometry" });
        }
        const input = { source: request.source, rig: request.rig, motion: request.motion };
        if (Buffer.byteLength(JSON.stringify(input), "utf8") > 2 * 1024 * 1024) {
          context.addIssue({ code: "custom", message: "Static authoring documents exceed 2 MiB" });
        }
      } else if (request.rig || request.motion.document) {
        context.addIssue({ code: "custom", message: "Procedural sources author rig and motion in their recipe" });
      }
    })
    .refine(
      (request) => !request.commit || request.expectedRevision !== undefined,
      "Commit requires the four reviewed revisions",
    ),
};
export const exportAsset = {
  method: "proceduralcharacter.export",
  timeoutMs: 900_000,
  description:
    "Export a committed reviewed character. mode=publish uploads separate native mesh parts and animation through the existing asset publisher, with their common Skeleton first, and returns real ovdrassetid:// references. Inspect the build's nativePublication for partial issued IDs if upload fails. Publication does not place a model in Workspace. Default mode=fbx uses the existing FBX exporter for external interchange, which may combine meshes sharing one Skeleton; use the returned file with asset_manager.import. Stop PIE first.",
  params: z.object({ buildId, expectedRevision: revisions, mode: z.enum(["fbx", "publish"]).optional() }).strict(),
};
export const inspect = {
  method: "proceduralcharacter.inspect",
  readOnly: true,
  timeoutMs: 900_000,
  description:
    "Inspect a non-ODA character: mode=source reads an imported static Model in the editing map, returning part identities, local placements, material slots, common-space bounds and optional paged final vertex IDs/positions for authored weights. Stop PIE before source inspection. mode=build reads a saved manifest; mode=observation renders and measures the exact reviewed revisions; mode=runtime inspects a named live Workspace Model on client or authority. Inspect actual images and compare runtime samples for changing bone poses and advancing track time. Runtime requires PIE. This is the single character inspection tool.",
  params: z.discriminatedUnion("mode", [
    z
      .object({
        mode: z.literal("source"),
        guid: z.string().regex(/^(?:[A-Fa-f0-9]{32}|[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12})$/),
        region: buildId.optional(),
        vertexOffset: z.number().int().nonnegative().optional(),
        vertexCount: z.number().int().positive().max(1024).optional(),
      })
      .strict(),
    z.object({ mode: z.literal("build"), buildId }).strict(),
    z
      .object({
        mode: z.literal("observation"),
        buildId,
        scenario: z.enum([
          "rest_views",
          "single_bone_pose",
          "knee_bend_45",
          "knee_bend_90",
          "walk_contact_sheet",
          "walk_side",
          "world_travel",
        ]),
        expectedRevision: revisions,
      })
      .strict(),
    z
      .object({
        mode: z.literal("runtime"),
        modelName: z.string().min(1),
        world: z.enum(["client", "authority"]).optional(),
      })
      .strict(),
  ]),
};
