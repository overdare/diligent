// @summary Find files by glob pattern via ripgrep

import { stat } from "node:fs/promises";
import type { Tool, ToolResult } from "@diligent/core/tool/types";
import { z } from "zod";
import { isAbsolute } from "../util/path";
import { spawnCollect } from "../util/process";

const GlobParams = z.object({
  pattern: z.string().describe("Glob pattern to match files (e.g., '**/*.ts', 'src/**/*.test.ts')"),
  path: z
    .string()
    .optional()
    .describe(
      "Absolute directory to search in (relative paths like '.' are not allowed). Default: current working directory",
    ),
});

const MAX_FILES = 100;

export function createGlobTool(cwd: string): Tool<typeof GlobParams> {
  return {
    name: "glob",
    description:
      "Find files matching a glob pattern. The optional path must be absolute (relative paths like '.' are rejected). Returns file paths sorted by modification time (newest first). " +
      "When you are doing an open-ended search that may require multiple rounds of globbing and grepping, use spawn_agent with agent_type='explore' instead.",
    parameters: GlobParams,
    supportParallel: true,
    async execute(args): Promise<ToolResult> {
      const searchPath = (args.path ?? cwd).replace(/\\/g, "/").replace(/\/{2,}/g, "/");
      if (!isAbsolute(searchPath)) {
        return { output: `Error: path must be absolute: ${searchPath}`, metadata: { error: true } };
      }

      try {
        const rgBin = process.env.DILIGENT_RG_PATH ?? "rg";
        const [stdout, , exitCode] = await spawnCollect([rgBin, "--files", "--glob", args.pattern, searchPath]);

        if (exitCode !== 0 && !stdout.trim()) {
          return { output: "No files found matching pattern." };
        }

        const files = stdout.trim().split("\n").filter(Boolean);

        // Stat each file for mtime, sort descending (newest first)
        const withMtime = await Promise.all(
          files.map(async (f) => {
            try {
              const s = await stat(f);
              return { path: f, mtime: s.mtimeMs };
            } catch {
              return { path: f, mtime: 0 };
            }
          }),
        );

        withMtime.sort((a, b) => b.mtime - a.mtime);

        const limited = withMtime.slice(0, MAX_FILES);
        const paths = limited.map((f) => f.path);
        const overflow = withMtime.length - MAX_FILES;

        let output = paths.join("\n");
        if (overflow > 0) {
          output += `\n\n... (${overflow} more files not shown)`;
        }

        return { output };
      } catch (err) {
        return {
          output: `Error running glob: ${err instanceof Error ? err.message : String(err)}`,
          metadata: { error: true },
        };
      }
    },
  };
}
