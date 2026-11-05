// @summary Shares product skills directly and converts agent metadata for one native Claude launch.

import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { extractBody, parseFrontmatter } from "@diligent/runtime/skills";
import { z } from "zod";

const componentName = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/);
const policySchema = z.object({
  schemaVersion: z.literal(1),
  revoked: z.array(z.object({ name: componentName, entry: componentName })),
});
const agentMetadata = z.object({
  name: componentName,
  description: z.string().min(1).max(1024),
  model_class: z.string().optional(),
  model: z.enum(["haiku", "sonnet", "opus", "inherit"]).optional(),
  tools: z.union([z.string(), z.array(z.string())]).optional(),
});
const nativeTools: Record<string, string> = {
  read: "Read",
  glob: "Glob",
  grep: "Grep",
  write: "Write",
  edit: "Edit",
  bash: "Bash",
};
export interface NativeClaudeAgent {
  description: string;
  prompt: string;
  model: "haiku" | "sonnet" | "opus" | "inherit";
  tools?: string[];
}
async function optionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
async function revoked(root: string, filename: string): Promise<Set<string>> {
  const policy = await optionalFile(join(root, filename));
  if (!policy) return new Set();
  try {
    return new Set(policySchema.parse(JSON.parse(policy)).revoked.map((entry) => entry.name));
  } catch {
    throw new Error(`Cannot read product revocation policy: ${filename}`);
  }
}

export async function prepareClaudePlugin(root: string) {
  // --plugin-dir is session-only. No native profile settings, skill files, agent
  // source files, or project configuration are rewritten.
  const path = resolve(root);
  const manifestDir = join(path, ".claude-plugin");
  const manifestPath = join(manifestDir, "plugin.json");
  const manifest = JSON.stringify({ name: "overdare", description: "OVERDARE Studio skills.", agents: [] });
  if ((await optionalFile(manifestPath)) !== manifest) {
    await mkdir(manifestDir, { recursive: true });
    const temporary = join(manifestDir, `.plugin-${randomUUID()}.json`);
    try {
      await writeFile(temporary, manifest, { mode: 0o600 });
      try {
        await rename(temporary, manifestPath);
      } catch (error) {
        // Windows can refuse replacement when another Studio just published the
        // identical manifest. Its complete file is already the desired result.
        if ((await optionalFile(manifestPath)) !== manifest) throw error;
      }
    } finally {
      await rm(temporary, { force: true });
    }
  }
  const revokedAgents = await revoked(path, ".bootstrap-agents-state.json");
  const revokedSkills = await revoked(path, ".bootstrap-skills-state.json");
  let entries: string[] = [];
  try {
    entries = (await readdir(join(path, "agents"), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const agents: Record<string, NativeClaudeAgent> = {};
  for (const entry of entries.sort()) {
    if (!componentName.safeParse(entry).success) continue;
    const source = join(path, "agents", entry, "AGENT.md");
    const text = await optionalFile(source);
    if (!text || "error" in parseFrontmatter(text, source)) continue;
    const metadataText = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
    if (!metadataText) continue;
    let metadata: unknown;
    try {
      metadata = Bun.YAML.parse(metadataText);
    } catch {
      continue;
    }
    const result = agentMetadata.safeParse(metadata);
    if (!result.success || revokedAgents.has(result.data.name)) continue;
    const agent = result.data;
    const sourceTools =
      typeof agent.tools === "string" ? agent.tools.split(",").map((tool) => tool.trim()) : agent.tools;
    const tools = sourceTools?.map(
      (tool) => nativeTools[tool] ?? (tool.startsWith("studiorpc_") ? `mcp__overdare__${tool}` : undefined),
    );
    // An unsupported restrictive tool list must never become unrestricted access.
    if (tools?.some((tool) => !tool) || tools?.length === 0) continue;
    agents[agent.name] = {
      description: agent.description,
      prompt: extractBody(text),
      model: agent.model ?? (agent.model_class === "lite" ? "haiku" : "inherit"),
      ...(tools ? { tools: tools as string[] } : {}),
    };
  }
  return { path, agents, revokedSkills: [...revokedSkills].sort() };
}
