// @summary Utility to find .diligent directory by walking up from cwd
import { existsSync } from "fs";
import { dirname, join } from "path";

/**
 * Find the .diligent/ directory by walking up from cwd.
 */
export function findDiligentDir(options: { cwd?: string } = {}): string | null {
  let dir = options.cwd ?? process.cwd();
  while (true) {
    const candidate = join(dir, ".diligent");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}
