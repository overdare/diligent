// @summary Defines the set of tools that cannot be disabled by user config
import { IMMUTABLE_TOOLS } from "./tool-metadata";

export { IMMUTABLE_TOOLS };

/** Tools that cannot be disabled by user config. */
export function isImmutableTool(name: string): boolean {
  return IMMUTABLE_TOOLS.has(name);
}
