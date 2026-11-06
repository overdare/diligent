// @summary Reads immutable snapshot pages and computes GUID-based saved-map preservation differences.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { pickInstanceProperties } from "../methods/instance-properties";
import { decodeOvdrjm } from "./ovdrjm-utils";

const IDENTITY_LABEL_CAP = 200;

export interface SnapshotDataOptions {
  view: "tree" | "instance" | "script";
  guid?: string;
  offset: number;
  limit: number;
}

export interface SnapshotNodeIdentity {
  guid: string;
  name: string;
  class: string;
  parentGuid?: string;
  depth: number;
  childCount: number;
}

export type SnapshotDataPage =
  | {
      view: "tree";
      units: "nodes";
      offset: number;
      total: number;
      nextOffset?: number;
      nodes: SnapshotNodeIdentity[];
    }
  | {
      view: "instance" | "script";
      units: "characters";
      offset: number;
      total: number;
      nextOffset?: number;
      instance: SnapshotNodeIdentity;
      content: string;
    };

type SnapshotNode = Record<string, unknown>;

interface LocatedNode {
  node: SnapshotNode;
  parentGuid?: string;
  depth: number;
}

function isPlainRecord(value: unknown): value is SnapshotNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function childrenOf(node: SnapshotNode): SnapshotNode[] {
  return Array.isArray(node.LuaChildren) ? node.LuaChildren.filter(isPlainRecord) : [];
}

function textPreview(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.length > IDENTITY_LABEL_CAP ? `${value.slice(0, IDENTITY_LABEL_CAP - 1)}…` : value;
}

function identityOf(located: LocatedNode, depth = located.depth): SnapshotNodeIdentity {
  const children = childrenOf(located.node);
  return {
    guid: typeof located.node.ActorGuid === "string" ? located.node.ActorGuid : "",
    name: textPreview(located.node.Name),
    class: textPreview(located.node.InstanceType),
    ...(located.parentGuid !== undefined ? { parentGuid: located.parentGuid } : {}),
    depth,
    childCount: children.length,
  };
}

function findByGuid(root: SnapshotNode, guid: string): LocatedNode | undefined {
  const stack: LocatedNode[] = [{ node: root, depth: 0 }];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.node.ActorGuid === guid) return current;
    const children = childrenOf(current.node);
    const parentGuid = typeof current.node.ActorGuid === "string" ? current.node.ActorGuid : undefined;
    for (let index = children.length - 1; index >= 0; index--) {
      stack.push({ node: children[index], parentGuid, depth: current.depth + 1 });
    }
  }
  return undefined;
}

function flattenPreorder(start: LocatedNode): SnapshotNodeIdentity[] {
  const rows: SnapshotNodeIdentity[] = [];
  const stack: Array<LocatedNode & { relativeDepth: number }> = [{ ...start, relativeDepth: 0 }];
  while (stack.length > 0) {
    const current = stack.pop()!;
    rows.push(identityOf(current, current.relativeDepth));
    const children = childrenOf(current.node);
    const parentGuid = typeof current.node.ActorGuid === "string" ? current.node.ActorGuid : undefined;
    for (let index = children.length - 1; index >= 0; index--) {
      stack.push({
        node: children[index],
        parentGuid,
        depth: current.depth + 1,
        relativeDepth: current.relativeDepth + 1,
      });
    }
  }
  return rows;
}

function validatePage(options: SnapshotDataOptions): void {
  if (!Number.isSafeInteger(options.offset) || options.offset < 0) {
    throw new Error("Snapshot data offset must be a non-negative integer.");
  }
  if (!Number.isSafeInteger(options.limit) || options.limit <= 0) {
    throw new Error("Snapshot data limit must be a positive integer.");
  }
}

