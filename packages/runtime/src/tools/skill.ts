// @summary Skill tool that loads SKILL.md content into conversation context without exposing file-read tool calls

import type { Tool, ToolRegistryBuilder, ToolResult } from "@diligent/core/tool-contract";
import { z } from "zod";
import { extractBody, type SkillLoadError, type SkillMetadata } from "../skills";
import { assertSkillNotRevoked } from "../skills/revocation";

const MAX_CATALOG_DESCRIPTION_CHARS = 1024;
const TRUNCATED_DESCRIPTION_SUFFIX = "...";

const SkillParams = z.object({
  name: z.string().describe("Skill name from the available skills list"),
});

export interface SkillCatalog {
  skills: SkillMetadata[];
  errors?: SkillLoadError[];
  /** Rediscovers skills from disk; called when a requested name is not in the current catalog. */
  reload?: () => Promise<{ skills: SkillMetadata[]; errors: SkillLoadError[] }>;
}

function catalogDescription(description: string): string {
  const chars = Array.from(description);
  if (chars.length <= MAX_CATALOG_DESCRIPTION_CHARS) return description;
  return (
    chars.slice(0, MAX_CATALOG_DESCRIPTION_CHARS - TRUNCATED_DESCRIPTION_SUFFIX.length).join("") +
    TRUNCATED_DESCRIPTION_SUFFIX
  );
}

export function createSkillTool(catalog: SkillCatalog): Tool<typeof SkillParams> {
  const { skills, errors = [], reload } = catalog;
  let availableSkills = skills.filter((skill) => !skill.disableModelInvocation);
  let loadErrors = errors;

  let description: string;
  if (availableSkills.length === 0) {
    description = "Load a specialized skill. No skills are currently available.";
  } else {
    description = [
      "Load a specialized skill with domain-specific instructions and workflow.",
      "Use this tool when the user request matches one of these skills:",
      ...availableSkills.map((skill) => `- ${skill.name}: ${catalogDescription(skill.description)}`),
    ].join("\n");
  }

  return {
    name: "skill",
    description,
    parameters: SkillParams,
    supportParallel: true,
    async execute(args): Promise<ToolResult> {
      let selected = availableSkills.find((skill) => skill.name === args.name);
      if (!selected && reload) {
        const fresh = await reload();
        availableSkills = fresh.skills.filter((skill) => !skill.disableModelInvocation);
        loadErrors = fresh.errors;
        selected = availableSkills.find((skill) => skill.name === args.name);
      }
      if (!selected) {
        const list = availableSkills.map((skill) => skill.name).join(", ");
        const lines = [`Skill "${args.name}" not found. Available skills: ${list || "none"}`];
        if (loadErrors.length > 0) {
          lines.push("", "These skill files were found but could not be loaded:");
          lines.push(...loadErrors.map((error) => `- ${error.message}`));
        }
        return { output: lines.join("\n"), metadata: { error: true } };
      }

      let content: string;
      try {
        await assertSkillNotRevoked(selected.name, selected.revocationStatePath);
        content = await Bun.file(selected.path).text();
      } catch (error) {
        return {
          output: `Failed to load skill "${selected.name}" from ${selected.path}: ${error instanceof Error ? error.message : String(error)}`,
          metadata: { error: true },
        };
      }

      const body = extractBody(content).trim();
      if (!body) {
        return {
          output: `Skill "${selected.name}" has empty content.`,
          metadata: { error: true },
        };
      }

      return {
        output: [
          `<skill_content name="${selected.name}">`,
          `# Skill: ${selected.name}`,
          "",
          body,
          "",
          `Base directory: ${selected.baseDir}`,
          "Resolve relative paths in this skill against the base directory.",
          "</skill_content>",
        ].join("\n"),
      };
    },
  };
}

export function registerSkillTool(builder: ToolRegistryBuilder, catalog: SkillCatalog): ToolRegistryBuilder {
  return builder.register(createSkillTool(catalog));
}
