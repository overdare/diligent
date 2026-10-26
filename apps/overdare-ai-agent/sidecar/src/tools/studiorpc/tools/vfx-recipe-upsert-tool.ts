// @summary Creates and patches VFXRecipe instances through the level file or the Studio instance RPCs.
import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { resolveApiVersion } from "../config";
import {
  parseVfxRecipeCreateProperties,
  parseVfxRecipePatchProperties,
  vfxRecipePropertiesSchema,
} from "../methods/vfx-recipe.params";
import { buildVfxRecipeUpsertRender } from "../render";
import { applyLevelChanges as applyLevelChangesDefault } from "../rpc";
import type { Tool, ToolContext, ToolResult } from "../types";
import type { WriteLock } from "../write-lock";
import {
  type AddedInstanceMetadata,
  addInstancesInDocument,
  assertInstanceClasses,
  normalizeWorkspaceMobility,
  requireDocumentRoot,
  updateInstancesInDocument,
} from "./instance-document-operations";
import { resultFromInstanceToolStatusError } from "./instance-status";
import { readAndWriteOvdrjm, resolveOvdrjmPathFromUmap } from "./ovdrjm-utils";
import { upsertVfxRecipesViaRpc } from "./v2/vfx-recipe-upsert";

const TOOL_NAME = "studiorpc_vfx_recipe_upsert";
const METHOD = "vfx_recipe.upsert";
const CLASS_NAME = "VFXRecipe";

const items = (propertySchema: z.ZodTypeAny) =>
  z
    .array(
      z.union([
        z
          .object({ parentGuid: z.string().min(1), name: z.string().min(1), properties: propertySchema.optional() })
          .strict(),
        z
          .object({ guid: z.string().min(1), name: z.string().optional(), properties: propertySchema.optional() })
          .strict(),
      ]),
    )
    .min(1)
    .max(100);
const input = z.object({ items: items(z.record(z.unknown())) }).strict();

interface VfxRecipeAddItem {
  parentGuid: string;
  name: string;
  properties: Record<string, unknown>;
}
interface VfxRecipeUpdateItem {
  guid: string;
  name?: string;
  properties: Record<string, unknown>;
}
export type VfxRecipeItem = VfxRecipeAddItem | VfxRecipeUpdateItem;

function isVfxRecipeUpdate(item: VfxRecipeItem): item is VfxRecipeUpdateItem {
  return "guid" in item;
}

function parseInput(value: unknown) {
  const parsed = input.parse(value);
  const updates = parsed.items.filter((item) => "guid" in item).length;
  if (updates > 0 && updates < parsed.items.length)
    throw new Error("Do not mix recipe creates and updates in one call.");
  for (const item of parsed.items) {
    if ("guid" in item) parseVfxRecipePatchProperties(item.properties);
    else parseVfxRecipeCreateProperties(item.properties);
  }
  // Keep original input: execution performs the JSON transformations exactly once.
  return parsed;
}

function parseItems(args: unknown): VfxRecipeItem[] {
  return parseInput(args).items.map((item) =>
    "guid" in item
      ? { guid: item.guid, name: item.name, properties: parseVfxRecipePatchProperties(item.properties) }
      : { parentGuid: item.parentGuid, name: item.name, properties: parseVfxRecipeCreateProperties(item.properties) },
  );
}

function vfxRecipeUpsertResult(
  args: unknown,
  parsedItems: readonly VfxRecipeItem[],
  added: readonly AddedInstanceMetadata[],
  info: readonly string[],
): ToolResult {
  const updatedGuids = parsedItems.flatMap((item) => (isVfxRecipeUpdate(item) ? [item.guid] : []));
  const lines: string[] = [];
  if (added.length > 0) {
    lines.push("<added-instances>");
    for (const a of added) lines.push(`<instance name="${a.name}" class="${a.class}" guid="${a.guid}" />`);
    lines.push("</added-instances>");
  }
  if (info.length > 0) lines.push("<suggestions>", ...info, "</suggestions>");
  const output = lines.join("\n") || "OK";
  return {
    output,
    render: buildVfxRecipeUpsertRender(args as Record<string, unknown>, output),
    metadata: {
      method: METHOD,
      targetGuids: [...updatedGuids, ...added.map((item) => item.guid)],
      addCount: added.length,
      updateCount: updatedGuids.length,
      added,
      ...(info.length > 0 && { info }),
    },
  };
}

