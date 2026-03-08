// @summary Write file contents with directory auto-creation
import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { z } from "zod";
import type { Tool, ToolResult } from "../tool/types";

const WriteParams = z.object({
  file_path: z.string().describe("The relative path to the file to write"),
  content: z.string().describe("The full content to write to the file"),
});

export function createWriteTool(cwd: string): Tool<typeof WriteParams> {
  return {
    name: "write",
    description:
      "Write content to a file. Creates the file and parent directories if they don't exist. Overwrites existing content.",
    parameters: WriteParams,
    async execute(args, ctx): Promise<ToolResult> {
      const { file_path, content } = args;
      if (isAbsolute(file_path)) {
        return { output: `Error: file_path must be relative: ${file_path}`, metadata: { error: true } };
      }
      const targetPath = resolve(cwd, file_path);

      const approval = await ctx.approve({
        permission: "write",
        toolName: "write",
        description: `Write to ${targetPath}`,
        details: { file_path: targetPath },
      });
      if (approval === "reject") {
        return { output: "[Rejected by user]", metadata: { error: true }, abortRequested: true };
      }

      try {
        // 1. Create parent directories recursively
        await mkdir(dirname(targetPath), { recursive: true });

        // 2. Write content to file
        await Bun.write(targetPath, content);

        // 3. Return summary
        const bytes = new TextEncoder().encode(content).length;
        return { output: `Wrote ${bytes} bytes to ${targetPath}` };
      } catch (err) {
        return {
          output: `Error writing file: ${err instanceof Error ? err.message : String(err)}`,
          metadata: { error: true },
        };
      }
    },
  };
}
