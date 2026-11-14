// @summary Discovers user-defined agents from project, config, and global directories
import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { BUILTIN_AGENT_TYPE_NAMES } from "../agent/agent-types";
import { resolveProjectDirName } from "../infrastructure/diligent-dir";
import { parseAgentFrontmatter, validateAgentName } from "./frontmatter";
import type { AgentLoadError, AgentLoadResult, AgentMetadata } from "./types";

export interface AgentDiscoveryOptions {
  cwd: string;
  globalConfigDir?: string;
  additionalPaths?: string[];
  knownToolNames?: Iterable<string>;
}

export async function discoverAgents(options: AgentDiscoveryOptions): Promise<AgentLoadResult> {
  const agents: AgentMetadata[] = [];
  const errors: AgentLoadError[] = [];
  const resolved = new Map<string, string>();

  for (const { dir, source } of getDiscoveryRoots(options)) {
    await scanAgentDirectory(dir, source, agents, errors, resolved, options.knownToolNames);
  }

  return { agents, errors };
}

function resolveGlobalConfigDir(): string {
  return join(process.env.HOME ?? process.env.USERPROFILE ?? homedir(), resolveProjectDirName());
}

function getDiscoveryRoots(options: AgentDiscoveryOptions): Array<{ dir: string; source: AgentMetadata["source"] }> {
  const roots: Array<{ dir: string; source: AgentMetadata["source"] }> = [];
  roots.push({ dir: join(options.cwd, resolveProjectDirName(), "agents"), source: "project" });
  for (const path of options.additionalPaths ?? []) {
    roots.push({ dir: path, source: "config" });
  }
  const globalDir = options.globalConfigDir ?? resolveGlobalConfigDir();
  roots.push({ dir: join(globalDir, "agents"), source: "global" });
  return roots;
}

async function scanAgentDirectory(
  dir: string,
  source: AgentMetadata["source"],
  agents: AgentMetadata[],
  errors: AgentLoadError[],
  resolved: Map<string, string>,
  knownToolNames?: Iterable<string>,
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = (await readdir(dir, { withFileTypes: true, encoding: "utf8" })) as Dirent[];
  } catch {
    return;
  }

  const tierSeen = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
    await loadAgent(
      join(dir, entry.name, "AGENT.md"),
      entry.name,
      source,
      agents,
      errors,
      resolved,
      tierSeen,
      knownToolNames,
    );
  }
}

async function loadAgent(
  filePath: string,
  expectedDirName: string,
  source: AgentMetadata["source"],
  agents: AgentMetadata[],
  errors: AgentLoadError[],
  resolved: Map<string, string>,
  tierSeen: Map<string, string>,
  knownToolNames?: Iterable<string>,
): Promise<void> {
  let content: string;
  try {
    const file = Bun.file(filePath);
    if (!(await file.exists())) return;
    content = await file.text();
  } catch (error) {
    errors.push({ filePath, error: `Failed to read: ${error instanceof Error ? error.message : String(error)}` });
    return;
  }

  const result = parseAgentFrontmatter(content, filePath, { knownToolNames });
  if ("error" in result) {
    errors.push({ filePath, error: result.error });
    return;
  }

  const { frontmatter, body } = result;
  if (BUILTIN_AGENT_TYPE_NAMES.includes(frontmatter.name as (typeof BUILTIN_AGENT_TYPE_NAMES)[number])) {
    errors.push({ filePath, error: `${filePath}: agent name collides with built-in agent: ${frontmatter.name}` });
    return;
  }

  const nameError = validateAgentName(frontmatter.name, expectedDirName);
  if (nameError) {
    errors.push({ filePath, error: nameError });
    return;
  }

  const sameTier = tierSeen.get(frontmatter.name);
  if (sameTier) {
    errors.push({
      filePath,
      error: `Agent "${frontmatter.name}" already loaded from ${sameTier} at the same precedence tier`,
    });
    return;
  }
  tierSeen.set(frontmatter.name, filePath);

  if (resolved.has(frontmatter.name)) {
    return;
  }
  resolved.set(frontmatter.name, filePath);

  agents.push({
    name: frontmatter.name,
    description: frontmatter.description,
    filePath,
    content: body,
    tools: frontmatter.tools,
    defaultModelClass: frontmatter.model_class,
    source,
  });
}
