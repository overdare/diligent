// @summary Example custom tool plugin package that exposes one safe read-only project summary tool
import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ToolRenderPayload } from "@diligent/protocol";
import { z } from "zod";

export const manifest = {
  name: "example-tool-plugin",
  apiVersion: "1.0",
  version: "0.1.0",
};

const ExampleProjectSnapshotParams = z.object({
  include_hidden: z.boolean().default(false).describe("Whether to include dotfiles in the top-level entry sample."),
  max_entries: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(8)
    .describe("Maximum number of top-level entries to include in the summary."),
});

export async function createTools(ctx: { cwd: string }) {
  return [
    {
      name: "example_project_snapshot",
      description: "Return a small read-only summary of the current project root from a custom plugin.",
      parameters: ExampleProjectSnapshotParams,
      supportParallel: true,
      async execute(args: z.infer<typeof ExampleProjectSnapshotParams>) {
        try {
          const entries = await readdir(ctx.cwd, { withFileTypes: true });
          const visibleEntries = entries.filter((entry) => args.include_hidden || !entry.name.startsWith("."));
          const sampledEntries = visibleEntries.slice(0, args.max_entries);
          const packageJsonExists = await Bun.file(join(ctx.cwd, "package.json")).exists();
          const diligentConfigExists = await Bun.file(join(ctx.cwd, ".diligent", "diligent.jsonc")).exists();

          const formattedEntries = await Promise.all(
            sampledEntries.map(async (entry) => {
              const fullPath = join(ctx.cwd, entry.name);
              if (entry.isDirectory()) return `${entry.name}/`;
              if (entry.isFile()) return `${entry.name} (${(await stat(fullPath)).size} bytes)`;
              return entry.name;
            }),
          );

          const render: ToolRenderPayload = {
            version: 1,
            blocks: [
              {
                type: "key_value",
                title: "Project",
                items: [
                  { key: "name", value: basename(ctx.cwd) || ctx.cwd },
                  { key: "plugin", value: manifest.name },
                  { key: "package.json", value: packageJsonExists ? "present" : "missing" },
                  { key: ".diligent/diligent.jsonc", value: diligentConfigExists ? "present" : "missing" },
                ],
              },
              {
                type: "list",
                title: `Top-level entries (${formattedEntries.length}/${visibleEntries.length})`,
                items: formattedEntries,
              },
            ],
          };

          return {
            output: [
              "Plugin example loaded successfully.",
              `plugin: ${manifest.name}`,
              "tool: example_project_snapshot",
              `cwd: ${ctx.cwd}`,
              `project: ${basename(ctx.cwd) || ctx.cwd}`,
              `package.json: ${packageJsonExists ? "present" : "missing"}`,
              `.diligent/diligent.jsonc: ${diligentConfigExists ? "present" : "missing"}`,
              `top-level entries shown (${formattedEntries.length}/${visibleEntries.length}):`,
              ...formattedEntries.map((entry) => `- ${entry}`),
            ].join("\n"),
            render,
          };
        } catch (error) {
          return {
            output: `Error building project snapshot: ${error instanceof Error ? error.message : String(error)}`,
            metadata: { error: true },
          };
        }
      },
    },
  ];
}
