// @summary Shared utilities for reading and navigating .ovdrjm level files.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type OvdrjmNode = Record<string, unknown> & {
  ActorGuid?: unknown;
  LuaChildren?: unknown;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function findNodeByActorGuid(node: OvdrjmNode, targetGuid: string): OvdrjmNode | undefined {
  if (typeof node.ActorGuid === "string" && node.ActorGuid === targetGuid) {
    return node;
  }
  if (!Array.isArray(node.LuaChildren)) {
    return undefined;
  }
  for (const child of node.LuaChildren) {
    if (!isRecord(child)) continue;
    const found = findNodeByActorGuid(child as OvdrjmNode, targetGuid);
    if (found) return found;
  }
  return undefined;
}

export function findFilesByExtension(cwd: string, extension: string): string[] {
  const entries = readdirSync(cwd, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(extension))
    .map((entry) => join(cwd, entry.name));
}

export function resolveOvdrjmPathFromUmap(cwd: string): { umapPath: string; ovdrjmPath: string } {
  const umapFiles = findFilesByExtension(cwd, ".umap");
  if (umapFiles.length === 0) {
    throw new Error("No .umap file found in current working directory.");
  }
  if (umapFiles.length > 1) {
    throw new Error(
      `Multiple .umap files found (${umapFiles.map((file) => file.split("/").pop()).join(", ")}). Keep one world file in cwd.`,
    );
  }

  const umapPath = umapFiles[0];
  const ovdrjmPath = umapPath.replace(/\.umap$/i, ".ovdrjm");

  const ovdrjmFiles = findFilesByExtension(cwd, ".ovdrjm");
  if (!ovdrjmFiles.includes(ovdrjmPath)) {
    throw new Error(
      `Matching .ovdrjm file not found for ${umapPath.split("/").pop()}. Expected ${ovdrjmPath.split("/").pop()}.`,
    );
  }

  return { umapPath, ovdrjmPath };
}

export function readOvdrjmRoot(cwd: string): { umapPath: string; ovdrjmPath: string; root: OvdrjmNode } {
  const { umapPath, ovdrjmPath } = resolveOvdrjmPathFromUmap(cwd);
  const raw = readFileSync(ovdrjmPath, "utf-8");
  const parsedJson = JSON.parse(raw) as Record<string, unknown>;
  const root = parsedJson.Root;
  if (!isRecord(root)) {
    throw new Error("Invalid .ovdrjm format: Root object is missing.");
  }
  return { umapPath, ovdrjmPath, root: root as OvdrjmNode };
}
