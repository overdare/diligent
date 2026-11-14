// @summary Builds base system prompt with environment context and behavioral guidelines
import template from "./default/system-prompt.txt" with { type: "text" };

export interface SystemPromptVars {
  currentDate: string;
  cwd: string;
  platform: string;
}

export function buildBaseSystemPrompt(vars: SystemPromptVars): string {
  return template
    .replace("{{currentDate}}", vars.currentDate)
    .replace("{{cwd}}", vars.cwd)
    .replace("{{platform}}", vars.platform);
}
