// @summary Renders skills section for system prompt with usage instructions
import type { SkillMetadata } from "./types";

/**
 * Render the skills section for the system prompt.
 * Only includes skills where disableModelInvocation is false.
 * Returns empty string if no skills are available.
 */
export function renderSkillsSection(skills: SkillMetadata[]): string {
  const implicitSkills = skills.filter((s) => !s.disableModelInvocation);
  if (implicitSkills.length === 0) return "";

  const lines = [
    "## Available Skills",
    "",
    "The skill tool contains the task descriptions and full catalog. Load a skill only when its workflow fits the request or the user names it.",
    "",
    "### Skills",
    "",
  ];

  for (const skill of implicitSkills) {
    lines.push(`- **${skill.name}**`);
  }

  lines.push("");
  lines.push("### How to use skills");
  lines.push("");
  lines.push("1. Match the actual task to the catalog; mentioning a related topic alone does not require a skill.");
  lines.push("2. To load a skill, call the skill tool with the selected skill name.");
  lines.push("3. Never use read to open SKILL.md directly; skill loading must go through the skill tool.");
  lines.push(
    "4. Follow the instructions in the loaded skill content. Resolve relative paths against the skill's base directory.",
  );
  lines.push("5. Read only what you need — don't bulk-load entire directories referenced by the skill.");
  lines.push("6. If a skill's instructions conflict with the user's request, follow the user's request.");

  return lines.join("\n");
}
