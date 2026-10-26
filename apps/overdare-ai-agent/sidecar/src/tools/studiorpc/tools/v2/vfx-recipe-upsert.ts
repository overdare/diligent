// @summary Applies VFXRecipe creates and patches through the Studio instance RPCs.

import {
  type AddedInstanceMetadata,
  addInstancesInDocument,
  assertInstanceClasses,
  normalizeWorkspaceMobility,
  updateInstancesInDocument,
} from "../instance-document-operations";
import { findNodeByActorGuid, type OvdrjmNode } from "../ovdrjm-utils";
import type { VfxRecipeItem } from "../vfx-recipe-upsert-tool";
import { callInstanceRpc, createdActorGuids, readLevelRoot, saveLevelFile, takeWarnings } from "./client";

/** Studio issues ActorGuid and ObjectKey itself, and children arrive through their own calls. */
const LOCAL_ONLY_KEYS = new Set(["ActorGuid", "ObjectKey", "LuaChildren"]);

interface PendingAdd {
  node: OvdrjmNode;
  addedIndex: number;
}

function toCreatePayload(node: OvdrjmNode): Record<string, unknown> {
  return Object.fromEntries(Object.entries(node).filter(([key]) => !LOCAL_ONLY_KEYS.has(key)));
}

/** Keys the local write replaced. Property values are objects, so identity is the comparison. */
function changedProperties(before: Record<string, unknown>, after: OvdrjmNode): Record<string, unknown> {
  const changed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(after)) {
    if (key === "LuaChildren") continue;
    if (before[key] !== value) changed[key] = value;
  }
  return changed;
}

/**
 * Applies the batch to a local copy of the level first, so class preflight, Mobility policy and
 * GUID resolution match the file backend, then sends only the resulting changes to Studio.
 */
export async function upsertVfxRecipesViaRpc(
  items: readonly VfxRecipeItem[],
): Promise<{ added: AddedInstanceMetadata[]; info: string[] }> {
  const root = await readLevelRoot();
  assertInstanceClasses(
    root,
    items.map((item) => ("guid" in item ? item : { class: "VFXRecipe" })),
    "VFXRecipe",
  );
  const document: Record<string, unknown> = { Root: root };
  const mobilityInfo: string[] = [];
  const updateInstances: Record<string, unknown>[] = [];
  const addsByParent = new Map<string, PendingAdd[]>();
  const added: AddedInstanceMetadata[] = [];

  for (const item of items) {
    if ("guid" in item) {
      const target = findNodeByActorGuid(root, item.guid);
      const before = target ? { ...target } : {};
      updateInstancesInDocument(root, [item], { mobilityInfo });
      if (target) updateInstances.push({ ActorGuid: item.guid, ...changedProperties(before, target) });
      continue;
    }
    const [metadata] = addInstancesInDocument(document, [{ ...item, class: "VFXRecipe" }], { mobilityInfo });
    const node = findNodeByActorGuid(root, metadata.guid);
    if (!node) throw new Error(`Locally added instance disappeared: ${metadata.guid}`);
    added.push(metadata);
    const pending = addsByParent.get(item.parentGuid) ?? [];
    pending.push({ node, addedIndex: added.length - 1 });
    addsByParent.set(item.parentGuid, pending);
  }

  if (updateInstances.length > 0) {
    await callInstanceRpc("instance.update", { Instances: updateInstances });
  }
  // instance.create takes one parent per call, so adds are grouped by parentGuid.
  for (const [parentGuid, pending] of addsByParent) {
    const result = await callInstanceRpc("instance.create", {
      ParentActorGuid: parentGuid,
      Instances: pending.map((entry) => toCreatePayload(entry.node)),
    });
    const guids = createdActorGuids(result);
    pending.forEach((entry, position) => {
      const guid = guids[position] ?? "";
      entry.node.ActorGuid = guid;
      added[entry.addedIndex].guid = guid;
    });
  }

  // Studio cascades a top-level object's Mobility by itself and refuses a Mobility set below
  // Workspace, so only the local tree is brought in line to keep the reported info consistent.
  normalizeWorkspaceMobility(root);
  await saveLevelFile();
  return { added, info: [...mobilityInfo, ...takeWarnings()] };
}
