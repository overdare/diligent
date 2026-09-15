// @summary Reads launcher-owned global revocations without weakening malformed policy.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { resolveProjectDirName } from "../infrastructure/diligent-dir";

const name = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/);
const entry = z.object({ name, entry: name }).strict();
export const bootstrapSkillManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    skills: z.array(entry),
    revoked: z.array(entry),
  })
  .strict();
const stateSchema = z.object({
  schemaVersion: z.literal(1),
  runtimeVersion: z.string(),
  skills: z.array(entry),
  revoked: z.array(entry),
  pending: z.array(name),
});

export function resolveSkillRevocationStatePath(globalConfigDir?: string): string {
  const global =
    globalConfigDir ?? join(process.env.HOME ?? process.env.USERPROFILE ?? homedir(), resolveProjectDirName());
  return join(global, ".bootstrap-skills-state.json");
}

export async function readRevokedSkillNames(path = resolveSkillRevocationStatePath()): Promise<Set<string>> {
  let json: string;
  try {
    json = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set();
    throw error;
  }
  return new Set(stateSchema.parse(JSON.parse(json)).revoked.map((entry) => entry.name));
}

export async function assertSkillNotRevoked(name: string, statePath?: string): Promise<void> {
  if ((await readRevokedSkillNames(statePath)).has(name))
    throw new Error(`Skill "${name}" has been revoked by the product.`);
}
