// @summary Slash command definitions, parser, and filter logic for web UI autocomplete

export interface SlashCommandOption {
  label: string;
  value: string;
  description?: string;
}

export interface SlashCommand {
  name: string;
  description: string;
  /** Sub-options for commands like /mode, /effort */
  options?: SlashCommandOption[];
  /** Whether this is a dynamically registered skill command */
  isSkill?: boolean;
}

export const BUILTIN_COMMANDS: SlashCommand[] = [
  {
    name: "help",
    description: "Show available commands",
  },
  {
    name: "new",
    description: "Start a new conversation",
  },
  {
    name: "mode",
    description: "Set collaboration mode",
    options: [
      { label: "Default", value: "default", description: "Normal conversation" },
      { label: "Plan", value: "plan", description: "Plan before acting" },
      { label: "Execute", value: "execute", description: "Execute without asking" },
    ],
  },
  {
    name: "effort",
    description: "Set thinking effort",
    options: [
      { label: "Low", value: "low" },
      { label: "Medium", value: "medium" },
      { label: "High", value: "high" },
      { label: "Max", value: "max" },
    ],
  },
  {
    name: "model",
    description: "Change the model",
  },
];

/** Build the full command list by merging builtins with dynamic skill commands. */
export function buildCommandList(skills: Array<{ name: string; description: string }>): SlashCommand[] {
  const builtinNames = new Set(BUILTIN_COMMANDS.map((c) => c.name));
  const skillCommands: SlashCommand[] = skills
    .filter((s) => !builtinNames.has(s.name))
    .map((s) => ({
      name: s.name,
      description: s.description,
      isSkill: true,
    }));
  return [...BUILTIN_COMMANDS, ...skillCommands];
}

export interface ParsedSlashCommand {
  name: string;
  args: string | undefined;
}

/** Returns null if not a slash command (doesn't start with / or starts with //) */
export function parseSlashCommand(text: string): ParsedSlashCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx === -1) return { name: trimmed.slice(1), args: undefined };
  return {
    name: trimmed.slice(1, spaceIdx),
    args: trimmed.slice(spaceIdx + 1).trim() || undefined,
  };
}

/** Filter commands by partial name (after the /) */
export function filterCommands(commands: SlashCommand[], partial: string): SlashCommand[] {
  const lower = partial.toLowerCase();
  return commands.filter((cmd) => cmd.name.startsWith(lower));
}

/** Check if input is a slash command prefix (for triggering autocomplete) */
export function isSlashPrefix(text: string): boolean {
  return text.startsWith("/") && !text.startsWith("//") && !text.includes(" ");
}
