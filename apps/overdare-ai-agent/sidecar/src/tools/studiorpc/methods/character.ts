// @summary Exposes agent-authored non-ODA geometry, rigs and clips through ordinary Studio tools.

import type { ImageBlock } from "@diligent/protocol";
import { z } from "zod";
import { isRecord } from "../camera-response";
import { attachPreviewImage, withErrorData } from "./animation-shared";

const buildId = z.string().regex(/^[A-Fa-f0-9]{32}$/);
const hash = z
  .string()
  .regex(/^[A-Fa-f0-9]{40}$/)
  .transform((value) => value.toUpperCase());
const revisions = z
  .object({ sourceRevision: hash, geometryHash: hash, rigRevision: hash, animationRevision: hash })
  .strict();

export const api = {
  method: "character.api",
  readOnly: true,
  description:
    "Read the live non-ODA custom character contract, rig/weight/motion schemas and existing Lua instance contract. Use for creatures, animals or custom characters with exactly one skinned region and one skeletal MeshPart; additional static props can attach to Bones. The agent authors anatomy and motion; Studio imports, measures, renders and saves it. Read proceduralmodel.api for geometry functions. ODA costume templates and animation.read/write are separate workflows.",
  params: z.object({}).strict(),
};
export const build = {
  method: "character.build",
  timeoutMs: 900_000,
  description:
    "Build agent-authored geometry, rig weights and animation from an inline recipe, an existing ProceduralModel GUID, or an inspected static Model using authored_v1. For an already baked ProceduralModel, inspect(mode=source) then pass its geometryRevision and direct rig and motion.document, just like static_model. Source capture reads current baked parts without rebaking or changing the model. All new geometry inputs take separate structured rig and motion.document data; geometry recipes do not write rig or animation files. Without geometryRevision, a ProceduralModel freezes its geometry Source and parameters for a private capture without baking the Workspace model; rig regions use generated part names. With geometryRevision, regions use inspected part GUIDs. Stale geometry is rejected before applying weights. Studio freezes source inputs for each requestId; retries and commit reuse the saved draft even if the source changes or is removed. Use a new requestId to capture new inputs. For an already rigged Workspace Model with exactly one skeletal MeshPart directly under its Model, inspect(mode=source) then use existing_rig with its rigRevision, target.kind=animation_only and motion.document, omitting rig and overrides. The original numeric Skeleton, skeletal mesh, bind poses, weights, materials and props are preserved; apply adds only a new Animation under the original model. Retained editable CPU LOD0 and an existing Humanoid/Skeleton are required. For inspected geometry, rig.boneAttachments maps prop part GUIDs to declared bones. rig.regions must contain exactly one skinned region, producing one skeletal mesh and one direct Model MeshPart. Additional parts stay as existing static MeshParts under their declared Bones. Separate skinned regions are rejected; combine them into one mesh before import. Prop subtrees cannot contain other captured MeshParts. Read character.api first. commit=false creates a saved draft with real observation images. Inspect images, verify-source in a fresh process with character_poc.py, then commit the exact four reviewed revisions. Use export mode=publish for normal numeric native assets. Explicit mode=apply takes buildId, publicationId, expectedRevision and expectedSourceGraphRevision, and clones a frozen inspected Model or baked ProceduralModel into Workspace with existing Lua character classes. The single skinned MeshPart uses the existing non-ODA direct-child path and normal RigBuilder frame and Size behavior; its original static-part frame is not preserved. Missing numeric assets download through the ordinary Studio importer before rechecking the document and revisions. It rejects changed sources, incomplete uploads and name conflicts; an already applied publication is returned as APPLY_ALREADY_EXISTS for inspection, never replaced. Stop PIE first. Apply requires an inspected model draft with explicit part identities; recipe-only drafts support build/publication. Verify saved-map Lua playback separately.",
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
            speedCmPerSec: z.number().finite().nonnegative().max(1000),
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
        const captured =
          request.source.kind === "static_model" ||
          (request.source.kind === "procedural_model" && request.source.geometryRevision);
        // Only Studio knows whether a requestId is already bound to historical
        // recipe outputs. It rejects document-free new requests before capture.
        if (
          captured
            ? !request.rig || !request.motion.document
            : Boolean(request.rig) !== Boolean(request.motion.document)
        ) {
          context.addIssue({
            code: "custom",
            message: "Geometry inputs require structured rig and motion.document together",
          });
        }
        if (captured && request.overrides && Object.keys(request.overrides).length) {
          context.addIssue({ code: "custom", message: "Recipe overrides do not apply to captured geometry" });
        }
        if (request.rig) {
          const regions = request.rig.regions;
          if (!regions || typeof regions !== "object" || Array.isArray(regions) || Object.keys(regions).length !== 1) {
            context.addIssue({
              code: "custom",
              path: ["rig", "regions"],
              message: "Geometry inputs require exactly one skinned region; static props belong in rig.boneAttachments",
            });
          }
        }
        if (
          Buffer.byteLength(
            JSON.stringify({ source: request.source, rig: request.rig, motion: request.motion }),
            "utf8",
          ) >
          2 * 1024 * 1024
        ) {
          context.addIssue({ code: "custom", message: "Authoring documents exceed 2 MiB" });
        }
      })
      .refine(
        (request) => !request.commit || request.expectedRevision !== undefined,
        "Commit requires the four reviewed revisions",
      ),
  ]),
};
export const exportAsset = {
  method: "character.export",
  timeoutMs: 900_000,
  description:
    "Export a committed reviewed character. mode=publish uploads one native skeletal mesh and animation through the existing asset publisher, with its Skeleton first, and returns real ovdrassetid:// references. Inspect the build's nativePublication for partial issued IDs if upload fails. Existing-rig publication uploads only a new clip referencing the original numeric Skeleton. Publication does not place a model in Workspace. Default mode=fbx uses the existing FBX exporter for external interchange, for the single skinned result and its static props; use the returned file with asset_manager.import. Stop PIE first.",
  params: z.object({ buildId, expectedRevision: revisions, mode: z.enum(["fbx", "publish"]).optional() }).strict(),
};
export const inspect = {
  method: "character.inspect",
  readOnly: true,
  timeoutMs: 900_000,
  description:
    "Inspect a non-ODA character: mode=source reads an imported static Model or a current baked ProceduralModel in the editing map, returning part identities, local placements, material slots, common-space bounds and optional paged final vertex IDs/positions for authored weights. For an already rigged Model with exactly one skeletal MeshPart directly under its Model, it returns existing_rig, rigRevision, original skeletonId and native bind poses, preserving original weights internally. Stop PIE before source inspection. mode=build reads a saved manifest; mode=observation reads rendered evidence at the exact reviewed revisions and attaches its RGB sheet by default. images selects rgb/bones/regions/weights, or false for measurements alone. Inspect the actual skin: contactValidation distinguishes measured stance from missing contact evidence, null slide is unmeasured, skinValidation reports penetration and surface stretch/collapse, and motionQuality requires visual review. passed alone proves neither natural deformation nor valid foot contact. mode=runtime inspects a named live Workspace Model on client or authority. Compare runtime samples for changing bone poses and advancing track time. Runtime requires PIE. This is the single character inspection tool.",
  normalizeArgs: normalizeInspectArgs,
  attachImages: attachInspectionImages,
  recover: async (error: unknown) => withErrorData(error),
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
        refresh: z
          .boolean()
          .optional()
          .describe(
            "world_travel only: stop PIE first, then remeasure and recapture the reviewed native draft in a disposable game world. Does not change Workspace or animation keys. Omit to read saved evidence.",
          ),
        images: z
          .union([
            z.literal(false),
            z
              .array(z.enum(["rgb", "bones", "regions", "weights"]))
              .min(1)
              .max(4)
              .refine((values) => new Set(values).size === values.length, "Select each image once"),
          ])
          .optional()
          .describe("Observation image attachments in order; default [rgb]. false returns measurements only."),
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

function normalizeInspectArgs(args: Record<string, unknown>): Record<string, unknown> {
  const { images: _images, ...nativeArgs } = args;
  return nativeArgs;
}

async function attachInspectionImages(
  result: unknown,
  args: Record<string, unknown>,
): Promise<ImageBlock[] | undefined> {
  if (args.mode !== "observation" || args.images === false || !isRecord(result) || result.captureStatus !== "completed")
    return undefined;
  const selected = Array.isArray(args.images) ? args.images : ["rgb"];
  const images: ImageBlock[] = [];
  for (const kind of selected) {
    const imagePath = result[`${kind}Path`];
    if (typeof imagePath !== "string") continue;
    const attached = await attachPreviewImage({ preview: { status: "completed", imagePath } });
    if (attached) images.push(...attached);
  }
  return images.length ? images : undefined;
}
