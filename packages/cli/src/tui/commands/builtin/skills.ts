// @summary Skills command - displays available skills and their documentation
import type { SkillMetadata } from "@diligent/core";
import { ListPicker, type ListPickerItem } from "../../components/list-picker";
import { t } from "../../theme";
import type { Command } from "../types";

/**
 * /name — Invoke a skill by name.
 */
export function createSkillInvokeCommand(skillName: string, skill: SkillMetadata): Command {
  return {
    name: skillName,
    description: skill.description,
    hidden: true,
    handler: async (args, ctx) => {
      ctx.displayLines([`  ${t.dim}Requesting skill tool: ${skill.name}${t.reset}`]);
      const message = [
        `The user invoked /${skill.name}.`,
        `Before any other action, call the "skill" tool with {"name":"${skill.name}"}.`,
        args
          ? `After loading the skill, continue with this additional user instruction:\n${args}`
          : "After loading the skill, continue with the user's request.",
      ].join("\n\n");
      await ctx.runAgent(message);
    },
  };
}

/**
 * /skills — Show skills picker overlay.
 */
export const skillsPickerCommand: Command = {
  name: "skills",
  description: "Browse and invoke skills",
  handler: async (_args, ctx) => {
    if (ctx.skills.length === 0) {
      ctx.displayLines([
        `  ${t.dim}No skills found.${t.reset}`,
        "  Add skills to .diligent/skills/ or ~/.config/diligent/skills/",
      ]);
      return;
    }

    const items: ListPickerItem[] = ctx.skills.map((s) => ({
      label: s.name,
      description: s.description,
      value: s.name,
    }));

    return new Promise<void>((resolve) => {
      const picker = new ListPicker({ title: "Skills", items }, async (value) => {
        handle.hide();
        ctx.requestRender();
        if (value) {
          const skill = ctx.skills.find((s) => s.name === value);
          if (skill) {
            const cmd = createSkillInvokeCommand(skill.name, skill);
            await cmd.handler(undefined, ctx);
          }
        }
        resolve();
      });
      const handle = ctx.showOverlay(picker, { anchor: "center" });
      ctx.requestRender();
    });
  },
};
