// @summary Tests for skill tool loading behavior and error handling
import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ToolRegistryBuilder } from "@diligent/core/tool-contract";
import type { SkillMetadata } from "../../src/skills";
import { createSkillTool, registerSkillTool } from "../../src/tools/skill";

function makeSkill(name: string, path: string, description = `${name} description`): SkillMetadata {
  return {
    name,
    description,
    path,
    baseDir: dirname(path),
    source: "project",
    disableModelInvocation: false,
  };
}

describe("createSkillTool", () => {
  const toolContext = {
    toolCallId: "tc",
    signal: new AbortController().signal,
    abort: () => {},
  };

  it("loads a known skill and returns skill_content envelope", async () => {
    const root = await mkdtemp(join(tmpdir(), "diligent-skill-tool-"));
    const filePath = join(root, "SKILL.md");
    await writeFile(filePath, "---\nname: tidy-plan\ndescription: test\n---\n\n# Tidy Plan\nDo work", "utf8");

    const tool = createSkillTool({ skills: [makeSkill("tidy-plan", filePath)] });
    const result = await tool.execute({ name: "tidy-plan" }, toolContext);

    expect(result.output).toContain('<skill_content name="tidy-plan">');
    expect(result.output).toContain("# Tidy Plan");
    expect(result.output).toContain("Base directory:");

    await rm(root, { recursive: true, force: true });
  });

  it("returns error metadata when skill name is unknown", async () => {
    const tool = createSkillTool({ skills: [] });
    const result = await tool.execute({ name: "missing" }, toolContext);

    expect(result.metadata?.error).toBe(true);
    expect(result.output).toContain('Skill "missing" not found');
  });

  it("rediscovers once for an unknown name and loads a skill installed after the tool was built", async () => {
    const root = await mkdtemp(join(tmpdir(), "diligent-skill-tool-reload-"));
    const filePath = join(root, "SKILL.md");
    await writeFile(filePath, "---\nname: late-skill\ndescription: test\n---\n\n# Late Skill\nSteps", "utf8");
    let reloads = 0;

    const tool = createSkillTool({
      skills: [],
      reload: async () => {
        reloads += 1;
        return { skills: [makeSkill("late-skill", filePath)], errors: [] };
      },
    });
    const loaded = await tool.execute({ name: "late-skill" }, toolContext);
    const again = await tool.execute({ name: "late-skill" }, toolContext);

    expect(loaded.output).toContain("# Late Skill");
    expect(again.output).toContain("# Late Skill");
    expect(reloads).toBe(1);

    await rm(root, { recursive: true, force: true });
  });

  it("reports skill files that failed to load when the name is still unknown", async () => {
    const message = "/project/.diligent/skills/broken/SKILL.md: missing frontmatter (no opening ---)";
    const tool = createSkillTool({
      skills: [],
      reload: async () => ({ skills: [], errors: [{ path: "/project/.diligent/skills/broken/SKILL.md", message }] }),
    });

    const result = await tool.execute({ name: "broken" }, toolContext);

    expect(result.metadata?.error).toBe(true);
    expect(result.output).toContain(message);
  });

  it("truncates long descriptions in the catalog without dropping the skill", () => {
    const description = "가".repeat(1500);
    const tool = createSkillTool({ skills: [makeSkill("long-skill", "/tmp/long-skill/SKILL.md", description)] });

    const entry = tool.description.split("\n").find((line) => line.startsWith("- long-skill: "));
    const shown = entry?.slice("- long-skill: ".length) ?? "";
    expect(Array.from(shown)).toHaveLength(1024);
    expect(shown.endsWith("...")).toBe(true);
    expect(description.startsWith(shown.slice(0, -3))).toBe(true);
  });

  it("returns error metadata when skill content body is empty", async () => {
    const root = await mkdtemp(join(tmpdir(), "diligent-skill-tool-empty-"));
    const filePath = join(root, "SKILL.md");
    await writeFile(filePath, "---\nname: tidy-plan\ndescription: test\n---\n", "utf8");

    const tool = createSkillTool({ skills: [makeSkill("tidy-plan", filePath)] });
    const result = await tool.execute({ name: "tidy-plan" }, toolContext);

    expect(result.metadata?.error).toBe(true);
    expect(result.output).toContain("has empty content");

    await rm(root, { recursive: true, force: true });
  });

  it("registerSkillTool adds the skill tool to a registry builder", () => {
    const builder = new ToolRegistryBuilder();
    registerSkillTool(builder, { skills: [] });
    const registry = builder.build();
    expect(registry.get("skill")).toBeDefined();
  });
});