function pageContent(
  view: "instance" | "script",
  instance: SnapshotNodeIdentity,
  content: string,
  offset: number,
  limit: number,
): Extract<SnapshotDataPage, { view: "instance" | "script" }> {
  const page = content.slice(offset, offset + limit);
  const end = offset + page.length;
  return {
    view,
    units: "characters",
    offset,
    total: content.length,
    ...(end < content.length ? { nextOffset: end } : {}),
    instance,
    content: page,
  };
}

/** Shared immutable-file parser; never resolves the current project map. */
async function readSnapshotRoot(snapshotPath: string): Promise<SnapshotNode> {
  const bytes = await readFile(snapshotPath);
  let document: unknown;
  try {
    document = JSON.parse(decodeOvdrjm(bytes));
  } catch (error) {
    throw new Error(`Invalid snapshot .ovdrjm JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const root = isPlainRecord(document) ? document.Root : undefined;
  if (!isPlainRecord(root)) {
    throw new Error("Invalid snapshot .ovdrjm format: Root must be an object.");
  }
  return root;
}

/** Reads one bounded page from a saved .ovdrjm without touching the live project or Studio RPC. */
export async function readSnapshotData(snapshotPath: string, options: SnapshotDataOptions): Promise<SnapshotDataPage> {
  validatePage(options);
  const root = await readSnapshotRoot(snapshotPath);

  let target: LocatedNode = { node: root, depth: 0 };
  if (options.guid !== undefined) {
    const found = findByGuid(root, options.guid);
    if (!found) throw new Error(`Snapshot instance "${options.guid}" was not found.`);
    target = found;
  }

  if (options.view === "tree") {
    const rows = flattenPreorder(target);
    const nodes = rows.slice(options.offset, options.offset + options.limit);
    const end = options.offset + nodes.length;
    return {
      view: "tree",
      units: "nodes",
      offset: options.offset,
      total: rows.length,
      ...(end < rows.length ? { nextOffset: end } : {}),
      nodes,
    };
  }

  if (options.guid === undefined) {
    throw new Error(`Snapshot ${options.view} view requires a guid.`);
  }
  const instance = identityOf(target);
  if (options.view === "script") {
    if (!("Source" in target.node)) {
      throw new Error(`Snapshot instance "${options.guid}" has no Source property.`);
    }
    if (typeof target.node.Source !== "string") {
      throw new Error(`Snapshot instance "${options.guid}" Source is not a string.`);
    }
    return pageContent("script", instance, target.node.Source, options.offset, options.limit);
  }

  const properties = pickInstanceProperties(target.node);
  delete properties.Source;
  return pageContent("instance", instance, JSON.stringify(properties, null, 2), options.offset, options.limit);
}

interface DiffIdentity {
  name: string | null;
  class: string | null;
  parentGuid: string | null;
}

interface SnapshotChange {
  guid: string;
  status: "added" | "removed" | "changed";
  before: DiffIdentity | null;
  after: DiffIdentity | null;
  changedFields: Array<keyof DiffIdentity>;
  changedProperties: string[];
  sourceSha256?: { before: string | null; after: string | null };
}

export interface SnapshotDiffPage {
  view: "diff";
  units: "changes";
  offset: number;
  total: number;
  nextOffset?: number;
  counts: { added: number; removed: number; changed: number; unchanged: number };
  changes: SnapshotChange[];
}

interface DiffNode {
  identity: DiffIdentity;
  properties: Record<string, unknown>;
}

/** Fail closed rather than filtering malformed children or collapsing duplicate identities. */
function indexSnapshot(root: SnapshotNode): Map<string, DiffNode> {
  const nodes = new Map<string, DiffNode>();
  const stack: Array<{ node: SnapshotNode; parentGuid: string | null }> = [{ node: root, parentGuid: null }];
  while (stack.length > 0) {
    const { node, parentGuid } = stack.pop()!;
    const guid = node.ActorGuid;
    if (typeof guid !== "string" || guid.trim().length === 0) {
      throw new Error("Invalid snapshot identity: every instance must have a non-empty ActorGuid.");
    }
    if (nodes.has(guid)) throw new Error("Invalid snapshot identity: duplicate ActorGuid.");
    if (node.Name !== undefined && typeof node.Name !== "string") {
      throw new Error("Invalid snapshot identity: Name must be a string when present.");
    }
    if (node.InstanceType !== undefined && typeof node.InstanceType !== "string") {
      throw new Error("Invalid snapshot identity: InstanceType must be a string when present.");
    }
    if (node.Source !== undefined && typeof node.Source !== "string") {
      throw new Error("Invalid snapshot property: Source must be a string when present.");
    }
    nodes.set(guid, {
      identity: {
        name: typeof node.Name === "string" ? node.Name : null,
        class: typeof node.InstanceType === "string" ? node.InstanceType : null,
        parentGuid,
      },
      properties: pickInstanceProperties(node),
    });
    if (node.LuaChildren === undefined) continue;
    if (!Array.isArray(node.LuaChildren)) {
      throw new Error("Invalid snapshot hierarchy: LuaChildren must be an array when present.");
    }
    for (const child of node.LuaChildren) {
      if (!isPlainRecord(child)) throw new Error("Invalid snapshot hierarchy: each child must be an object.");
      stack.push({ node: child, parentGuid: guid });
    }
  }
  return nodes;
}

/** Compare each saved file once; output shrinking slices this result, never rereads either map. */
export async function readSnapshotDiff(
  beforePath: string,
  afterPath: string,
  options: Pick<SnapshotDataOptions, "offset" | "limit">,
): Promise<SnapshotDiffPage> {
  validatePage({ ...options, view: "tree" });
  const [beforeRoot, afterRoot] = await Promise.all([readSnapshotRoot(beforePath), readSnapshotRoot(afterPath)]);
  const beforeNodes = indexSnapshot(beforeRoot);
  const afterNodes = indexSnapshot(afterRoot);
  const guids = [...new Set([...beforeNodes.keys(), ...afterNodes.keys()])].sort();
  const counts = { added: 0, removed: 0, changed: 0, unchanged: 0 };
  const changes: SnapshotChange[] = [];
  let total = 0;
  for (const guid of guids) {
    const before = beforeNodes.get(guid);
    const after = afterNodes.get(guid);
    const changedFields: Array<keyof DiffIdentity> = [];
    if (before && after) {
      for (const field of ["name", "class", "parentGuid"] as const) {
        if (before.identity[field] !== after.identity[field]) changedFields.push(field);
      }
    }
    const propertyNames = new Set([...Object.keys(before?.properties ?? {}), ...Object.keys(after?.properties ?? {})]);
    const changedProperties = [...propertyNames]
      .filter(
        (key) =>
          !before ||
          !after ||
          !Object.hasOwn(before.properties, key) ||
          !Object.hasOwn(after.properties, key) ||
          !isDeepStrictEqual(before.properties[key], after.properties[key]),
      )
      .sort();
    if (before && after && changedFields.length === 0 && changedProperties.length === 0) {
      counts.unchanged++;
      continue;
    }
    const status = !before ? "added" : !after ? "removed" : "changed";
    counts[status]++;
    const index = total++;
    if (index < options.offset || changes.length >= options.limit) continue;
    const beforeSource = before?.properties.Source;
    const afterSource = after?.properties.Source;
    changes.push({
      guid,
      status,
      before: before?.identity ?? null,
      after: after?.identity ?? null,
      changedFields,
      changedProperties,
      ...(typeof beforeSource === "string" || typeof afterSource === "string"
        ? {
            sourceSha256: {
              before: typeof beforeSource === "string" ? createHash("sha256").update(beforeSource).digest("hex") : null,
              after: typeof afterSource === "string" ? createHash("sha256").update(afterSource).digest("hex") : null,
            },
          }
        : {}),
    });
  }
  const end = options.offset + changes.length;
  return {
    view: "diff",
    units: "changes",
    offset: options.offset,
    total,
    ...(end < total ? { nextOffset: end } : {}),
    counts,
    changes,
  };
}
