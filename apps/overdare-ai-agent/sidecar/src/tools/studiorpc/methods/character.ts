// @summary Exposes agent-authored custom character geometry, rigs and clips through ordinary Studio tools.

import type { ImageBlock } from "@diligent/protocol";
import { z } from "zod";
import authoringGuide from "../../../../../bootstrap/skills/custom-character/references/authoring.json";
import { isRecord } from "../camera-response";
import { StudioRpcError } from "../rpc";
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
    "Read live Studio character capabilities and limits, enriched with Diligent's version-matched rig/weight/motion reference. Use custom-character for authoring guidance.",
  params: z.object({}).strict(),
  postProcess(result: unknown): unknown {
    if (!isRecord(result)) return result;
    return {
      ...result,
      authoringGuide:
        result.version === authoringGuide.studioContract
          ? authoringGuide
          : { status: "unavailable", supportedStudioContract: authoringGuide.studioContract },
    };
  },
};
export const build = {
  method: "character.build",
  timeoutMs: 900_000,
  recover: async (error: unknown) => withBuildErrorData(error),
  description:
    "Build a saved custom character draft from geometry plus separate rig and motion.document data. Read character.api for formats and limits. Inspected static or baked ProceduralModel inputs use geometryRevision, part GUIDs and final vertex IDs; private recipe captures use generated part names. Existing-rig inputs use rigRevision and target.kind=animation_only, preserving the original rig and accepting only new motion. Exactly one skin region is supported; other captured parts can be Bone attachments. Inputs freeze per requestId; retries/commit reuse the snapshot, while a new requestId captures changes. commit=false saves a draft without captures; commit=true requires its exact four revisions and native integrity checks. mode=apply requires an inspected source draft, successful publicationId and expectedSourceGraphRevision. It changes Workspace without saving, using existing character classes and RigBuilder frame/size; recipe-only drafts cannot apply. Changed sources, partial uploads and name conflicts reject placement. Stop PIE before apply; persist with studiorpc_level_save_file. Use custom-character for review and gameplay integration.",
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
  recover: async (error: unknown) => withErrorData(error),
  description:
    "Export a committed character. Default mode=fbx returns an interchange file; mode=publish returns ordinary numeric ovdrassetid references. New characters publish Skeleton, one skin mesh and animation; retained local static props and TextureId overrides upload as independent copies, reusing existing IDs. Existing-rig drafts publish only new animation with the original Skeleton. Sources remain unchanged and no model is placed. Failed uploads may retain issued IDs in nativePublication; inspect the report before a new attempt. Stop PIE first.",
  params: z.object({ buildId, expectedRevision: revisions, mode: z.enum(["fbx", "publish"]).optional() }).strict(),
};
export const inspect = {
  method: "character.inspect",
  readOnly: true,
  timeoutMs: 900_000,
  description:
    "Inspect a custom character. mode=source reads source identities/revisions and paged static vertex data, or an existing single-skin rig with native bind poses; stop PIE first. mode=build reads a saved manifest. mode=observation reads or captures one revision-bound preset; refresh recaptures it, and images selects attachments (RGB by default). Bone probes need explicit observationBones/bendTestRegions. mode=runtime requires PIE and selects a named Model on client or authority. Optional skin returns evaluated linear-skin positions and stable render vertex IDs; it does not advance playback or refresh bones. Missing CPU buffers or active morphs are unavailable. Morph/cloth/WPO effects are outside measurement scope. Review and interpretation guidance is in custom-character.",
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
            "Stop PIE first, then recapture only the selected revision-bound observation preset. Does not change Workspace or animation keys. Omit to read its saved capture, or capture that preset on demand when missing.",
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
        skin: z
          .object({
            contacts: z
              .array(z.string().min(1))
              .min(1)
              .max(8)
              .refine(
                (values) => new Set(values.map((value) => value.toLowerCase())).size === values.length,
                "Select each contact bone once",
              ),
            groundHeightCm: z.number().finite().optional(),
          })
          .strict()
          .optional()
          .describe(
            "Sample the live evaluated skin sole vertices influenced by these contact bones. groundHeightCm is a declared flat ground plane in native Unreal Z-up centimetres, default 0. Returns stable vertex IDs and world positions for comparing real stance slide between samples; does not advance playback or modify the model.",
          ),
      })
      .strict(),
  ]),
};

/** Frozen source graphs can exceed 200 KiB; keep diagnostics readable and retain the full error data. */
function withBuildErrorData(error: unknown): never {
  if (!(error instanceof StudioRpcError) || !isRecord(error.data)) return withErrorData(error);
  const { staticInput: _staticInput, recipeInput: _recipeInput, ...visible } = error.data;
  throw new StudioRpcError(
    `${error.message}\n\nError data:\n${JSON.stringify(visible, null, 2)}`,
    error.code,
    error.data,
  );
}

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
