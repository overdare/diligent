// @summary Find files by glob pattern via ripgrep (or an in-process fallback when rg is unavailable)

import { stat } from "node:fs/promises";
import type { Tool, ToolResult } from "@diligent/core/tool-contract";
import { z } from "zod";
import { isAbsolute, stripExtendedLengthPrefix } from "../util/path";
import { spawnCollect } from "../util/process";
import { type RgBinaryResolver, resolveRgBinary } from "../util/ripgrep";
import { globFilesFallback } from "../util/search-fallback";
import { createGlobRenderPayload, createTextRenderPayload } from "./render-payload";
import { createSearchScopeErrorResult } from "./search-status";

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

export interface GlobToolOptions {
  /** Overrides ripgrep resolution; returning `null` selects the in-process fallback. */
  resolveRgBinary?: RgBinaryResolver;
}

export function createGlobTool(cwd: string, options: GlobToolOptions = {}): Tool<typeof GlobParams> {
  const resolveRg = options.resolveRgBinary ?? resolveRgBinary;
  return {
    name: "glob",
    description:
      "Find files matching a glob pattern. The optional path must be absolute (relative paths like '.' are rejected). Returns file paths sorted by modification time (newest first). " +
      "For a multi-round file-location lookup across naming variants, use spawn_agent with agent_type='explore'; do not use it for review, audit, or open-ended analysis.",
    parameters: GlobParams,
    supportParallel: true,
    async execute(args, ctx): Promise<ToolResult> {
      const searchPath = stripExtendedLengthPrefix(args.path ?? cwd)
        .replace(/\\/g, "/")
        .replace(/\/{2,}/g, "/");
      if (!isAbsolute(searchPath)) {
        const output = `Error: path must be absolute: ${searchPath}`;
        return createSearchScopeErrorResult(output, {
          kind: "invalid_scope",
          code: "relative_path",
          path: args.path ?? searchPath,
          retryable: false,
          actionable: true,
        });
      }

      if (isFilesystemRoot(searchPath)) {
        const output = `Error: refusing to glob the filesystem root: ${searchPath}. Provide a narrower absolute directory.`;
        return createSearchScopeErrorResult(output, {
          kind: "invalid_scope",
          code: "filesystem_root",
          path: searchPath,
          retryable: false,
          actionable: true,
        });
      }

      if (isAbsoluteFilesystemPattern(args.pattern)) {
        const relativeSuggestion = buildRelativePatternSuggestion(args.pattern, searchPath);
        const output =
          `Error: glob pattern must be relative to the search path, not an absolute filesystem path: ${args.pattern}\n` +
          `Use a relative pattern like "${relativeSuggestion}" or pass the absolute directory via the path parameter.`;
        return createSearchScopeErrorResult(output, {
          kind: "invalid_scope",
          code: "absolute_pattern",
          pattern: args.pattern,
          path: searchPath,
          suggestion: relativeSuggestion,
          retryable: false,
          actionable: true,
        });
      }

      try {
        const rgBin = resolveRg();
        let stdout: string;
        let exitCode: number;
        let fallbackTruncated = false;
        if (rgBin) {
          const command = [rgBin, "--files", "--no-ignore", "--hidden", "--glob", args.pattern, searchPath];
          [stdout, , exitCode] = await spawnCollect(command, { signal: ctx.signal });
        } else {
          const fallback = await globFilesFallback(searchPath, args.pattern, { signal: ctx.signal });
          stdout = fallback.stdout;
          exitCode = stdout ? 0 : 1;
          fallbackTruncated = fallback.truncated;
        }

        if (exitCode !== 0 && !stdout.trim()) {
          const output = "No files found matching pattern.";
          return {
            output,
            render: createGlobRenderPayload({ ...args, path: searchPath }, "", { cwd }),
          };
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
        if (fallbackTruncated) {
          output +=
            "\n\n... (search stopped early: in-process fallback scan limit reached; narrow the path or pattern)";
        }

        return {
          output,
          render: createGlobRenderPayload({ ...args, path: searchPath }, output, { cwd }),
        };
      } catch (err) {
        const output = `Error running glob: ${err instanceof Error ? err.message : String(err)}`;
        return {
          output,
          render: createTextRenderPayload(undefined, output, true),
          metadata: { error: true },
        };
      }
    },
  };
}

function isFilesystemRoot(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  return normalized === "/" || /^[a-zA-Z]:\/$/.test(normalized);
}

function isAbsoluteFilesystemPattern(pattern: string): boolean {
  const normalized = stripExtendedLengthPrefix(pattern).replace(/\\/g, "/");
  const literalPrefix = normalized.slice(0, findFirstGlobMetaIndex(normalized));
  if (!isAbsolute(literalPrefix)) return false;
  if (/^[a-zA-Z]:\/$/.test(literalPrefix)) return true;
  return !isFilesystemRoot(literalPrefix);
}

function findFirstGlobMetaIndex(pattern: string): number {
  const match = /[*?[{]/.exec(pattern);
  return match?.index ?? pattern.length;
}

function buildRelativePatternSuggestion(pattern: string, searchPath: string): string {
  const normalizedPattern = stripExtendedLengthPrefix(pattern).replace(/\\/g, "/");
  const normalizedSearchPath = stripExtendedLengthPrefix(searchPath).replace(/\\/g, "/").replace(/\/+$/, "");
  if (normalizedPattern === normalizedSearchPath) return "**/*";
  const prefix = `${normalizedSearchPath}/`;
  if (normalizedPattern.startsWith(prefix)) return normalizedPattern.slice(prefix.length) || "**/*";
  return "**/*";
}
