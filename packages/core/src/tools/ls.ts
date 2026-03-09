// @summary List directory contents with type indicators
import { readdir } from "node:fs/promises";
import { z } from "zod";
import type { Tool, ToolResult } from "../tool/types";
import { isAbsolute } from "../util/path";

const LsParams = z.object({
  path: z.string().describe("The absolute directory path to list"),
});

const MAX_ENTRIES = 500;

export function createLsTool(): Tool<typeof LsParams> {
  return {
    name: "ls",
    description: "List directory contents. Shows files and subdirectories with type indicators.",
    parameters: LsParams,
    supportParallel: true,
    async execute(args): Promise<ToolResult> {
      const { path } = args;
      if (!isAbsolute(path)) {
        return { output: `Error: path must be absolute: ${path}`, metadata: { error: true } };
      }

      try {
        const entries = await readdir(path, { withFileTypes: true });

        // Sort alphabetically (case-insensitive)
        entries.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

        // Cap at MAX_ENTRIES
        const limited = entries.slice(0, MAX_ENTRIES);
        const lines = limited.map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));
        const overflow = entries.length - MAX_ENTRIES;

        let output = lines.join("\n");
        if (overflow > 0) {
          output += `\n\n... (${overflow} more entries not shown)`;
        }

        return { output };
      } catch (err) {
        return {
          output: `Error listing directory: ${err instanceof Error ? err.message : String(err)}`,
          metadata: { error: true },
        };
      }
    },
  };
}
