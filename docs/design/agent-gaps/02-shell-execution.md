# 02 — Shell execution: streaming output, background processes, PTY, process-group kill

Status: proposal · Depends on: none · Integrates with: 05 (sandbox launcher), 07 (concurrency), 01 (hooks)

## Problem

`bash` blocks until the command exits or times out, shows nothing while it runs, cannot keep a dev server or watcher
alive across tool calls, cannot drive interactive programs, and on POSIX leaves grandchildren running after a timeout.

## Current state

| Fact | Evidence |
|---|---|
| Params: `command`, `description?`, `timeout?` (default 120 000 ms) | `packages/runtime/src/tools/bash.ts:11-17` |
| Output is buffered into arrays and returned once; `ctx.onUpdate` is never called | `bash.ts:117-133` |
| Pipes only (`stdout`/`stderr: "pipe"`), no TTY | `bash.ts:109-115` |
| Timeout/abort kills via `spawnProcess`; on POSIX `killTree` is `proc.kill("SIGKILL")` on the shell PID only — children of the shell survive | `packages/runtime/src/util/process.ts:19-25` |
| Model output is head+tail truncated by the executor and spilled to disk | `bash.ts:143-154`, `packages/core/src/tool/executor.ts:75-90` |
| Code mode already has a yield model: `exec` returns after `yield_time_ms` (default 10 000) and `exec_wait {cell_id, yield_time_ms?, max_output_tokens?, terminate?}` continues it | `tools/code-mode/tools.ts:24-55`, `code-mode/description.ts:8-9` |
| Protocol already carries `tool_update`; the shared reducer **appends** each `partialResult` to a single live-tool output buffer (`liveToolOutput + partialResult`) | `packages/protocol/src/data-model.ts:272`, `protocol/src/conversation-reducer.ts:79-86` |
| Bun in this repo is 1.3.14; `Bun.spawn({ terminal })` allocates a PTY on macOS (verified locally: child `tty` prints `/dev/ttys…`) | `package.json` `packageManager` |

## Reference survey

- **codex unified exec** (`codex-rs/core/src/unified_exec/mod.rs:70-86`): yield 250 ms–30 s, empty-yield floor 5 s,
  Windows initial yield floor 10 s, background terminal timeout 300 s, output budget 10 000 tokens, 1 MiB buffer per
  process, max 64 processes; follow-up tool `write_stdin {session_id, chars, yield_time_ms, max_output_tokens}`.
- **hermes-agent** `tools/process_registry.py:1-96`: `terminal(background=true)` + `process_manage(action=poll|wait|
  write|submit|close|kill)`; 200 KB rolling buffer; finished processes kept 30 min; max 64 tracked (LRU); JSON
  checkpoint for crash recovery.
- **oh-my-pi** `exec/bash-executor.ts`: default timeout 300 s; shells retained while background jobs live.

## Design

### Model-facing surface

Reuse the code-mode yield vocabulary so the model learns one pattern.

```ts
bash {
  command: string;
  description?: string;
  timeout?: number;          // ms; unchanged meaning: hard kill for foreground runs
  yield_time_ms?: number;    // NEW: return early while the process keeps running
  tty?: boolean;             // NEW: allocate a PTY (POSIX only in phase 1)
  max_output_tokens?: number // NEW: budget for this response
}

bash_wait {                   // NEW tool
  process_id: string;
  yield_time_ms?: number;    // default 10 000
  input?: string;            // bytes written to stdin/PTY before waiting
  terminate?: boolean;       // SIGTERM → 2 s grace → SIGKILL on the process group
  max_output_tokens?: number;
}
```

- Omitting `yield_time_ms` keeps today's behavior exactly (block until exit or `timeout`, then kill). Background use is
  explicit; no behavior change for existing prompts or evals.
- With `yield_time_ms`, the response is either the final result (process exited within the window) or
  `{status: "running", process_id, output: <new output since last read>}`. `timeout` is ignored for yielded processes;
  their lifetime cap is `backgroundTimeoutMs` (default 30 min, config `tools.bash.backgroundTimeoutMs`).
- Each read returns only output produced since the previous read (per-process cursor), bounded by
  `max_output_tokens` (default 10 000 → bytes via the existing 4-bytes/token estimate), head+tail when it overflows.

### ProcessRegistry

One `ShellProcessRegistry` per agent, owned beside `CodeModeSession` (which is already per agent and survives the
per-turn agent rebuild, `collab/registry.ts:372-373`).

| Limit | Value | Source of default |
|---|---|---|
| Live processes per agent | 16 | codex 64 is per session with many agents; 16 per agent bounds collab fan-out |
| Rolling output buffer | 1 MiB per process | codex |
| Finished process retention | until read once, max 30 min | hermes |
| Background lifetime | 30 min | between codex 5 min and unbounded |

Lifecycle:

