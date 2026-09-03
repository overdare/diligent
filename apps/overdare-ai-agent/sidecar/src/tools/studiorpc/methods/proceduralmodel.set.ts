// @summary Declares the Studio RPC method that authors and bakes a ProceduralModel from a geometry recipe.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { CallRpc } from "../tools/pie-input/target";

export const method = "proceduralmodel.set";

export const description =
  "Author and bake a ProceduralModel from a Python geometry recipe: write its recipe, Size and parameters, " +
  "then (with rebuild) run the recipe and place the resulting MeshParts as its children. This is the main " +
  "authoring step for the geometry-recipe system — read studiorpc_geometry_api first for the contract and API. " +
  "Target an existing model with `guid`, OR omit `guid` and pass `name` (and optional `parentGuid`, default " +
  "Workspace) to CREATE the ProceduralModel and bake it in one call — the reply then carries the new `guid`. " +
  "Supply the recipe either inline with `source` (the whole module defining `on_generate(model, size, " +
  "attributes)`) OR by `sourcePath`, a path to a recipe file to reuse as-is — pass exactly one, or neither to " +
  "keep the model's current recipe. `size` is the model's Size in cm as [x, y, z] with Y up — the same three " +
  "numbers the Transform panel shows; changing it re-runs the recipe at the new footprint. `attributes` sets " +
  "the recipe's declared parameters by name. `rebuild: true` bakes now; the reply then carries the whole run — " +
  "`parts` (with triangles, boundsCm, tint, tier), `modelBoundsCm`, `warnings`, `stdout`, and on failure " +
  "`error` — so judge on the numbers first, then photograph the model with game.screenshot(instanceId=<guid>) " +
  "to see it. A recipe that breaks the contract is refused before a line of it runs, with the expected shape in " +
  "the message.";

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
    guid: z
      .string()
      .min(1)
      .optional()
      .describe("An existing ProceduralModel to author. Omit and pass `name` to create one instead."),
    name: z
      .string()
      .min(1)
      .optional()
      .describe("Name for a NEW ProceduralModel, created when `guid` is omitted. The reply returns its guid."),
    parentGuid: z
      .string()
      .min(1)
      .optional()
      .describe("Parent for a newly created model. Defaults to Workspace. Ignored when `guid` is given."),
    source: z
      .string()
      .optional()
      .describe(
        "The whole recipe inline — a module defining on_generate(model, size, attributes). Use this OR `sourcePath`, not both. Omit both to keep the current recipe.",
      ),
    sourcePath: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Path to an existing recipe file to reuse as-is (read host-side and sent as the source). Use this OR `source`, not both.",
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

type Args = Record<string, unknown>;

/** Marker set by preCall when it created the model, so postProcess can flag it. Stripped by normalizeArgs. */
const CREATED_FLAG = "__createdModel";

function stripBom(text: string): string {
  return text.replace(/^﻿/, "");
}

async function resolveWorkspaceGuid(callRpc: CallRpc): Promise<string> {
  const browsed = await callRpc("level.browse", {});
  const list = Array.isArray(browsed)
    ? browsed
    : Array.isArray((browsed as { level?: unknown[] })?.level)
      ? (browsed as { level: unknown[] }).level
      : [];
  const workspace = list.find(
    (node) =>
      node != null &&
      typeof node === "object" &&
      ((node as { Name?: unknown }).Name === "Workspace" ||
        (node as { InstanceType?: unknown }).InstanceType === "Workspace"),
  );
  const guid = workspace && (workspace as { ActorGuid?: unknown }).ActorGuid;
  if (typeof guid !== "string" || guid.length === 0) {
    throw new Error("Could not resolve the Workspace guid to parent the new ProceduralModel; pass `parentGuid`.");
  }
  return guid;
}

/**
 * Resolves the recipe source (inline or from a file) and creates the ProceduralModel
 * when only a name was given — both before the bake RPC, under the write lock.
 */
export async function preCall(args: Args, callRpc: CallRpc): Promise<void> {
  if (args.sourcePath !== undefined) {
    if (args.source !== undefined) {
      throw new Error("Provide either `source` (inline recipe) or `sourcePath` (a recipe file), not both.");
    }
    const path = resolve(String(args.sourcePath));
    let text: string;
    try {
      text = readFileSync(path, "utf-8");
    } catch (error) {
      throw new Error(`Could not read the recipe file at sourcePath: ${path} (${(error as Error).message})`);
    }
    args.source = stripBom(text);
  }

  if (args.guid === undefined) {
    if (args.name === undefined) {
      throw new Error("Provide `guid` for an existing ProceduralModel, or `name` to create a new one.");
    }
    const parentGuid =
      typeof args.parentGuid === "string" && args.parentGuid.length > 0
        ? args.parentGuid
        : await resolveWorkspaceGuid(callRpc);
    const created = await callRpc("instance.create", {
      ParentActorGuid: parentGuid,
      Instances: [{ InstanceType: "ProceduralModel", Name: String(args.name) }],
    });
    const guid = (created as { ActorGuids?: unknown[] })?.ActorGuids?.[0];
    if (typeof guid !== "string" || guid.length === 0) {
      throw new Error(`Studio did not return a guid for the new ProceduralModel "${String(args.name)}".`);
    }
    args.guid = guid;
    args[CREATED_FLAG] = true;
  }
}

/** Forwards only the keys Studio's proceduralmodel.set RPC knows; drops the tool-only creation/file fields. */
export function normalizeArgs(args: Args): Args {
  const out: Args = { guid: args.guid };
  if (args.source !== undefined) out.source = args.source;
  if (args.size !== undefined) out.size = args.size;
  if (args.attributes !== undefined) out.attributes = args.attributes;
  if (args.autoRebuild !== undefined) out.autoRebuild = args.autoRebuild;
  if (args.rebuild !== undefined) out.rebuild = args.rebuild;
  return out;
}

/** Surfaces the model guid (and whether it was just created) so the agent can iterate on the same model. */
export function postProcess(result: unknown, args: Args): unknown {
  if (result != null && typeof result === "object") {
    return { ...(result as Record<string, unknown>), guid: args.guid, created: args[CREATED_FLAG] === true };
  }
  return result;
}
