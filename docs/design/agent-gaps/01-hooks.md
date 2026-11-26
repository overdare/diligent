# 01 — Lifecycle hooks: tool, session, compaction, and subagent events

Status: proposal · Depends on: none · Enables: 10 (denial breaker), 05 (sandbox escape analysis)

## Problem

External automation can observe or steer only two points in the agent's lifecycle. Policy enforcement
("never run `rm -rf` outside the workspace"), audit logging, formatter-on-write, and context injection at session start
are impossible without forking the runtime.

## Current state

| Fact | Evidence |
|---|---|
| Config accepts exactly two shell-hook events: `UserPromptSubmit` and `Stop` | `packages/runtime/src/config/schema.ts:235-240` |
| Handler shape `{type:"command", command, mode?: sync\|async, timeout?}` with no matcher | `schema.ts:5-10` |
| Sync timeout default 10 s; `bash -c` with JSON on stdin; `exit 2` blocks with stderr as reason; other non-zero exits are ignored (fail-open) | `packages/runtime/src/hooks/runner.ts:28-123` |
| Handlers run sequentially; first block wins; `additionalContext` merges | `runner.ts:159-182, 217-229` |
| `UserPromptSubmit` dispatch site | `packages/runtime/src/app-server/turn-handlers.ts:186-197` |
| `Stop` dispatch site; output is ignored | `packages/runtime/src/app-server/server.ts:1053-1082` |
| Plugin/bundled providers additionally get `EntryAppended` (fire-and-forget) | `server.ts:1031-1046`, `tools/bundled-provider.ts:83-93` |
| Plugin SDK documents only the UserPromptSubmit/Stop result contract | `packages/plugin-sdk/src/index.ts:35-73` |
| Core has a synchronous, failure-isolated in-process hook API (`restore`, `onPromptStart`, `beforeTurn`, `onToolResult`, `afterTurn`) that cannot block or rewrite tool input | `packages/core/src/agent/loop-hooks.ts:41-49` |

## Reference survey

