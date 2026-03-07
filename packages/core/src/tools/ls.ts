// @summary List directory contents with type indicators
import { readdir } from "node:fs/promises";
import type { ToolRenderPayload } from "@diligent/protocol";
import { z } from "zod";
import type { Tool, ToolResult } from "../tool/types";

const LsParams = z.object({
  path: z.string().describe("The directory path to list"),
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

        const render: ToolRenderPayload = {
          version: 1,
          blocks: [
            {
              type: "list",
              title: path,
              items: lines,
            },
            ...(overflow > 0
              ? [{ type: "summary" as const, text: `${overflow} more entries not shown`, tone: "info" as const }]
              : []),
          ],
        };

        return { output, render };
      } catch (err) {
        return {
          output: `Error listing directory: ${err instanceof Error ? err.message : String(err)}`,
          metadata: { error: true },
        };
      }
    },
  };
}
