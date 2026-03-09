// @summary Content search via ripgrep with regex support
import { isAbsolute, resolve } from "node:path";
import type { ToolRenderPayload } from "@diligent/protocol";
import { z } from "zod";
import type { Tool, ToolResult } from "../tool/types";

const GrepParams = z.object({
  pattern: z.string().describe("Regex pattern to search for in file contents"),
  path: z
    .string()
    .optional()
    .describe("File or directory path to search in. Defaults to the current working directory"),
  include: z.string().optional().describe("Glob pattern to filter files (e.g., '*.ts')"),
  ignore_case: z.boolean().optional().describe("Case-insensitive search. Default: false"),
  context: z.number().int().min(0).optional().describe("Lines of context before and after each match"),
});

const MAX_MATCHES = 100;
const MAX_LINE_LENGTH = 2000;

export function createGrepTool(cwd: string): Tool<typeof GrepParams> {
  return {
    name: "grep",
    description:
      "Search file contents using regex. Returns matching lines with file paths and line numbers. " +
      "Use spawn_agent with agent_type='explore' for open-ended searches requiring multiple rounds.",
    parameters: GrepParams,
    supportParallel: true,
    async execute(args): Promise<ToolResult> {
      const rawPath = args.path ? (isAbsolute(args.path) ? args.path : resolve(cwd, args.path)) : cwd;
      const searchPath = rawPath.replace(/\\/g, "/");

      const rgArgs: string[] = ["rg", "-n"];

      if (args.ignore_case) rgArgs.push("--ignore-case");
      if (args.include) rgArgs.push("--glob", args.include);
      if (args.context !== undefined) rgArgs.push("-C", String(args.context));

      rgArgs.push(args.pattern, searchPath);

      try {
        const proc = Bun.spawn(rgArgs, { stdout: "pipe", stderr: "pipe" });

        const stdout = await new Response(proc.stdout).text();
        await new Response(proc.stderr).text(); // drain stderr to avoid pipe stall
        await proc.exited;

        if (proc.exitCode !== 0 && !stdout.trim()) {
          return { output: "No matches found." };
        }

        // Parse and limit output
        const lines = stdout.trim().split("\n");
        const limited = lines.slice(0, MAX_MATCHES);
        const overflow = lines.length - MAX_MATCHES;

        // Truncate individual lines
        const truncated = limited.map((line) =>
          line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}...` : line,
        );

        let output = truncated.join("\n");
        if (overflow > 0) {
          output += `\n\n... (${overflow} more matches not shown)`;
        }

        // Build structured render when no context lines requested (clean file:line:content format)
        let render: ToolRenderPayload | undefined;
        if (args.context === undefined) {
          // rg -n output: "path/to/file.ts:42:matching content"
          // File paths may contain colons, so split only on the first two colons
          const rows: string[][] = [];
          for (const line of truncated) {
            const m = line.match(/^(.+?):(\d+):(.*)$/);
            if (m) rows.push([m[1], m[2], m[3].length > MAX_LINE_LENGTH ? `${m[3].slice(0, MAX_LINE_LENGTH)}…` : m[3]]);
          }
          if (rows.length > 0) {
            render = {
              version: 1,
              blocks: [
                {
                  type: "table",
                  title: `Matches for ${args.pattern}${args.include ? ` (${args.include})` : ""}`,
                  columns: ["File", "Line", "Match"],
                  rows,
                },
                ...(overflow > 0
                  ? [{ type: "summary" as const, text: `${overflow} more matches not shown`, tone: "info" as const }]
                  : []),
              ],
            };
          }
        }

        return { output, render, truncateDirection: "head" };
      } catch (err) {
        return {
          output: `Error running grep: ${err instanceof Error ? err.message : String(err)}`,
          metadata: { error: true },
        };
      }
    },
  };
}
