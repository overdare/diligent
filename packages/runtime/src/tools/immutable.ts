// @summary Defines the set of tools that cannot be disabled by user config

/** Tools that cannot be disabled by user config. */
export const IMMUTABLE_TOOLS = new Set(["request_user_input", "plan", "skill"]);

export function isImmutableTool(name: string): boolean {
  return IMMUTABLE_TOOLS.has(name);
}
