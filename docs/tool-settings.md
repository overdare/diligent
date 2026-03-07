# Tool settings

Diligent lets you control which built-in tools are available in a project and add trusted JavaScript plugin packages.

## Where settings are stored

Tool settings are project-local in:

- `.diligent/diligent.jsonc`

Changes are applied on the next turn. Diligent does not hot-swap tool availability in the middle of a running turn.

## Trust model

Plugin packages run with full trust in the same process as Diligent.

That means a plugin can:

- read and write files the Diligent process can access
- run arbitrary JavaScript during package load and tool execution
- access environment variables available to the process
- make network requests if the runtime allows it

Only configure packages you already trust.

## Built-in tools

Built-in tools are enabled by default.

When you disable a built-in tool in settings, Diligent stores only your intent override. For example:

```jsonc
{
  "tools": {
    "builtin": {
      "bash": false
    }
  }
}
```

Some built-ins are immutable and always stay enabled:

- `plan`
- `request_user_input`

These appear as locked in the UI and stay enabled even if config tries to disable them.

## Plugin packages

To add plugin tools:

1. Install the package in the project so the app-server can resolve it.
2. Open tool settings in Web or run `/tools` in TUI.
3. Add the package name.
4. Save.
5. Start the next turn.

Diligent does not install npm packages for you in this phase.

If a package cannot be imported or validated, it remains visible in settings with a load error instead of crashing the server.

## Example config

```jsonc
{
  "tools": {
    "builtin": {
      "bash": false,
      "grep": false
    },
    "plugins": [
      {
        "package": "@acme/diligent-tools",
        "enabled": true,
        "tools": {
          "jira_comment": false
        }
      }
    ],
    "conflictPolicy": "error"
  }
}
```

Normalization rules:

- built-ins store only `false` overrides
- plugin packages stay present when you want them configured
- plugin tools store only `false` overrides
- default `conflictPolicy: "error"` is omitted when possible

## Conflict policy

Supported policies:

- `error`
- `builtin_wins`
- `plugin_wins`

Even with `plugin_wins`, immutable built-ins still win.

## Minimal plugin package contract

A plugin package must be importable by the running server process and export:

```ts
export const manifest = {
  name: "@acme/diligent-tools",
  apiVersion: "1.x",
  version: "0.1.0",
};

export async function createTools(ctx: { cwd: string }) {
  return [
    {
      name: "jira_comment",
      description: "Post a Jira comment",
      parameters: {
        type: "object",
        properties: {
          issueKey: { type: "string" },
          body: { type: "string" },
        },
        required: ["issueKey", "body"],
      },
      async execute(input: { issueKey: string; body: string }) {
        return `Would comment on ${input.issueKey}: ${input.body}`;
      },
    },
  ];
}
```

## Why a plugin may fail to load

Common reasons:

- the package is not installed in the project
- `manifest.name` does not match the configured package name
- `manifest.apiVersion` is incompatible
- `createTools()` throws
- `createTools()` does not return an array
- the plugin returns invalid tools
- the plugin returns duplicate tool names

## Current limitations

This phase does not include:

- plugin sandboxing or permissions
- automatic package installation
- plugin discovery from the filesystem or npm registry
- hot reload for plugin code
- lifecycle hooks around tool execution
