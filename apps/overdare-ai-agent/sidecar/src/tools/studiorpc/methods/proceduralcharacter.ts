// @summary Exposes agent-authored non-ODA geometry, rigs and clips through ordinary Studio tools.
import { z } from "zod";

const buildId = z.string().regex(/^[A-Fa-f0-9]{32}$/);
const hash = z.string().regex(/^[A-Fa-f0-9]{40}$/);
const revisions = z
  .object({ sourceRevision: hash, geometryHash: hash, rigRevision: hash, animationRevision: hash })
  .strict();

export const api = {
  method: "proceduralcharacter.api",
  readOnly: true,
  description:
    "Read the live non-ODA custom character contract, rig/weight/motion schemas and Lua runtime module. Use for arbitrary creatures, animals or custom skeletal characters. The agent authors anatomy and motion; Studio imports, measures, renders and saves it. Read proceduralmodel.api for geometry functions. ODA costume templates and animation.read/write are separate workflows.",
  params: z.object({}).strict(),
};
export const build = {
  method: "proceduralcharacter.build",
  timeoutMs: 900_000,
  description:
    "Build agent-authored geometry, rig weights and animation from a Python recipe using authored_v1. Read proceduralcharacter.api first. commit=false creates a saved draft with real observation images and Windows cooked assets; it is not completion. Inspect images, run the returned fresh-process verification commands, then commit the exact four reviewed revisions. This does not install into the map or publish remotely. Preserve the original requestId and inputs for commit; a changed recipe needs a new requestId.",
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
      target: z.object({ kind: z.literal("new_custom_character"), name: z.string().min(1).max(128) }).strict(),
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
export const read = {
  method: "proceduralcharacter.read",
  readOnly: true,
  description:
    "Read a saved non-ODA build manifest, revisions, asset IDs and diagnostics. A timed-out build may have completed; read its known buildId before retrying. preview_ready is a draft.",
  params: z.object({ buildId }).strict(),
};
export const observe = {
  method: "proceduralcharacter.observe",
  timeoutMs: 900_000,
  description:
    "Render and measure the exact reviewed non-ODA draft: anatomy, isolated bone deformation, bends, contact sheet, side view or world travel. Inspect the returned actual image files and metrics; generated source or a success flag alone is not animation quality evidence.",
  params: z
    .object({
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
};
export const install = {
  method: "proceduralcharacter.install",
  timeoutMs: 120_000,
  description:
    "Install a saved custom character into the current ordinary map. Exports portable /User packages and an ID table with cook dependencies, preserves other map assets, rejects collisions and saves the level. Then add the Lua module returned by proceduralcharacter.api and create a custom MeshPart + SkeletonId + Humanoid/Animator; AnimationId drives Animator:LoadAnimation and track:Play. Stop PIE first. No native preview actor or ODA avatar is created.",
  params: z.object({ buildId }).strict(),
};
export const runtime = {
  method: "proceduralcharacter.runtime",
  readOnly: true,
  description:
    "Inspect a named live non-ODA Lua Model on the client or authority: actual mesh/skeleton, animation instance, material paths, bone poses and AnimationTrack source, time and play state. Use two samples to verify actual bone movement and track progress, and Stop/AdjustSpeed behavior. Requires PIE; ambiguous names fail. Native showcase playback is separate.",
  params: z.object({ modelName: z.string().min(1), world: z.enum(["client", "authority"]).optional() }).strict(),
};
export const showcase = {
  method: "proceduralcharacter.showcase",
  timeoutMs: 120_000,
  description:
    "Create a separate native diagnostic viewing map for a custom character, optionally with another build. This preview does not prove normal Lua runtime playback. For a game, install into an ordinary map and verify proceduralcharacter.runtime. Opening changes the Studio session; reconnect afterward.",
  params: z
    .object({ buildId, compareBuildId: buildId.optional(), open: z.boolean().optional(), play: z.boolean().optional() })
    .strict(),
};

export const cook = {
  method: "proceduralcharacter.cook",
  timeoutMs: 900_000,
  description:
    "Locally cook the saved ordinary map and its /User dependency closure, including Lua scripts and installed non-ODA assets, to Windows packages. Stop PIE and save first. Requires Studio launched with r.ShaderCompiler.JobCacheDDC=0. Returns the package manifest and cooked map file; uploaded=false and runtimeVerified=false. This performs no remote publishing and is not runtime playback proof. Reopen the cooked output in a fresh test process and verify actual Lua Animator playback separately.",
  params: z.object({}).strict(),
};
