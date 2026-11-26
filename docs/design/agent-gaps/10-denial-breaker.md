# 10 — Denial sources and the consecutive-denial breaker

Status: proposal · Depends on: none (becomes more important with 01, 05) · Small change

## Problem

Today every denial ends the turn, even when no human was involved, and the model is told "Rejected by user" when a
configuration rule said no. Once hooks (doc 01) and the sandbox (doc 05) return denials that **do not** end the turn,
nothing stops the model from retrying variations of a blocked operation indefinitely.

## Current state

| Fact | Evidence |
|---|---|
| A permission rule `deny` returns `"reject"` from `requestApproval` — the same value as a user rejection | `packages/runtime/src/app-server/server.ts:668-674` |
| Every writing tool answers `"reject"` with `ctx.abort()` and `[Rejected by user]` | `tools/bash.ts:77-83`, `tools/edit.ts:152-154, 211-213, 319-320`, `tools/write.ts:40, 117`, `tools/apply-patch.ts:168`, `tools/request-user-input.ts:63` |
| `ctx.abort()` aborts the loop's tool controller, ending the turn | `packages/core/src/agent/loop.ts:74-75, 197` |
| The approval protocol response is `once | always | reject` | `packages/protocol/src/data-model.ts:497` |

Consequence: a project rule `{permission: "execute", pattern: "git push **", action: "deny"}` makes the agent stop
mid-task with a message blaming the user, instead of letting it continue without pushing.

## Reference survey

**hermes-agent** `tools/approval.py:59-118`: per-session counter of consecutive denials (`_denial_tally`, bounded to
256 sessions, LRU); reset on any approval; threshold `approvals.denial_breaker_threshold` (default 3, ≤ 0 disables).
At the threshold, an escalation sentence is appended to the tool result: "CIRCUIT BREAKER: N consecutive commands were
blocked … STOP attempting variations of this operation. Report the blocked operation to the user …". Only the tool
result text changes — no history edits, no interrupts — so the prompt cache stays valid (comment at `:65`). Errors of
the reviewing component are not counted (`:1166`).

## Design

### Denial sources

Make the source explicit inside the runtime; the wire protocol does not change.

```ts
// packages/runtime/src/tools/capabilities.ts
type ApprovalOutcome =
  | { decision: "once" | "always" }
  | { decision: "reject"; source: "user" | "policy" };

requestToolApproval(host, request, options): Promise<ApprovalOutcome>
```

`DiligentAppServer.requestApproval` returns `source: "policy"` for an engine `deny`, `source: "user"` for a client
`reject`. Other denial kinds are produced by their own subsystems: `"hook"` (doc 01 `PreToolUse`), `"sandbox_declined"`
(doc 05 escalation rejected).

One helper replaces the duplicated reject branches in every tool:

```ts
function denialResult(ctx, toolName, outcome, render?): ToolResult
```

| Source | Ends turn | Model-visible text |
|---|---|---|
| `user` | yes (unchanged) | `[Rejected by user]` |
| `policy` | **no** | `Denied by permission rule "<pattern>" (<permission>). Do not retry this operation or variations of it; continue without it or tell the user.` |
| `hook` | no | `Blocked by hook: <reason>` |
| `sandbox_declined` | no | sandboxed output + `Running outside the sandbox was declined.` |

### Breaker

Per thread (children have their own), in memory:

- Count consecutive non-user denials (`policy`, `hook`, `sandbox_declined`). A user rejection ends the turn, so it
  needs no breaker.
- Reset on any tool call that passed approval/hook checks and executed.
- At `threshold` (config `permissions.denialBreakerThreshold`, default 3, `0` disables): append the escalation
  sentence to the tool result (hermes wording adapted; result-text only, prompt-cache safe).
- At `2 × threshold`: return the denial and end the turn (`ctx.abort()`), with a `turn/completed` reason the clients
  can show ("stopped after repeated blocked operations"). Goal threads pause with a new reason
  `repeated_denials` instead of continuing.

### Protocol

None required for the breaker itself. The tool item's metadata gains `denial: { source, consecutive }`, which clients
may use to style blocked calls. A new goal pause reason value `repeated_denials` is a protocol addition and needs both
clients' goal UIs updated.

## Behavior change and migration

**Decided:** policy denials no longer end the turn. This is the intended fix, but configurations that relied on "deny = stop"
behave differently: the agent continues without the denied operation. Called out in the changelog; users who want a
hard stop set `denialBreakerThreshold: 1`, which ends the turn at the second consecutive denial.

## Tests

- `packages/runtime/test/approval/denial-breaker.test.ts`: counts across sources, resets on an executed call, threshold
  0 disables, `2 × threshold` aborts.
- `packages/runtime/test/tools/bash.test.ts`: policy deny returns the rule text and does not abort; user reject still
  aborts.
- `packages/e2e/app-server/policy-deny.test.ts`: a deny rule over JSON-RPC yields a tool item with the rule text and the
  turn continues to `turn/completed`.

## Wave 1 implementation notes

Shipped on `fix/policy-deny-continues`. Differences from the design above:

- `RuntimeToolHost.approve` keeps returning `ApprovalResponse` because product tools compare it with `"reject"`; a new
  optional `approveWithOutcome` carries the source, and `createRuntimeToolHost` builds both from one handler.
  `CreateAgentArgs.approve` and collab deps now pass the outcome handler.
- The count is per root thread and shared with its children, because child approvals route through the parent thread.
  It resets on any allowed approval and at the end of each turn.
- Config key: `approvals.denialBreakerThreshold` (`permissions` is already a rule array).
- No new goal pause reason. At twice the threshold the tool aborts the turn, and goal mode pauses as it does for any
  interrupted run.
- MCP tools keep letting the turn continue after a user rejection, as before; only rule denials use the new text.
- Tests: `packages/runtime/test/tools/approval-denial.test.ts`, `packages/runtime/test/approval/engine.test.ts`
  (`decidingRule`), `packages/e2e/app-server/permission-denials.test.ts`.
