# @summary Example custom plugin package documentation
# example-tool-plugin

This is a minimal external-style example of a custom Diligent tool plugin.

It exports:

- `manifest`
- `createTools(ctx)`

The example tool is `example_project_snapshot`, a safe read-only tool that summarizes the current project root.

## Package contract

```ts
export const manifest = {
  name: "example-tool-plugin",
  apiVersion: "1.0",
  version: "0.1.0",
};

export async function createTools(ctx: { cwd: string }) {
  return [
    {
      name: "example_project_snapshot",
      description: "Return a small read-only summary of the current project root from a custom plugin.",
      parameters: z.object({
        include_hidden: z.boolean().default(false),
        max_entries: z.number().int().min(1).max(20).default(8),
      }),
      async execute(args) {
        return { output: `cwd: ${ctx.cwd}` };
      },
    },
  ];
}
```

## Install into a project that uses the diligent binary

Assume your project already uses a prebuilt `diligent` binary.

Store this plugin in a fixed global folder such as:

- `$HOME/.diligent/plugins/example-tool-plugin`

A prebuilt `diligent` binary can load it directly from that folder without a per-project package install.

## Enable it

Add the package to global config `~/.diligent/config.jsonc` or to `.diligent/config.jsonc` in a project:

```jsonc
{
  "tools": {
    "plugins": [{ "package": "example-tool-plugin", "enabled": true }]
  }
}
```

If you put that entry in `~/.diligent/config.jsonc`, the plugin becomes available across projects by default.

Then start the next turn and ask Diligent to use `example_project_snapshot`.
