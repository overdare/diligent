import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_STORAGE_NAMESPACE = "diligent";
const PACKAGED_STORAGE_NAMESPACE = "overdare";

const DEFAULT_STUDIO_HOST = "localhost";
const DEFAULT_STUDIO_PORT = 13377;

export interface OverdareConfig {
  host?: string;
  port?: number;
}

/** Removes JSONC comments while leaving string contents such as `http://` URLs intact. */
function stripJsonComments(text: string): string {
  return text.replace(/("(?:[^"\\\n]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_match, string?: string) => string ?? "");
}

let cached: OverdareConfig | undefined;

function storageNamespace(): string {
  const value = process.env.DILIGENT_STORAGE_NAMESPACE?.trim();
  return value || PACKAGED_STORAGE_NAMESPACE;
}

function resolveHomeDir(): string {
  return process.env.USERPROFILE ?? process.env.HOME ?? homedir();
}

function configCandidates(): string[] {
  const home = resolveHomeDir();
  const currentPath = join(home, `.${storageNamespace()}`, "overdare.jsonc");
  const legacyPath = join(home, `.${DEFAULT_STORAGE_NAMESPACE}`, "overdare.jsonc");
  return currentPath === legacyPath ? [currentPath] : [currentPath, legacyPath];
}

export interface OverdareConfigFile {
  path: string;
  /** Parsed JSONC value; absent when the file could not be read or parsed. */
  value?: unknown;
  error?: string;
}

/**
 * Reads the first existing overdare.jsonc without caching, so edits apply without a restart.
 * Returns undefined when no candidate exists.
 */
export function readOverdareConfigFile(): OverdareConfigFile | undefined {
  for (const configPath of configCandidates()) {
    if (!existsSync(configPath)) continue;
    try {
      return { path: configPath, value: JSON.parse(stripJsonComments(readFileSync(configPath, "utf-8"))) };
    } catch (error) {
      return { path: configPath, error: error instanceof Error ? error.message : String(error) };
    }
  }
  return undefined;
}

export function loadOverdareConfig(): OverdareConfig {
  if (cached) return cached;
  const file = readOverdareConfigFile();
  cached = file?.value && typeof file.value === "object" ? (file.value as OverdareConfig) : {};
  return cached;
}

/**
 * Resolve the Studio RPC host.
 * Priority: STUDIO_HOST env var > config file > DEFAULT_STUDIO_HOST.
 */
export function resolveStudioHost(): string {
  if (process.env.STUDIO_HOST) return process.env.STUDIO_HOST;
  return loadOverdareConfig().host ?? DEFAULT_STUDIO_HOST;
}

/**
 * Resolve the Studio RPC port.
 * Priority: STUDIO_PORT env var > config file > DEFAULT_STUDIO_PORT.
 */
export function resolveStudioPort(): number {
  const envPort = process.env.STUDIO_PORT;
  if (envPort) {
    const parsed = Number(envPort);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return loadOverdareConfig().port ?? DEFAULT_STUDIO_PORT;
}
