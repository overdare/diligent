// @summary Verifies discovery and model-facing replacement of legacy UI template skills.
import { expect, test } from "bun:test";
import { access, cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { discoverSkills, renderSkillsSection } from "@diligent/runtime/skills";
import { createSkillTool } from "@diligent/runtime/tools/skill";

test("discovers the mobile UI skill while excluding retired template routes from model invocation", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "mobile-ui-skill-"));
  try {
    const bundled = resolve(import.meta.dir, "../../bootstrap/skills");
    const skillRoot = join(cwd, "skills");
    await mkdir(skillRoot);
    for (const name of ["mobile-ui-design", "ui-generator", "overdare-ui-templates"]) {
      await cp(join(bundled, name), join(skillRoot, name), { recursive: true });
    }
    const { skills, errors } = await discoverSkills({
      cwd,
      globalConfigDir: join(cwd, "global"),
      additionalPaths: [skillRoot],
    });
    expect(errors).toEqual([]);
    const tool = createSkillTool(skills);
    const section = renderSkillsSection(skills);
    expect(tool.description).toContain("mobile-ui-design:");
    expect(section).toContain("mobile-ui-design");
    for (const name of ["ui-generator", "overdare-ui-templates"]) {
      expect(tool.description).not.toContain(`- ${name}:`);
      const result = await tool.execute({ name }, {} as never);
      expect(result.metadata?.error).toBe(true);
    }
    const loaded = await tool.execute({ name: "mobile-ui-design" }, {} as never);
    expect(loaded.metadata?.error).not.toBe(true);
    expect(loaded.output).toContain('<skill_content name="mobile-ui-design">');
    expect(loaded.output).toContain("Base directory:");
    const baseDir = skills.find((skill) => skill.name === "mobile-ui-design")!.baseDir;
    for (const [, path] of loaded.output.matchAll(/\]\(((?:references|assets)\/[^)]+)\)/g)) {
      await access(resolve(baseDir, path));
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