- **Turn end:** yielded processes keep running (dev servers must survive). Foreground processes are already gone.
- **`turn/interrupt`:** kills foreground commands only.
- **`close_agent` / child final:** kills that child's processes.
- **Thread dispose / server shutdown:** kills all; `SessionEnd` hook (doc 01) fires after.
- **Resume after restart:** processes are not recovered (no crash checkpoint in phase 1); `bash_wait` on an unknown ID
  returns `unknown process_id (processes do not survive a runtime restart)`.

### Streaming

Foreground and yielded runs call `ctx.onUpdate` with **new output only** (deltas, because the shared reducer appends
each `partialResult`), coalesced to ≤ 4 updates/s and ≤ 8 KB per update; when a burst exceeds the budget the dropped
middle is replaced by a `[… N bytes …]` marker. This uses the existing `tool_update` event; there is no protocol
change. Each client still needs to render live output for `bash`. Updates are not persisted.

Streaming is bound to a live tool call: once `bash` returns `running`, later output streams only while a `bash_wait`
call for that process is in progress. Between calls it accumulates in the rolling buffer. A process-level
notification stream for clients (a "terminals" panel) is a follow-up and would need a new protocol notification.

### Process groups

POSIX: spawn with `detached: true` (new process group) and kill `-pgid`: `SIGTERM`, then `SIGKILL` after a 2 s grace.
This fixes orphaned grandchildren on timeout/abort for both foreground and background runs. Windows keeps
`taskkill /F /T` (`util/process.ts:20-21`). The change lives in `spawnProcess` so hooks and other callers benefit.

### PTY

- `tty: true` on POSIX uses `Bun.spawn({ terminal: { cols: 120, rows: 40 } })`; output is a single merged stream
  (no `[stderr]` section) with ANSI sequences stripped for the model and kept for the client render.
- **Windows:** `[INFERENCE — verify]` `Bun.Terminal` is POSIX-only in Bun 1.3.x. Phase 1 returns a clear error for
  `tty: true` on Windows instead of silently falling back to pipes, because a program that needs a TTY behaves
  differently without one. ConPTY support is a follow-up decided after measuring demand.
- Tool description lists `tty` only on platforms that support it, so the model is not offered a dead option.

### Approval and authority

- Approval happens once at spawn, as today, with `details.command` (rules and "always" patterns keep working).
- `bash_wait.input` into a PTY can run arbitrary commands when the process is a shell or REPL. First `input` to a
  given process requests approval `{permission: "execute", toolName: "bash_wait", details: {command: "<stdin to
  process N: original command>"}}`; an `once`/`always` answer is remembered for that process only.
- `PreToolUse` hooks (doc 01) see both `bash` and `bash_wait` calls.

### Code mode and concurrency

- Nested `bash` calls from `exec` reject `yield_time_ms` and `tty` (a cell already yields; nesting two yield models is
  confusing and leaks processes past cell termination).
- `bash` stays exclusive; `bash_wait` without `input`/`terminate` is shared (doc 07 per-call concurrency).

### Rendering

`createCommandRenderPayload` gains a `status: "running" | "exited"` and `processId`. The final render of a yielded
process is emitted by the `bash_wait` call that observes the exit.

## Risks

- **Forgotten servers.** Mitigated by the 30-min cap, the per-agent limit, and listing live processes in the
  `bash_wait` error when an ID is unknown.
- **Port conflicts between parallel subagents** sharing a host; out of scope, reported by the program itself.
- **Output secrets** are already handled only by env filtering (`bash.ts:19-58`); unchanged.

## Tests

- `packages/runtime/test/tools/bash.test.ts`: yield returns `running` with partial output then `bash_wait` returns the
  exit; cursor returns only new output; `terminate` kills a process group whose child ignores `SIGTERM` (spawn
  `sh -c 'trap "" TERM; sleep 60 & wait'`) and no descendant survives; timeout kills grandchildren.
- `packages/runtime/test/util/process.test.ts`: process-group kill on POSIX.
- `packages/e2e/app-server/bash-background.test.ts`: `tool_update` notifications arrive before `item/completed`.
- PTY test guarded by `process.platform !== "win32"`: `tty` returns a TTY name.

## Wave 1 implementation notes

Shipped on `fix/bash-process-group-streaming`: process-group kill and live output. `yield_time_ms`, `bash_wait`, and
PTY remain Wave 2. Differences from the design above:

- The group is killed with `SIGKILL` at once, as the single-process kill was before; there is no `SIGTERM` grace yet.
- Detached groups no longer receive the terminal's signals, so `spawnProcess` also kills every running group when the
  runtime process exits.
- The skipped-content marker counts characters: `[… N characters …]`.
- Tests: `packages/runtime/test/tools/bash-streaming.test.ts` (timeout and abort kill a background grandchild; first
  update arrives before exit; per-update cap and marker).
