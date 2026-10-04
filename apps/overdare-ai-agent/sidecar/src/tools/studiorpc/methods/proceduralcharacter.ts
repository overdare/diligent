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
    "Build agent-authored geometry, rig weights and animation from a Python recipe using authored_v1. Read proceduralcharacter.api first. commit=false creates saved authoring source with real observation images; it is not completion. Inspect images, verify-source in a fresh process with character_poc.py, then commit the exact four reviewed revisions. Final assets still require existing FBX import/upload and saved-map Lua playback verification. This does not install into the map or publish remotely. Preserve the original requestId and inputs for commit; a changed recipe needs a new requestId.",
  params: z
    .object({
      requestId: z.string().min(1).max(128),
      source: z
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
      target: z.object({ kind: z.literal("new_custom_character"), name: z.string().min(1).max(64) }).strict(),
      rigProfile: z.literal("authored_v1"),
      motion: z
        .object({ preset: z.literal("authored_v1"), speedCmPerSec: z.number().finite().positive().max(1000) })
        .strict(),
      overrides: z.record(z.string(), z.number().finite()).optional(),
      commit: z.boolean(),
      expectedRevision: revisions.optional(),
    })
    .strict()
    .refine(
      (request) => !request.commit || request.expectedRevision !== undefined,
      "Commit requires the four reviewed revisions",
    ),
};
export const exportAsset = {
  method: "proceduralcharacter.export",
  timeoutMs: 120_000,
  description:
    "Export the committed, reviewed mesh, skeleton, skin weights and animation keys as FBX using Studio's existing exporter. Then use asset_manager.import to publish and place existing Lua instances under Workspace with real ovdrassetid:// references; inspect Workspace before using asset_drawer.import again. No alternate runtime, local ID table or native preview actor is installed. Stop PIE first.",
  params: z.object({ buildId, expectedRevision: revisions }).strict(),
};
export const inspect = {
  method: "proceduralcharacter.inspect",
  readOnly: true,
  timeoutMs: 900_000,
  description:
    "Inspect a non-ODA character: mode=build reads a saved manifest; mode=observation renders and measures the exact reviewed revisions; mode=runtime inspects a named live Workspace Model on client or authority. Inspect actual images and compare runtime samples for changing bone poses and advancing track time. Runtime requires PIE. This is the single character inspection tool.",
  params: z.discriminatedUnion("mode", [
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
