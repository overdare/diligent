# Language servers

Diligent talks to language servers over stdio for code navigation (the `lsp` tool) and for diagnostics after its own
edits. Servers start on first use, are shared by all threads of the runtime process, and are never installed by
Diligent.

## The `lsp` tool

| Action | Needs | Result |
|---|---|---|
| `definition`, `type_definition`, `implementation`, `references` | `file`, `line`, `symbol` | `path:line` list |
| `hover` | `file`, `line`, `symbol` | hover text |
| `symbols` | `file`, or `query` for a workspace search | `path:line` list |
| `diagnostics` | `file` | errors and warnings as a `path:line` list |
| `rename` | `file`, `line`, `symbol`, `new_name`, optional `apply` | edit preview, or the applied edits |
| `status` | — | configured servers, their state, and unavailable servers |

- Positions use `line` (1-based, as `read` shows) and `symbol`: the first occurrence of that identifier on the line.
  There is no column parameter.
- Lists show one line of context per entry and stop at 100 entries, with a count of the rest.
- `timeout_s` (5–120, default 20) bounds the whole call.
- Every request re-reads the target file from disk and syncs it to the server first, so changes made by `bash` or
  other tools are seen. `rename` and `references` also re-sync every file the server has open.
- `rename` previews by default. `apply: true` asks for one `write` approval listing every file, re-checks after the
  approval that no file changed since the edits were computed (otherwise nothing is written), and then writes all
  files. Renames that create, move, or delete files are rejected.
- An applied rename runs exclusively; every other call is shared and may overlap other read-only calls.
- Plan mode and read-only agents get a variant of the tool whose `rename` only previews.
- Code mode `exec` can call the tool.

Clients render results through the shared tool render payload: a `path:line` list, hover text, or a diff for renames.

## Post-edit diagnostics

After a successful `edit`, `multi_edit`, `write`, or `apply_patch`, Diligent sends the new content of each written file
to a matching server that has it open. Unless `postEditDiagnostics` is `off`, it then waits up to 1.5 s for that file's
diagnostics and appends a note to the tool result:

```
LSP (typescript): src/b.ts: 1 error in edited lines
  src/b.ts:4 Property 'foo' does not exist on type 'Bar'.
```

- Only errors are reported, never warnings. At most 10 errors on changed lines are listed.
- Errors outside the changed lines are only counted, and only when they are new: Diligent compares them with the
  diagnostics of the previous content (asking the server for them when it has none cached). When that comparison is
  not possible in time, the note says the count may include pre-existing errors.
- Diagnostics that arrive after the deadline are dropped. The note never turns a successful write into an error.

## Configuration

```jsonc
{
  "lsp": {
    "enabled": true,
    "postEditDiagnostics": "running", // "off" | "running" | "start"
    "servers": {
      "luau": { "enabled": false },
      "typescript": { "args": ["--stdio", "--log-level", "4"] },
      "zig": { "command": "zls", "fileTypes": [".zig"], "rootMarkers": ["build.zig"] }
    }
  }
}
```

- `enabled: false` removes the tool and the post-edit hook.
- `postEditDiagnostics`: `off` only keeps open documents in sync; `running` (default) waits for diagnostics from a
  server that is already running; `start` also starts a matching server (the first edit may finish before it is ready).
- `servers` entries take `enabled`, `command`, `args`, `fileTypes` (extensions with the dot), `rootMarkers`,
  `initOptions` (sent as `initializationOptions`), and `settings` (answered to `workspace/configuration` and sent with
  `workspace/didChangeConfiguration`).
- `servers` merges across global (`~/.diligent/config.jsonc`) < project (`.diligent/config.jsonc`) like `mcpServers`:
  a project entry overrides only the fields it sets.
- An entry named like a built-in default overrides only the fields it sets. `{ "enabled": false }` turns that default
  off, even when its command resolves. A new entry needs `command` and `fileTypes`.

A bare command name resolves in the working directory's `node_modules/.bin`, `.venv/bin`, `.venv/Scripts`, `venv/bin`,
and `venv/Scripts` first, then on PATH (on Windows through `PATHEXT`, so npm `.cmd` shims work). A server whose
command does not resolve is listed under `Unavailable` by `status`.

Built-in defaults:

| Name | Command | File types |
|---|---|---|
| `typescript` | `typescript-language-server --stdio` | `.ts .tsx .mts .cts .js .jsx .mjs .cjs` |
| `typescript-native` | `tsc --lsp --stdio` | same as `typescript` |
| `pyright` | `pyright-langserver --stdio` | `.py .pyi` |
| `rust-analyzer` | `rust-analyzer` | `.rs` |
| `gopls` | `gopls` | `.go` |
| `clangd` | `clangd` | C, C++ and Objective-C sources and headers |
| `luau` | `luau-lsp lsp` | `.luau .lua` |

Only one TypeScript server is used. When the resolved `tsc` belongs to an npm `typescript` package without
`lib/tsserver.js` (TypeScript 7+, whose native `tsc` is itself a language server), `typescript-native` is used;
otherwise `typescript`, which needs the project's `tsserver.js`. A TypeScript 7 project with `typescript` installed
locally therefore gets a language server without installing anything else.

## Lifecycle

- One server process runs per server and root. The root is the nearest ancestor of the file that contains one of the
  server's `rootMarkers`, searched up to the thread's working directory, which is the fallback.
- A server stops after 10 minutes without use.
- A crashed server restarts on next use after 1 s, 5 s, and 30 s; after a fourth crash `status` reports it failed and it
  stays stopped until the config is reloaded.
- Config reload and app-server shutdown stop every server.
- Files changed outside Diligent are not watched (`workspace/didChangeWatchedFiles` is not sent); the per-request
  re-sync covers the files a request touches.

## Key code paths

- `packages/runtime/src/tools/lsp/` — client, manager, server catalog, tool, post-edit hook
- `packages/runtime/src/tools/read-only-variant.ts` — plan-mode and read-only agent variant hook
- `packages/core/src/agent/tool-gate.ts` — `resolveToolConcurrency` for per-call shared/exclusive scheduling
- `packages/runtime/test/fixtures/fake-lsp.ts` — fake stdio server used by the tests
