// @summary Keeps Workspace Mobility inheritance consistent after hierarchy moves.
import { findWorkspaceNode, isRecord, type OvdrjmNode } from "./ovdrjm-utils";

type MobilityValue = "Static" | "Movable";

/** Engine default when a node carries no explicit Mobility. */
const DEFAULT_MOBILITY: MobilityValue = "Movable";

function readMobility(node: OvdrjmNode): MobilityValue | undefined {
  return node.Mobility === "Static" || node.Mobility === "Movable" ? node.Mobility : undefined;
}

function effectiveMobility(node: OvdrjmNode): MobilityValue {
  return readMobility(node) ?? DEFAULT_MOBILITY;
}

/**
 * Forces every descendant's effective Mobility to match `mobility`. The engine
 * default is Movable, so an explicit key is written whenever a descendant's
 * effective value differs from the target: a Static top-level materializes
 * Static onto its (otherwise default-Movable) descendants, and a Movable
 * top-level rewrites any stale Static descendant back to Movable.
 */
function syncDescendantMobility(node: OvdrjmNode, mobility: MobilityValue): void {
  if (!Array.isArray(node.LuaChildren)) return;
  for (const child of node.LuaChildren) {
    if (!isRecord(child)) continue;
    const descendant = child as OvdrjmNode;
    if (effectiveMobility(descendant) !== mobility) descendant.Mobility = mobility;
    syncDescendantMobility(descendant, mobility);
  }
}

/**
 * Every Workspace top-level object (direct child of Workspace) governs the
 * Mobility of its whole assembly. Cascades each top-level object's effective
 * Mobility down to every descendant, so a Static top-level yields an all-Static
 * subtree and a Movable one an all-Movable subtree — regardless of whether the
 * descendants were created with an explicit Mobility.
 */
export function normalizeWorkspaceMobility(root: OvdrjmNode): void {
  const workspace = findWorkspaceNode(root);
  if (!workspace || !Array.isArray(workspace.LuaChildren)) return;
  for (const child of workspace.LuaChildren) {
    if (!isRecord(child)) continue;
    const topLevel = child as OvdrjmNode;
    syncDescendantMobility(topLevel, effectiveMobility(topLevel));
  }
}
