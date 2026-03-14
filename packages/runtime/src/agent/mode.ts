// @summary Diligent collaboration mode definitions: ModeKind, tool allow-list, prompt suffixes
import executePrompt from "./default/execute.md" with { type: "text" };
import planPrompt from "./default/plan.md" with { type: "text" };

// D087: Collaboration modes
export type ModeKind = "default" | "plan" | "execute";

/**
 * Tools available in plan mode (read-only exploration only).
 * Bash, write, apply_patch, add_knowledge are excluded.
 * D088: request_user_input is allowed in all modes.
 */
export const PLAN_MODE_ALLOWED_TOOLS = new Set(["read", "glob", "grep", "ls", "request_user_input", "skill"]);

/**
 * System prompt suffixes injected per mode.
 * Empty string for "default" — no suffix added, current behavior preserved.
 */
export const MODE_SYSTEM_PROMPT_SUFFIXES: Record<ModeKind, string> = {
  default: "",
  plan: planPrompt,
  execute: executePrompt,
};
