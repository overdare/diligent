# Code mode

Code mode lets the model orchestrate tool calls by writing a JavaScript program instead of issuing one tool call per model turn. It follows the shape of Codex Code Mode: an `exec` tool runs a script that calls the other tools as async functions, and a wait tool resumes long-running scripts.

## Enable it

Code mode is a file-only setting under `tools` in the global `~/.diligent/config.jsonc` (`~/.<namespace>/config.jsonc` for product namespaces such as `~/.overdare/`). The config loader honors `tools` only from the global layer and ignores project-level `tools` overrides.

```jsonc
{
  "tools": {
    "codeMode": "only" // "off" (default) | "on" | "only"
  }
}
```

| Value | Model-visible tools |
|---|---|
| `off` | Unchanged. |
| `on` | Every direct tool, plus `exec` and `exec_wait`. Saves round trips; tool schemas are still sent. |
| `only` | `exec`, `exec_wait`, and the direct-only tools. Nested tools are hidden from the tool list; their descriptions and TypeScript declarations move into the `exec` description. |

After a config reload (`config/reload`, e.g. Web/TUI `/reload`) or server restart, new threads use the new value. A thread whose agent is already loaded keeps its tool list until the agent is rebuilt (server restart) or its tools refresh on a model or fast-mode change. Tool-settings writes from Web/TUI preserve the stored value.

Direct-only tools never become nested: tools flagged `codeModeDirect` in `packages/runtime/src/tools/tool-metadata.ts` (`plan`, `request_user_input`, `skill`, `read_image`, goal tools, collab tools) and provider-native tools (`modelExposure`). Their results drive client UI, user interaction, or image content that cannot cross the JSON-only guest bridge.

Sub-agents spawned by collab tools apply the same `codeMode` to their own tool list. Each child has its own `CodeModeSession` (cells and `store`), kept across that child's turns and not shared with the parent. Children inherit the parent's direct tool list and wrap it themselves, so `exec`/`exec_wait` are never passed down.

## `exec`

Input (JSON function tool on every provider):

| Field | Meaning |
|---|---|
| `code` | Raw JavaScript, run as the body of an async function (top-level `await` works). |
| `yield_time_ms` | Return early while the script keeps running. Default 10000. |
| `max_output_tokens` | Output budget (≈4 bytes/token, head+tail truncation). Default 10000. |

Guest globals:

- `tools.<name>(args)`: calls a nested tool; resolves to its text output, rejects with an `Error` when the tool result is an error. Names outside `[A-Za-z0-9_$]` become `_`. Outputs are text; `JSON.parse` only works on tools that return JSON.
- `text(value)`, `image(dataUrl | { image_url })`: append output items.
- `store(key, value)` / `load(key)`: JSON values kept for the agent's lifetime, across `exec` calls.
- `exit()`, `yield_control()`, `setTimeout`, `clearTimeout`, `ALL_TOOLS`.
- A non-`undefined` top-level `return` value is appended like `text(value)` (Diligent addition).

There is no `console`, `require`, `import`, `process`, `Bun`, `fetch`, or file system; all side effects go through `tools`.

The result's first line is the status: `Script completed`, `Script failed` (followed by `Script error:` and the error with `exec.js:<line>` frames), `Script terminated`, or `Script running with cell ID <id>`.

Guest syntax errors report `exec.js:<line>:<column>`, the failing line with the previous one, and a caret. JavaScriptCore only reports the line, so the worker re-parses the source with `Bun.Transpiler` to recover the column and a parser message (it falls back to the engine line when the transpiler accepts the source). For unterminated strings or an unexpected end of input, the error adds a hint to use template literals: raw line breaks inside `"..."`/`'...'` were the most common guest syntax error in practice (for example `bash` heredocs).

## Output limits

