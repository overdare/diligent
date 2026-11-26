# 09 — Language server integration

Status: proposal · Depends on: 07 (per-call concurrency) · Integrates with: 04 (post-edit diagnostics)

## Problem

Code navigation is text search only (`grep`/`glob` via `rg`). The model cannot ask "where is this symbol defined",
"who calls this", or "did my edit introduce type errors" without running a full build through `bash`.

## Current state

No LSP client exists in `packages/runtime` or `packages/core` (search for `lsp`, `languageserver`,
`textDocument/` returns nothing). Diagnostics after edits come only from whatever the model runs through `bash`.

## Reference survey

- **oh-my-pi** `packages/coding-agent/src/lsp/`: one `lsp` tool with actions `diagnostics`, `definition`,
  `references`, `hover`, `symbols`, `rename`, `rename_file`, `code_actions`, `type_definition`, `implementation`,
  `status`, `reload`, `capabilities`, `request` (`lsp/types.ts`); per-call timeout 5–300 s; read-only sessions may only
  use read actions (`lsp/tool.ts:184-227`). Server defaults keyed by name with `command`, `args`, `fileTypes`,
  `rootMarkers`, `initOptions`, `settings` (`lsp/defaults.json`). Write-through diagnostics after edits with a deferred
  channel for late results (`lsp/writethrough.ts:87-153, 305-312`).
- **hermes-agent** `agent/lsp/`: manager with idle reaper, trusted workspaces, wait modes, and a post-edit check
  (`edit_check.py`).

## Design

### Tool

```ts
lsp {
  action: "diagnostics" | "definition" | "references" | "hover" | "symbols"
        | "type_definition" | "implementation" | "rename" | "status";
  file?: string;          // absolute path; required except for workspace "symbols" and "status"
  line?: number;          // 1-based, matching read output
  symbol?: string;        // resolves the column: first occurrence of symbol on `line`
  query?: string;         // workspace symbol query
  new_name?: string;      // rename
  apply?: boolean;        // rename: false (default) returns the edit preview; true applies it
  timeout_s?: number;     // 5–120, default 20
}
```

- `symbol` + `line` instead of raw columns: models address lines reliably, columns poorly.
- Results are rendered as `path:line` lists with one line of context each, capped at 100 entries.
- `rename` with `apply: true` writes through the same write path as `apply_patch` (approval with `permission:
  "write"`, stale-write guard from doc 04, one approval for the whole multi-file edit with the file list in details).
- Concurrency (doc 07): `concurrency(args)` → `exclusive` for `rename` with `apply`, else `shared`.
- Plan mode and read-only children: everything except applying `rename`.
- Code mode: nestable (`exec` can call it).

### Servers

Config, merged global < project like `mcpServers`:

```jsonc
"lsp": {
  "enabled": true,
  "servers": {
    "typescript": { "command": "typescript-language-server", "args": ["--stdio"],
                    "fileTypes": [".ts", ".tsx", ".js", ".jsx"], "rootMarkers": ["tsconfig.json", "package.json"] },
    "luau": { "command": "luau-lsp", "args": ["lsp"], "fileTypes": [".luau", ".lua"], "rootMarkers": [".luaurc"] }
  },
  "postEditDiagnostics": "running"  // "off" | "running" (only servers already started) | "start"
}
```

- Built-in defaults for `typescript-language-server`, `pyright-langserver`, `rust-analyzer`, `gopls`, `clangd`,
  `luau-lsp`, each used only when its command resolves on PATH. No automatic installation.
- On Windows, commands resolve through `PATHEXT` (`.cmd` shims for npm-installed servers).
- **Trust:** project-layer `lsp.servers` entries execute binaries from the repository's config; they follow the same
  trust decision as project hooks (doc 01), which is deferred (README decision 1). Until it is made, only built-in
  defaults and global-layer `lsp.servers` are honored.

### Lifecycle

- Lazy start per `(server, root)`, where root = nearest ancestor of the file containing a `rootMarker`, bounded by the
  thread cwd.
- `initialize` → `initialized` → `didOpen` on first touch of a file; `didChange` (full sync) when Diligent writes a file;
  `didChangeWatchedFiles` for files changed by `bash` is not attempted in phase 1 — every request re-syncs the target
  file from disk first.
- Idle shutdown after 10 min without requests; crash → restart with backoff (1 s, 5 s, 30 s), then `status` reports
  the server as failed until `reload`.
- Transport: `vscode-jsonrpc` over stdio (`StreamMessageReader/Writer`); types from `vscode-languageserver-protocol`.
  Both are small, stable, and avoid a hand-rolled framer.
- One `LspManager` per runtime process (like `McpConnectionManager`), shared by threads; documents are tracked per
  server, not per thread.

### Post-edit diagnostics

After a successful `edit`, `multi_edit`, `write`, or `apply_patch`, when `postEditDiagnostics != "off"` and a matching
server is running (or allowed to start): send `didChange`, wait up to 1 500 ms for `publishDiagnostics` for that URI,
and append at most 10 **errors** (not warnings) whose range intersects the changed lines, or a count of new errors
elsewhere in the file:

```
LSP (typescript): 2 errors in edited lines
  src/a.ts:41 Property 'foo' does not exist on type 'Bar'.
```

The edit itself has already succeeded; diagnostics are informational and never turn the result into an error. Late
diagnostics are dropped (no deferred channel in phase 1).

## Risks

- **Memory and CPU** of language servers on large repos; bounded by lazy start, idle shutdown, and `enabled`.
- **Stale results** when files change outside Diligent's writes; mitigated by re-syncing the target file per request.
- **Latency** added to every edit by post-edit diagnostics; bounded at 1.5 s and limited to running servers by default.

## Tests

- `packages/runtime/test/tools/lsp/manager.test.ts` with a fake stdio LSP server fixture
  (`test/fixtures/fake-lsp.ts`) that answers `definition` and publishes diagnostics: lazy start, root resolution, idle
  shutdown, crash backoff.
- `packages/runtime/test/tools/lsp/post-edit.test.ts`: diagnostics in edited lines are appended; timeout appends
  nothing; edit result is never an error.
- An integration test against `typescript-language-server`, skipped when not on PATH.
