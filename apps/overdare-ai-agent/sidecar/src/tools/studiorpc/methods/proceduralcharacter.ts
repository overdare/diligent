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
    "Build agent-authored geometry, rig weights and animation from an inline recipe, an existing ProceduralModel GUID, or an inspected static Model using authored_v1. For an already baked ProceduralModel, inspect(mode=source) then pass its geometryRevision and direct rig and motion.document, just like static_model. Source capture reads current baked parts without rebaking or changing the model. Procedural sources without geometryRevision author rig.json and motion.json in the recipe; stale geometry is rejected before applying weights. Studio freezes source inputs for each requestId; retries and commit reuse the saved draft even if the source changes or is removed. Use a new requestId to capture new inputs. For an already rigged Workspace Model, inspect(mode=source) then use existing_rig with its rigRevision, target.kind=animation_only and motion.document, omitting rig and overrides. The original numeric Skeleton, meshes, bind poses, weights, materials and props are preserved; apply adds only a new Animation under the original model. Retained editable CPU LOD0 and an existing Humanoid/Skeleton are required. For inspected geometry, rig.boneAttachments maps prop part GUIDs to declared bones. Each part is either skinned through rig.regions or kept as an existing static MeshPart under that Bone; at least one skin part is required. Prop subtrees cannot contain other captured MeshParts. Read proceduralcharacter.api first. commit=false creates a saved draft with real observation images. Inspect images, verify-source in a fresh process with character_poc.py, then commit the exact four reviewed revisions. Use export mode=publish for normal numeric native assets. Explicit mode=apply takes buildId, publicationId, expectedRevision and expectedSourceGraphRevision, and clones a frozen inspected Model or baked ProceduralModel hierarchy into Workspace with existing Lua character classes. Missing numeric assets download through the ordinary Studio importer before rechecking the document and revisions. It rejects changed sources, incomplete uploads and name conflicts; an already applied publication is returned as APPLY_ALREADY_EXISTS for inspection, never replaced. Stop PIE first. Apply requires an inspected model draft with explicit part identities; recipe-only drafts support build/publication. Verify saved-map Lua playback separately.",
  params: z.union([
    z
      .object({
        mode: z.literal("apply"),
        buildId,
        publicationId: buildId,
        expectedRevision: revisions,
        expectedSourceGraphRevision: hash,
      })
      .strict(),
    z
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
              geometryRevision: hash.optional(),
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
          z
            .object({
              kind: z.literal("existing_rig"),
              guid: z.string().regex(/^(?:[A-Fa-f0-9]{32}|[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12})$/),
              rigRevision: hash,
            })
            .strict(),
        ]),
        target: z
          .object({ kind: z.enum(["new_custom_character", "animation_only"]), name: z.string().min(1).max(64) })
          .strict(),
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
        if (
          request.target.kind !== (request.source.kind === "existing_rig" ? "animation_only" : "new_custom_character")
        ) {
          context.addIssue({
            code: "custom",
            message: "Existing rigs require animation_only; geometry inputs require new_custom_character",
          });
        }
        if (request.source.kind === "existing_rig") {
          if (request.rig || !request.motion.document || (request.overrides && Object.keys(request.overrides).length)) {
            context.addIssue({
              code: "custom",
              message: "Existing rigs require motion.document and preserve native rig weights without recipe controls",
            });
          }
          if (
            Buffer.byteLength(JSON.stringify({ source: request.source, motion: request.motion }), "utf8") >
            2 * 1024 * 1024
          ) {
            context.addIssue({ code: "custom", message: "Animation authoring documents exceed 2 MiB" });
          }
          return;
        }
        if (
          request.source.kind === "static_model" ||
          (request.source.kind === "procedural_model" && request.source.geometryRevision)
        ) {
          if (!request.rig || !request.motion.document) {
            context.addIssue({ code: "custom", message: "Inspected model geometry requires rig and motion.document" });
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
  ]),
};
export const exportAsset = {
  method: "proceduralcharacter.export",
  timeoutMs: 900_000,
  description:
    "Export a committed reviewed character. mode=publish uploads separate native mesh parts and animation through the existing asset publisher, with their common Skeleton first, and returns real ovdrassetid:// references. Inspect the build's nativePublication for partial issued IDs if upload fails. Existing-rig publication uploads only a new clip referencing the original numeric Skeleton. Publication does not place a model in Workspace. Default mode=fbx uses the existing FBX exporter for external interchange, which may combine meshes sharing one Skeleton; use the returned file with asset_manager.import. Stop PIE first.",
  params: z.object({ buildId, expectedRevision: revisions, mode: z.enum(["fbx", "publish"]).optional() }).strict(),
};
export const inspect = {
  method: "proceduralcharacter.inspect",
  readOnly: true,
  timeoutMs: 900_000,
  description:
    "Inspect a non-ODA character: mode=source reads an imported static Model or a current baked ProceduralModel in the editing map, returning part identities, local placements, material slots, common-space bounds and optional paged final vertex IDs/positions for authored weights. For an already rigged Model it returns existing_rig, rigRevision, original skeletonId and native bind poses, preserving original weights internally. Stop PIE before source inspection. mode=build reads a saved manifest; mode=observation renders and measures the exact reviewed revisions; mode=runtime inspects a named live Workspace Model on client or authority. Inspect actual images and compare runtime samples for changing bone poses and advancing track time. Runtime requires PIE. This is the single character inspection tool.",
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
