# 07 — Per-call tool concurrency in the agent loop

Status: proposal · Depends on: none · Enables: cheaper mixed batches; used by 02, 09

## Problem

A model batch runs in parallel only when **every** call is parallel-safe. One `edit` in a batch of five `read`s
serializes all six. Code mode already solved the general case with a reader/writer gate, but the direct loop does not
use it.

## Current state

| Fact | Evidence |
|---|---|
| `canRunInParallel = toolCalls.length > 1 && toolCalls.every(supportParallel)`; otherwise strictly sequential | `packages/core/src/agent/tool.ts:54-55, 63-110` |
| Parallel path emits every `tool_start` up front, then `Promise.all` | `tool.ts:63-84` |
| Parallel-safe tools: `read`, `glob`, `grep`, `ls`, `read_image`, `plan`, `skill`, MCP resources/prompts, MCP search, MCP tools with `readOnly` annotation | grep of `supportParallel: true`; `tools/mcp/to-tool.ts:144` |
| `ToolGate`: FIFO reader/writer gate — shared calls overlap, exclusive calls run alone, a waiting exclusive call is not starved by later shared calls; one per `CodeModeSession` (per agent) | `packages/runtime/src/tools/code-mode/gate.ts:1-60` |
| Code mode wraps **direct** calls of nestable tools with the same gate so yielded cells and direct calls interleave safely | `tools/code-mode/tools.ts:138` |
| Aborted batches synthesize matching `tool_result`s for calls that never ran | `tool.ts:112-159` |

## Reference survey

- **oh-my-pi** `packages/agent/src/agent-loop.ts:115-128`: `resolveToolConcurrency(tool, args) → "shared" |
  "exclusive"`, default shared, a throwing resolver → exclusive; scheduling at `:3938-3975` makes an exclusive call
  wait for the previous exclusive call and all shared calls started before it.
- **codex** `core/src/tools/parallel.rs:53, 205-216, 330-362`: one `RwLock<()>` per runtime; parallel-capable calls take
  the read lock, others the write lock.

Both are the same model as Diligent's `ToolGate`.

## Design

### Contract

```ts
// packages/core/src/tool/types.ts
interface Tool {
  supportParallel?: boolean;                                   // unchanged meaning: shared when true
  concurrency?: (args: unknown) => "shared" | "exclusive";     // NEW, optional, argument-dependent override
}
```

Resolution: `concurrency(args)` if present (a throw → `exclusive`), else `supportParallel ? "shared" : "exclusive"`.
Plugin SDK `Tool` gains the same optional field. Initial users of `concurrency`: `bash_wait` (shared unless `input` or
`terminate`, doc 02), `lsp` (shared for read actions, exclusive for `rename`, doc 09).

### One gate per agent, in core

Move `ToolGate` to `packages/core/src/agent/tool-gate.ts`. The agent owns one gate; the runtime passes the same
instance to code mode, replacing the per-`CodeModeSession` gate. Then:

- `runToolCalls` acquires the gate per call, in model order: calls `[r1, r2, w1, r3]` run as `r1 ∥ r2`, then `w1`, then
  `r3`. FIFO admission means `r3` never jumps ahead of `w1`, so the model's ordering of reads and writes is preserved.
- Code-mode nested calls and yielded cells acquire the same gate (as today), so a direct `edit` can no longer overlap a
  nested `write` from a cell.
- The code-mode wrapper around direct nestable calls (`code-mode/tools.ts:138`) is deleted; the loop now holds the gate
  for every direct call.

### Events and results

- `tool_start` is emitted when a call is **admitted**, not when the batch begins, so clients see real start times. The
  item IDs are still allocated up front in model order.
- `executions` (and therefore provider-visible `tool_result`s) stay in model order regardless of completion order.
- Abort: queued calls whose acquisition rejects with the abort reason get the existing synthesized aborted result;
  running calls receive the signal as today. `fillAbortedExecutions` generalizes from "sequential prefix" to "any call
  without an execution".
- A user rejection (which calls `ctx.abort()`) cancels queued calls exactly as it cancels the remaining sequential
  calls today.

### Semantics preserved

- A batch of all-shared calls behaves as the current parallel path.
- A batch of all-exclusive calls behaves as the current sequential path, including stopping after an abort.
- `endTurn` handling is unchanged: evaluated after the batch on the ordered executions.

## Risks

- **Client assumptions.** Clients that assumed "all `tool_start`s precede any `tool_end`" in parallel batches must key
  strictly by `itemId`. The shared reducer does **not**: it keeps one live-tool slot (`liveToolName`,
  `liveToolOutput`) that `tool_start` overwrites and `tool_end` clears (`protocol/src/conversation-reducer.ts:68-94`).
  Interleaving makes the overlay show whichever call started last and clear early. The change converts the live slot
  into a map keyed by `itemId` (overlay shows the most recent running call) and checks both clients.
- **Hidden ordering dependencies between "read-only" MCP tools.** Unchanged risk: `readOnly` annotation is already
  trusted today.

## Tests

- `packages/core/test/agent/tool.test.ts`: `[r, r, w, r]` with controllable promises proves overlap of the first two,
  exclusivity of `w`, and that the last `r` starts only after `w` ends; results in model order; abort while `w` is
  queued yields synthesized results for `w` and the trailing `r` only.
- Gate tests in `packages/runtime/test/tools/code-mode/tools.test.ts` move to `packages/core/test/agent/` with the gate.
- Existing code-mode tests prove direct/nested interleaving still serializes exclusive calls.
