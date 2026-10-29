# Code mode

Code mode lets the model orchestrate tool calls by writing a JavaScript program instead of issuing one tool call per model turn. It follows the shape of Codex Code Mode: an `exec` tool runs a script that calls the other tools as async functions, and a wait tool resumes long-running scripts.

## Configure it

Code mode defaults to `on` for root and child agents on every provider. To override it, use the file-only `tools.codeMode` setting in the global `~/.diligent/config.jsonc` (`~/.<namespace>/config.jsonc` for product namespaces such as `~/.overdare/`). The config loader honors `tools` only from the global layer and ignores project-level `tools` overrides.

```jsonc
{
  "tools": {
    "codeMode": "on" // "off" | "on" (default) | "only"
  }
}
```

| Value | Model-visible tools |
|---|---|
| `off` | Unchanged. |
| `on` (default) | Every direct tool, plus `exec` and `exec_wait`. The model can choose either path; tool schemas are still sent. |
| `only` | `exec`, `exec_wait`, and the direct-only tools. Nested tools are hidden from the tool list; their descriptions and TypeScript declarations move into the `exec` description. |

After a config reload (`config/reload`, e.g. Web/TUI `/reload`) or server restart, new threads use the new value. A thread whose agent is already loaded keeps its tool list until the agent is rebuilt (server restart) or its tools refresh on a model or fast-mode change. Existing explicit `off` and `only` settings override the default and survive tool-settings writes from Web/TUI; the default `on` value is omitted when normalizing the stored config.

Direct-only tools never become nested: tools flagged `codeModeDirect` in `packages/runtime/src/tools/tool-metadata.ts` (`plan`, `request_user_input`, `skill`, `read_image`, goal tools, collab tools) and provider-native tools (`modelExposure`). Their results drive client UI, user interaction, or image content that cannot cross the JSON-only guest bridge.

Sub-agents spawned by collab tools apply the same `codeMode` to their own tool list. Each child has its own `CodeModeSession` (cells and `store`), kept across that child's turns and not shared with the parent. Children inherit the parent's direct tool list and wrap it themselves, so `exec`/`exec_wait` are never passed down.

## `exec`

Input (JSON function tool on every provider):

| Field | Meaning |
|---|---|
| `code` | Raw JavaScript, run as the body of an async function (top-level `await` works). |
| `yield_time_ms` | Return after this long while the script keeps running in the background. Default 10000. |
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

A yield detaches only the waiting call. The script keeps running, and its nested tool calls keep running in the background under the call that last waited on the cell, until the agent run (one user turn, `agent_start` to `agent_end`) ends. A yield does not wait for in-flight nested calls, so `yield_time_ms` is honored; their records reach the next `exec_wait` result. When a script finishes, unawaited nested calls are aborted.

The run owns this background work through `ToolContext.runScope` (core `ToolRunScope`): each nested call is tracked, and when the run ends it first stops accepting new calls (`runScope.closing`), then waits for in-flight ones, so no nested event follows `agent_end`. Calls the script requests after that are held until the next `exec_wait`, possibly in a later run. A sequence whose later steps must happen on time (stop, cleanup, capture) needs an `exec_wait` before the model ends its turn. Hosts that pass no `runScope` keep the earlier behavior: a yield waits for in-flight calls and holds later ones until the next wait.

## Execution model

- Each `exec` call starts a cell: a Bun `Worker` whose source is `codeModeWorkerMain` (`packages/runtime/src/tools/code-mode/worker.ts`) serialized into a Blob URL, so single-file `bun build --compile` binaries need no extra entrypoint. The script runs in a `node:vm` context inside that worker.
- `node:vm` hides host globals but is **not a security boundary**; nested tool calls go through the normal approval and permission engine.
- Nested calls follow the agent loop's batching rule: tools with `supportParallel` may overlap under `Promise.all`; other tools run one at a time.
- Background nested calls can overlap the model's direct calls, so both share one reader/writer gate per `CodeModeSession` (`ToolGate`, `packages/runtime/src/tools/code-mode/gate.ts`). In `on` mode, `applyCodeMode` wraps each direct tool that is also nestable so it acquires the gate; `exec`, `exec_wait`, and direct-only tools never take it, so a wait cannot deadlock against its own cell. Waiters are admitted in arrival order, and an aborted waiter leaves the queue. Child agents have their own sessions and gates.
- A rejected approval aborts the run exactly as a direct call does. Aborting the run, or the call waiting on the cell, terminates the cell.
- `CodeModeSession` (one per `RuntimeAgent`) owns cells, the store, and the gate; it survives tool refreshes between turns. At most 8 live cells are kept; starting another terminates the least recently driven cell that no call is waiting on.
- The guest body starts after an `await` because Bun 1.3 crashes when a worker blocked inside `vm.runInContext` is terminated.

## Events, persistence, and rendering

- `ToolContext.emitNestedToolEvent` lets a tool emit `tool_start`/`tool_update`/`tool_end` for calls it runs. The core runner tags them with `parentToolCallId`, which `@diligent/protocol` carries on `AgentEvent` tool events and on `toolCall` thread items.
- Nested `tool_end` events are not persisted as `tool_result` messages and are never sent to the provider. The next `exec`/`exec_wait` result's `metadata.codeMode.nestedCalls` records them (outputs capped at 8000 characters, with `fullOutputPath` when longer). Each record names its `parentToolCallId`: the call it ran under, which for a background call is an earlier call than the carrying result. `thread/read` rebuilds them as `toolCall` items placed after their parent's item and earlier nested items; records without a parent (older sessions) stay with the carrying result.
- Web renders nested items indented under a left rule while their parent's group is the latest row; a background call that arrives after other rows is labelled `Script ·` instead. TUI prefixes nested results with a `│` gutter while the parent call is still running (they commit above its result); a background result that commits after the parent's result gets a `↳ script ·` marker instead.

## Known limits

- Polling the same cell with identical `exec_wait` arguments three times in a row trips the agent loop's doom-loop warning.
- `exec` is a JSON function tool on every provider; the Codex freeform (Lark grammar) wire format and its `// @exec:` pragma are not implemented.
- Background nested calls reach history only through a later `exec`/`exec_wait` result on that cell. If the model never waits on the cell again, they were shown live but are missing from `thread/read`.
- Holding a run open for in-flight background calls keeps the thread busy until they finish; a cell can still hold calls across runs when the model ends its turn without waiting.

## Key code paths

- `packages/runtime/src/tools/code-mode/` — worker, session, descriptions, tools
- `packages/runtime/src/app-server/factory.ts` — `applyCodeMode` in agent tool assembly
- `packages/core/src/tool/types.ts`, `packages/core/src/agent/tool.ts` — nested event and run scope contract
- `packages/core/src/agent/loop.ts` — run scope creation and settling before `agent_end`
- `packages/runtime/src/session/turn-stager.ts`, `packages/runtime/src/app-server/thread-read-builder.ts` — persistence and history
- `packages/e2e/app-server/code-mode.test.ts` — protocol-level behavior
