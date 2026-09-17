// @summary Validates release skill inventory before packaging product assets.
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "../packages/runtime/src/skills/frontmatter";
import { bootstrapSkillManifestSchema } from "../packages/runtime/src/skills/revocation";

function validateTree(path: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error(`Bootstrap skill symlink: ${path}`);
  if (stat.isDirectory()) for (const child of readdirSync(path)) validateTree(join(path, child));
  else if (!stat.isFile()) throw new Error(`Bootstrap skill special file: ${path}`);
}

export function validateBootstrapSkills(bootstrapDir: string) {
  const manifest = bootstrapSkillManifestSchema.parse(
    JSON.parse(readFileSync(join(bootstrapDir, "skills-manifest.json"), "utf8")),
  );
  const names = new Set<string>();
  const paths = new Set<string>();
  for (const entry of [...manifest.skills, ...manifest.revoked]) {
    if (names.has(entry.name) || paths.has(entry.entry))
      throw new Error(`Duplicate active/revoked skill: ${entry.name}`);
    names.add(entry.name);
    paths.add(entry.entry);
  }
  const skillsDir = join(bootstrapDir, "skills");
  validateTree(skillsDir);
  for (const entry of manifest.skills) {
    const path = join(skillsDir, entry.entry, "SKILL.md");
    const parsed = parseFrontmatter(readFileSync(path, "utf8"), path);
    if ("error" in parsed || parsed.frontmatter.name !== entry.name)
      throw new Error(`Missing or mismatched skill: ${entry.name}`);
  }
  for (const item of readdirSync(skillsDir)) {
    const path = join(skillsDir, item, "SKILL.md");
    if (existsSync(path) && !paths.has(item)) throw new Error(`Bootstrap contains unlisted skill: ${item}`);
  }
  return manifest;
}