- **codex** — 14 events: `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `SessionStart`,
  `SessionEnd`, `UserPromptSubmit`, `SubagentStart`, `SubagentStop`, `Stop`, `Interrupt`, `PreModelRequest`,
  `PostModelRequest` (`codex-rs/protocol/src/protocol.rs:1831-1846`). Matcher: empty or `*` = all; `[A-Za-z0-9_|]+` =
  exact alternatives split on `|`; anything else is a regex (`hooks/src/engine/matcher.rs`). Default timeout 600 s,
  `SessionEnd` 1 s. Handlers run concurrently, results reported in configured order. Exit 2 with non-empty stderr
  blocks; `updatedInput` is honored only when nothing blocked and the decision is `allow`
  (`hooks/src/events/pre_tool_use.rs`, `engine/output_parser.rs:121-200`).
- **oh-my-pi** — ~45 in-process extension events. `tool_call` handlers run sequentially; first `block:true`
  short-circuits; `input` is last-wins; a handler timeout (30 s) or throw becomes a **block** (fail-closed)
  (`extensibility/extensions/runner.ts:149-173`, around `:2330-2380`).

## Design

### Event set

Phased so that the highest-value, lowest-ambiguity events land first.

| Phase | Event | Fires | Can block | Can modify |
|---|---|---|---|---|
| A | `PreToolUse` | after argument validation, before the tool's own approval request | yes | tool input (`updatedInput`) |
| A | `PostToolUse` | after the tool returns, before executor truncation | no (side effect already happened) | appends `additionalContext` to the model-visible result |
| A | `SessionStart` | thread start and resume (`source: "startup" \| "resume" \| "fork"`) | no | `additionalContext` injected once as internal context |
| A | `SubagentStart` / `SubagentStop` | collab child spawn / final status | Start: yes (spawn fails with reason) | Start: `additionalContext` for the child |
| B | `PreCompact` / `PostCompact` | around automatic and manual compaction (`trigger: "auto" \| "manual" \| "overflow"`) | Pre: yes for `manual` only | Pre: `additionalContext` passed to the summarizer |
| B | `PermissionRequest` | when the permission engine returns `prompt`, before a client is asked | yes (deny) | may answer `allow`/`deny` (see "Authority" below) |
| B | `SessionEnd` | thread dispose / server shutdown; 2 s budget | no | no |
| B | `Interrupt` | `turn/interrupt` accepted | no | no |
| C | `PreModelRequest` / `PostModelRequest` | around each provider call; observe-only, no message bodies by default | no | no |

`UserPromptSubmit` and `Stop` keep their exact current semantics.

### Config

Add an optional `matcher` to the existing handler shape instead of introducing a nested `{matcher, hooks[]}` form, so
every existing config stays valid:

```jsonc
"hooks": {
  "PreToolUse": [
    { "type": "command", "matcher": "bash|apply_patch", "command": "~/.diligent/hooks/guard.sh", "timeout": 5 },
    { "type": "command", "matcher": "^mcp__github__", "command": "audit-log", "mode": "async" }
  ]
}
```

- Matcher semantics follow codex exactly (empty/`*` all; `[A-Za-z0-9_|]+` exact alternatives; otherwise an anchored
  JS `RegExp`). An invalid regex fails config validation for that layer, not at dispatch time.
- `matcher` is valid on `PreToolUse`, `PostToolUse`, `PermissionRequest` (tool name) and `SubagentStart/Stop`
  (agent type). Zod `superRefine` rejects it elsewhere.
- New optional `onError: "ignore" | "block"` (default `"ignore"`, preserving today's fail-open). `"block"` turns a
  timeout, spawn failure, or non-0/non-2 exit into a block for blocking events — the policy-hook setting.

### Input payload

Every event carries the current base fields (`session_id`, `transcript_path`, `cwd`, `hook_event_name`,
`permission_mode`, `user_id`) plus:

| Event | Additional fields |
|---|---|
| `PreToolUse` | `turn_id`, `tool_name`, `tool_use_id`, `tool_input`, `agent` (`{thread_id, nickname, depth}` for children), `parent_tool_use_id` (code-mode nested calls) |
| `PostToolUse` | the above + `tool_output` (full, untruncated; capped at 1 MiB in the payload with `tool_output_truncated: true`), `is_error` |
| `SessionStart` | `source` |
| `SubagentStart/Stop` | `agent_type`, `nickname`, `child_session_id`, `status` (Stop) |
| `PreCompact/PostCompact` | `trigger`, `tokens_before`, `tokens_after` (Post) |
| `PermissionRequest` | `tool_name`, `permission`, `subject` (path/command), `details` |

### Output contract

Exit codes are unchanged: `0` parses stdout, `2` blocks with stderr, anything else follows `onError`. JSON stdout:

```jsonc
{
  "decision": "block" | "allow",          // existing legacy field; "allow" is a no-op except for PermissionRequest
  "reason": "string",
  "additionalContext": "string",
  "hookSpecificOutput": { "updatedInput": { /* PreToolUse only */ }, "additionalContext": "..." }
}
```

- `updatedInput` is re-validated with the tool's own `parameters` schema (`parseArgs` when present). A schema failure
  becomes a block with reason `hook returned invalid input: …` so a broken hook never runs a tool with junk.
- Unknown top-level keys are ignored (forward compatibility), matching current tolerant parsing.

### Dispatch semantics

- **Sequential in configured order**, shell handlers before plugin handlers (current `runCombinedHooks` order).
  Codex runs concurrently; sequential is kept because `updatedInput` must chain deterministically — each handler sees
  the input produced by the previous one.
- First block short-circuits. `additionalContext` concatenates in order.
- `mode: "async"` handlers are always non-blocking and receive the final (post-update) input.

### Where `PreToolUse`/`PostToolUse` run

Two options were considered:

1. Extend core `runToolCalls`/`executeTool` with an async interceptor.
2. **Chosen:** a runtime decorator `withToolHooks(tool, dispatcher)` applied once at registry assembly
   (`buildDefaultTools` and the plugin/MCP providers). It wraps `execute(args, ctx)`.

The decorator covers direct calls, code-mode nested calls (they resolve the same registry), plugin tools, and MCP
tools without changing the core contract, and keeps hooks a runtime concern as `ARCHITECTURE.md` requires. The
decorator runs **after** `executeTool` argument validation and **before** the tool body, so it fires before the tool's
own `requestToolApproval` call; a hook block therefore never shows an approval prompt.

A `PreToolUse` block returns `{ output: "Blocked by hook: <reason>", metadata: { error: true, blockedBy: "hook" } }`
and does **not** call `ctx.abort()`: the model sees the reason and can adapt. This differs from a user rejection, which
ends the turn today (`tools/bash.ts:77-83`). Repeated hook blocks feed the denial breaker (doc 10).

### Authority (`PermissionRequest`)

A `PermissionRequest` hook answering `allow` would let a script auto-approve writes. That is useful for CI but is an
authority grant, so it is honored only when the handler is defined in the **global** config layer. Project-layer
`PermissionRequest` hooks may only `deny`. `PreToolUse` `"allow"` never bypasses approval.

### Plugin SDK

Add `onPreToolUse`, `onPostToolUse`, `onSessionStart`, `onSubagentStart`, `onSubagentStop` (phase A) to the plugin
module contract and `BundledToolProvider`, with typed inputs/results exported from `@diligent/plugin-sdk`. Plugin
handlers inherit the same timeout (`mode` and a new optional `timeoutMs` on the function object).

### Observability

Each blocking or modifying hook run logs `hook_run` via `@diligent/logging` with event, matcher, duration, outcome.
No protocol notification is added in phase A; the observable effect (block reason, injected context) already reaches
clients through the tool result.

## Risks

- **Project-config hooks run arbitrary commands.** This is already true for `UserPromptSubmit`, but `PreToolUse`
  fires on every tool call, which makes a hostile repository's `.diligent/config.jsonc` far more effective. **Decision
  deferred** (README decision 1); phase A does not start until it is made. Options: restrict hooks to the global
  layer, or a one-time per-project trust prompt stored in global config keyed by the project root's real path
  (recommended).
- **Latency.** A 10 s default on every tool call is too long; recommended `PreToolUse` default 5 s.
- **Sandbox escape** (doc 05): a sandboxed command that can write `.diligent/config.jsonc` can plant an unsandboxed
  hook. The sandbox must mark `.diligent/` read-only.

## Tests

- `packages/runtime/test/hooks/runner.test.ts`: matcher grammar (exact list, regex, `*`), chained `updatedInput`,
  `onError: "block"` on timeout, invalid `updatedInput` → block.
- `packages/runtime/test/hooks/tool-hooks.test.ts`: the decorator blocks before approval is requested (approval spy
  never called), `PostToolUse` sees untruncated output, code-mode nested calls fire with `parent_tool_use_id`.
- `packages/e2e/app-server/hooks-pre-tool-use.test.ts`: over JSON-RPC, a blocking hook yields a tool item with the
  block reason and the turn continues.

## Rollout

Phase A behind no flag (new events are opt-in by configuration). Document in a new `docs/guide/hooks.md`.
