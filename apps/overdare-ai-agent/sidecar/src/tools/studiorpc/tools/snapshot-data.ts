// @summary Reads bounded tree, instance, or script pages directly from an immutable snapshot file.

import { readFile } from "node:fs/promises";
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

/** Reads one bounded page from a saved .ovdrjm without touching the live project or Studio RPC. */
export async function readSnapshotData(snapshotPath: string, options: SnapshotDataOptions): Promise<SnapshotDataPage> {
  validatePage(options);
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
