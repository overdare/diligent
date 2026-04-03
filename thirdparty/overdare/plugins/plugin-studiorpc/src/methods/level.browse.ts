import { z } from "zod";

export const method = "level.browse";

export const description =
  'Browse the level instance tree. Returns instances with guid, name, class, children, and optional filename (e.g. "WorldManagerScript_1.lua" for Script instances). Optionally filter by classType to return only instances of a specific class.';

export const params = z.object({
  startGuid: z.string().optional().describe("If provided, start browsing from this instance instead of the root."),
  classType: z
    .string()
    .optional()
    .describe('If provided, only return instances whose class matches this value (e.g. "Script", "Part").'),
});

/** Strip client-only params before sending to Studio RPC (server doesn't support them). */
export function normalizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const { startGuid: _s, classType: _c, ...rest } = args;
  return rest;
}

type BrowseNode = { guid: string; class: string; children?: BrowseNode[] };

function findNode(nodes: BrowseNode[], guid: string): BrowseNode | undefined {
  for (const node of nodes) {
    if (node.guid === guid) return node;
    if (node.children) {
      const found = findNode(node.children, guid);
      if (found) return found;
    }
  }
  return undefined;
}

function filterByClass(nodes: BrowseNode[], classType: string): BrowseNode[] {
  const result: BrowseNode[] = [];
  for (const node of nodes) {
    const children = node.children ? filterByClass(node.children, classType) : [];
    if (node.class === classType || children.length > 0) {
      result.push({ ...node, children });
    }
  }
  return result;
}

export function postProcess(result: unknown, args: Record<string, unknown>): unknown {
  if (!Array.isArray(result)) return result;
  let nodes = result as BrowseNode[];

  const startGuid = typeof args.startGuid === "string" ? args.startGuid : undefined;
  if (startGuid) {
    const start = findNode(nodes, startGuid);
    if (!start) return [];
    nodes = [start];
  }

  const classType = typeof args.classType === "string" ? args.classType : undefined;
  if (classType) {
    nodes = filterByClass(nodes, classType);
  }

  return nodes;
}
