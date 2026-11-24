# Tool settings

Diligent lets you control which built-in tools are available in a project and add trusted JavaScript plugin packages. Product builds can also ship bundled product tools that are registered by the packaged runtime itself.

## Where settings are stored

Tool settings are project-local in:

- `.diligent/config.jsonc`

Changes are applied on the next turn. Diligent does not hot-swap tool availability in the middle of a running turn.

## Trust model

Plugin packages run with full trust in the same process as Diligent.

That means a plugin can:

- read and write files the Diligent process can access
- run arbitrary JavaScript during package load and tool execution
- access environment variables available to the process
- make network requests if the runtime allows it

Only configure packages you already trust.

Bundled product tools run with the same trust level as the packaged runtime. They are not loaded from your project or home plugin folder, but their individual tools still appear in the tool catalog and use the same approval, rendering, and per-tool enablement paths as other tools.

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

On POSIX, `bash` runs each command in its own process group. Cancellation, timeouts, and graceful app-server shutdown
send `SIGTERM` to the group. Diligent gives the group up to one second to exit before sending `SIGKILL` if it still
exists. This does not stop descendants that move to another process group. Windows keeps using `taskkill /F /T`.

On POSIX, foreground `bash` also cleans up any remaining group members when the shell exits normally. Use
`yield_time_ms` rather than shell `&` to keep a command running after the tool returns.

### Background shell commands

Pass `yield_time_ms` to `bash` to return while the command keeps running. If it exits first, `bash` returns its final
output and exit code. Without `yield_time_ms`, `bash` waits for the command as before and uses `timeout`. Background
commands use a 30-minute lifetime limit instead of `timeout`.

Use `bash_wait` with the returned `process_id`:

- Omit `yield_time_ms` to wait up to 10 seconds, or set it to `0` to poll. Each call returns only new output.
- Set `input` to write to stdin. Include `\n` when the command reads a line. The first write requires approval for
  that process. Without `tty` this is a pipe; with `tty` it is typed into the terminal (see below).
- Set `terminate: true` to stop the command and collect its final output. On POSIX, termination uses the same
  `SIGTERM` grace period as foreground cancellation.

Only the originating session can use a process ID. A background command survives turns and a turn interrupt after
`bash` has yielded. Diligent stops it when the thread is deleted, the child agent finishes, or the app server shuts
down. IDs do not survive a restart. Each session can track up to 16 processes. Unread output is bounded, and a final
result can be collected once. If you limit output with `max_output_tokens`, the status and process ID stay visible.

### Terminal commands

Pass `tty: true` to `bash` when a program needs a terminal: it prompts only on a TTY, checks `isatty`, or reads a
password-style line. It works for foreground commands and with `yield_time_ms`. On macOS and Linux the command runs in a
new pseudo-terminal of 120 columns by 40 rows:

- stdout and stderr share the terminal, so the output is one stream with no `[stderr]` section.
- Diligent removes escape sequences (colors, cursor movement, titles) and turns the terminal's `\r\n` into `\n`. A lone
  `\r`, as used by progress bars, starts a new line. The model, the TUI, and the VS Code extension all receive this
  plain text, because neither client renders terminal escape sequences.
- `PAGER` and `GIT_PAGER` default to `cat` and `TERM` defaults to `xterm-256color`, so pagers cannot wait for a keypress.
  Values already set in your environment win. Sensitive variables are filtered as for every `bash` command.
- `bash_wait` `input` is typed into the terminal, which echoes it back like an interactive session. Control characters
  work as keystrokes; for example `\u0003` sends Ctrl-C to the command.
- Timeouts, cancellation, `terminate`, and session shutdown stop the process tree. The built-in POSIX backend
  sends `SIGTERM` to the process group and escalates to `SIGKILL` after a grace period.

Windows hosts can supply a `terminalSpawner` to the app server. Windows PTY commands run in PowerShell.
Standalone Windows Diligent has no backend configured. An explicit `tty` request there fails instead of running
on pipes. Code mode `exec` cells still reject `tty` for nested `tools.bash` calls. Use a direct `bash` call instead.

#### Private terminal input

Use a direct foreground `bash` call with `interactive: true` when a user must type into the running command.
On supported clients, the console shows the command and sends keystrokes straight to its PTY. Terminal input
and output are not model messages and are not recorded in thread history. The agent receives the command's
status only. Inspect the command before entering credentials: the CLI itself can still read or store them.