| Output | Limit |
|---|---|
| Nested result handed to the script | 8 MiB (`MAX_GUEST_TOOL_OUTPUT_BYTES`). The model-facing 50 KB cap does not apply, so `JSON.parse(await tools.x())` sees the complete output. Larger results are truncated head+tail and the full text is saved through the output store. |
| `exec`/`exec_wait` result the model sees | `max_output_tokens`/`max_tokens` × 4 bytes, head+tail, full text saved through the output store. |
| Nested output in history and live `tool_end` events | 8000 characters. A longer output is saved through the output store (or the executor's spill file is reused); the record's `fullOutputPath` and a `full output at: <path>` marker point at the complete text. |

`bash` returns its complete output and leaves model-facing truncation (head+tail, so the status header stays) and the spill file to the core executor; its render payload keeps the last 50 KB.

## `exec_wait`

Named `exec_wait` because `wait` is the collab tool. Input: `cell_id`, `yield_time_ms`, `max_tokens`, `terminate`. It returns output produced since the previous yield, or the final result, and closes finished cells.

While no `exec`/`exec_wait` call is waiting on a cell, the script keeps running but nested tool calls it requests are held; they run under the next `exec_wait`. A yield waits for in-flight nested calls to finish so every nested call belongs to exactly one parent call; if the deadline passed during such a call, the cell then waits up to 500 ms for the script to finish, so a script whose last call outlasts `yield_time_ms` returns `Script completed` instead of a running result plus an `exec_wait` round trip. When a script finishes, unawaited nested calls are aborted.

## Execution model

- Each `exec` call starts a cell: a Bun `Worker` whose source is `codeModeWorkerMain` (`packages/runtime/src/tools/code-mode/worker.ts`) serialized into a Blob URL, so single-file `bun build --compile` binaries need no extra entrypoint. The script runs in a `node:vm` context inside that worker.
- `node:vm` hides host globals but is **not a security boundary**; nested tool calls go through the normal approval and permission engine.
- Nested calls follow the agent loop's batching rule: tools with `supportParallel` may overlap under `Promise.all`; other tools run one at a time.
- A rejected approval aborts the turn exactly as a direct call does. Aborting the turn terminates the cell.
- `CodeModeSession` (one per `RuntimeAgent`) owns cells and the store; it survives tool refreshes between turns. At most 8 live cells are kept; starting another terminates the least recently driven idle cell.
- The guest body starts after an `await` because Bun 1.3 crashes when a worker blocked inside `vm.runInContext` is terminated.

## Events, persistence, and rendering

- `ToolContext.emitNestedToolEvent` lets a tool emit `tool_start`/`tool_update`/`tool_end` for calls it runs. The core runner tags them with `parentToolCallId`, which `@diligent/protocol` carries on `AgentEvent` tool events and on `toolCall` thread items.
- Nested `tool_end` events are not persisted as `tool_result` messages and are never sent to the provider. The parent result's `metadata.codeMode.nestedCalls` records them (outputs capped at 8000 characters, with `fullOutputPath` when longer), and `thread/read` rebuilds them as `toolCall` items with `parentToolCallId` after the parent item.
- Web renders nested items indented under a left rule; TUI prefixes them with a `│` gutter. In TUI they appear above the `exec` result because items commit at `tool_end`.

## Known limits

- Polling the same cell with identical `exec_wait` arguments three times in a row trips the agent loop's doom-loop warning.
- `exec` is a JSON function tool on every provider; the Codex freeform (Lark grammar) wire format and its `// @exec:` pragma are not implemented.

## Key code paths

- `packages/runtime/src/tools/code-mode/` — worker, session, descriptions, tools
- `packages/runtime/src/app-server/factory.ts` — `applyCodeMode` in agent tool assembly
- `packages/core/src/tool/types.ts`, `packages/core/src/agent/tool.ts` — nested event contract
- `packages/runtime/src/session/turn-stager.ts`, `packages/runtime/src/app-server/thread-read-builder.ts` — persistence and history
- `packages/e2e/app-server/code-mode.test.ts` — protocol-level behavior
