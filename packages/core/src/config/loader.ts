// @summary Loads and merges DiligentConfig from global, project, and environment layers
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import { DEFAULT_CONFIG, type DiligentConfig, DiligentConfigSchema } from "./schema";

/** Load and merge config from all sources (D033: global < project < env) */
export async function loadDiligentConfig(cwd: string): Promise<{ config: DiligentConfig; sources: string[] }> {
  const sources: string[] = [];

  // Layer 1: Global config
  const home = process.env.HOME ?? process.env.USERPROFILE ?? homedir();
  const globalPath = join(home, ".config", "diligent", "diligent.jsonc");
  const globalConfig = await loadConfigFile(globalPath);
  if (globalConfig) sources.push(globalPath);

  // Layer 2: Project config (inside .diligent/ alongside sessions, knowledge, skills)
  const projectPath = join(cwd, ".diligent", "diligent.jsonc");
  const projectConfig = await loadConfigFile(projectPath);
  if (projectConfig) sources.push(projectPath);

  // Merge: global < project < env
  let merged: DiligentConfig = { ...DEFAULT_CONFIG };
  if (globalConfig) merged = mergeConfig(merged, globalConfig);
  if (projectConfig) merged = mergeConfig(merged, projectConfig);

  return { config: merged, sources };
}

/** Parse JSONC file, validate with Zod */
async function loadConfigFile(path: string): Promise<DiligentConfig | null> {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    const text = await file.text();
    const parsed = parseJsonc(text);
    const substituted = substituteTemplates(parsed);
    const result = DiligentConfigSchema.safeParse(substituted);
    if (!result.success) {
      console.warn(`Config warning: ${path}\n${result.error.message}`);
      return null;
    }
    return result.data;
  } catch {
    return null;
  }
}

/** Deep merge with array concatenation for 'instructions' (D034) */
export function mergeConfig(base: DiligentConfig, override: DiligentConfig): DiligentConfig {
  const merged = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    if (key === "instructions" && Array.isArray(value)) {
      const baseInstructions = (base as Record<string, unknown>).instructions as string[] | undefined;
      (merged as Record<string, unknown>).instructions = [...new Set([...(baseInstructions ?? []), ...value])];
    } else if (typeof value === "object" && !Array.isArray(value) && value !== null) {
      (merged as Record<string, unknown>)[key] = {
        ...((base as Record<string, unknown>)[key] as Record<string, unknown> | undefined),
        ...value,
      };
    } else {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

/** Template substitution: {env:VAR_NAME} → process.env[VAR_NAME] */
function substituteTemplates(obj: unknown): unknown {
  if (typeof obj === "string") {
    return obj.replace(/\{env:([^}]+)\}/g, (_, varName) => process.env[varName] ?? "");
  }
  if (Array.isArray(obj)) return obj.map((item) => substituteTemplates(item));
  if (typeof obj === "object" && obj !== null) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = substituteTemplates(v);
    }
    return result;
  }
  return obj;
}