The console belongs to the client connection that started the turn. Stopping the command, interrupting the
turn, or disconnecting that client closes the PTY. This mode requires a supporting client and is unavailable
without a PTY backend, in `tools.codeMode: "only"`, and for nested or background calls. `tty: true` without
`interactive: true` is not private. Never send a credential via `bash_wait` or a chat question.

## Bundled product tools

Product variants can register first-party bundled tool providers in-process.

Bundled product tools are different from external plugins:

- they ship in the runtime binary instead of being copied into `$HOME/.diligent/plugins`
- they do not require a `tools.plugins` config entry
- they can supersede legacy first-party plugin packages so stale copied plugin folders are ignored by the catalog
- their tool names, Zod schemas, approval prompts, user-input behavior, and render payloads should remain stable when migrated from a plugin
- trusted bundled tools may explicitly declare a provider-native model capability; their catalog name still controls settings, filtering, conflict resolution, and local dispatch

External user-installed plugins are still supported. Supersession only applies to package names declared by a bundled provider.

Provider-native model exposure is intentionally unavailable to external plugin SDK v1 tools. External plugins always advertise locally executable function tools, even if a JavaScript object includes an unknown `modelExposure` property. Adding third-party provider-native capabilities requires a versioned plugin API with validation and user-consent semantics.

## Plugin packages

Assume Diligent itself is already a built binary that you run inside your project.

For local custom plugins, use a fixed home-directory location such as:

- `$HOME/.diligent/plugins/<plugin-name>`

Diligent now resolves plugin packages in this order:

1. normal package import from the running project/environment
2. fallback to `$HOME/.diligent/plugins/<plugin-name>`

That means a prebuilt `diligent` binary can load a plugin from your home plugin folder even when the project did not install that package locally.

To add plugin tools:

1. Create or copy the plugin package under `$HOME/.diligent/plugins/<plugin-name>`.
2. Add the package name under `.diligent/config.jsonc` in either global or project config.
3. Start the next turn.

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
- default `codeMode: "on"` is omitted; explicit `off` and `only` overrides are retained

`tools.codeMode` (`off` | `on` | `only`) defaults to `on`, providing JavaScript `exec` scripts alongside direct tools. It is file-only; tool-settings writes preserve explicit `off` and `only` choices. See `docs/guide/code-mode.md`.

## Conflict policy

Supported policies:

- `error`
- `builtin_wins`
- `plugin_wins`

Even with `plugin_wins`, immutable built-ins still win.

## Minimal plugin package contract

A plugin package must be importable by the running server process and export:

```ts
import { z } from "zod";

export const manifest = {
  name: "@acme/diligent-tools",
  apiVersion: "1.0",
  version: "0.1.0",
};

export async function createTools(ctx: { cwd: string }) {
  return [
    {
      name: "jira_comment",
      description: "Post a Jira comment",
      parameters: z.object({
        issueKey: z.string(),
        body: z.string(),
      }),
      async execute(input: { issueKey: string; body: string }) {
        return {
          output: `Would comment on ${input.issueKey}: ${input.body}`,
        };
      },
    },
  ];
}
```

## External-style example plugin

This repo includes a sample external plugin package at `thirdparty/examples/external-tool-plugin/`.

Treat that folder as if it were a separate repository published independently from Diligent.

- package: `example-tool-plugin`
- tool: `example_project_snapshot`
- behavior: read-only summary of the current project root

If you want to try it with a prebuilt `diligent` binary, copy this sample to your global plugin folder first:

```sh
mkdir -p $HOME/.diligent/plugins
cp -R /absolute/path/to/diligent/thirdparty/examples/external-tool-plugin $HOME/.diligent/plugins/example-tool-plugin
cd $HOME/.diligent/plugins/example-tool-plugin
bun install --production
```

Then enable it in global config `~/.diligent/config.jsonc` or in the target project's `.diligent/config.jsonc`:

```jsonc
{
  "tools": {
    "plugins": [{ "package": "example-tool-plugin", "enabled": true }]
  }
}
```

If you place that entry in `~/.diligent/config.jsonc`, the plugin is available by default across projects. A project-level `.diligent/config.jsonc` can still override tool settings as usual.

After the next turn starts, ask Diligent to use `example_project_snapshot`.

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