async function upsertVfxRecipesInFile(
  args: unknown,
  parsedItems: readonly VfxRecipeItem[],
  cwd: string,
  applyLevelChanges: () => Promise<unknown>,
): Promise<ToolResult> {
  const fileResult = (() => {
    try {
      const { ovdrjmPath } = resolveOvdrjmPathFromUmap(cwd);
      const originalBytes = readFileSync(ovdrjmPath);
      const result = readAndWriteOvdrjm(cwd, (rootDoc) => {
        const root = requireDocumentRoot(rootDoc);
        assertInstanceClasses(
          root,
          parsedItems.map((item) => (isVfxRecipeUpdate(item) ? item : { class: CLASS_NAME })),
          CLASS_NAME,
        );
        const mobilityInfo: string[] = [];
        const added: AddedInstanceMetadata[] = [];
        for (const item of parsedItems) {
          if (isVfxRecipeUpdate(item)) updateInstancesInDocument(root, [item], { mobilityInfo });
          else added.push(...addInstancesInDocument(rootDoc, [{ ...item, class: CLASS_NAME }], { mobilityInfo }));
        }
        // A top-level object's Mobility governs its whole assembly, so cascade it
        // down to every descendant that carries an explicit Mobility.
        normalizeWorkspaceMobility(root);
        return { added, mobilityInfo };
      });
      return { ...result, originalBytes, writtenBytes: readFileSync(ovdrjmPath) };
    } catch (error) {
      const result = resultFromInstanceToolStatusError(error);
      if (result) return result;
      throw error;
    }
  })();
  if ("output" in fileResult) return fileResult;

  try {
    await applyLevelChanges();
  } catch (error) {
    let recovery: string;
    try {
      // The write lock covers agent tools, but Studio or the user may save
      // during apply. Preserve those later bytes instead of overwriting them.
      if (readFileSync(fileResult.ovdrjmPath).equals(fileResult.writtenBytes)) {
        writeFileSync(fileResult.ovdrjmPath, fileResult.originalBytes);
        recovery = "file restored to its pre-upsert bytes";
      } else {
        recovery = "file changed after upsert; not restored";
      }
    } catch (restoreError) {
      recovery = `file restoration failed: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${METHOD} apply failed: ${message}; ${recovery}. Studio state is unconfirmed; inspect it before retrying.`,
      { cause: error },
    );
  }
  return vfxRecipeUpsertResult(args, parsedItems, fileResult.added, fileResult.mobilityInfo);
}

export function createVfxRecipeUpsertTool(
  cwd: string,
  writeLock: WriteLock,
  applyLevelChanges: () => Promise<unknown> = applyLevelChangesDefault,
): Tool {
  return {
    name: TOOL_NAME,
    description:
      "Create or update VFXRecipe instances and BaseLayer/DetailLayer/ExtraLayer arrays. Use this dedicated tool instead of execute_luau for recipe creation and layer edits. Create with parentGuid/name/properties (class is always VFXRecipe); update with guid and optional name/properties. Do not mix creates and updates. Read existing recipes with studiorpc_instance_read, then send the complete modified layer array; omitted properties and layers are preserved on update, and [] clears a layer. Accepts per-layer short source names, resource names or full serving paths; validates layer membership and adds JSON type tags. Alpha stays a bare keypoint array. Top-level LoopDuration is derived and ignored. Unsupported source-specific parameters may be ignored by Studio; use the vfx-recipe skill and supplied source references. Automatically saves. Runtime SetParam/SetParamAt and Play/Stop are gameplay APIs, not commands of this tool.",
    parameters: z.object({ items: items(vfxRecipePropertiesSchema.partial()) }).strict(),
    parseArgs: parseInput,
    async execute(args, ctx: ToolContext) {
      const parsedItems = parseItems(args);
      const approval = await ctx.approve({
        permission: "write",
        toolName: TOOL_NAME,
        description: "Update .ovdrjm world file",
        details: args,
      });
      if (approval === "reject") {
        return { output: "[Rejected by user]", metadata: { error: true, method: METHOD } };
      }
      const release = await writeLock.acquire();
      try {
        if (resolveApiVersion() !== "v2")
          return await upsertVfxRecipesInFile(args, parsedItems, cwd, applyLevelChanges);
        try {
          const { added, info } = await upsertVfxRecipesViaRpc(parsedItems);
          return vfxRecipeUpsertResult(args, parsedItems, added, info);
        } catch (error) {
          const result = resultFromInstanceToolStatusError(error);
          if (result) return result;
          throw error;
        }
      } finally {
        release();
      }
    },
  };
}
