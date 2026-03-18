---
id: P056
title: Thread read items-only cutover and fallback retirement
type: refactor
status: in_progress
owner: diligent
created: 2026-03-18
---

# Summary

This plan merges two pending directions into one execution track:

1. converge `thread/read` to an items-first, server-completed snapshot contract
2. retire Web/CLI legacy hydration fallbacks (`messages` / `transcript` parsing)

The core rule is simple:

> Clients should render from protocol `items` and live item lifecycle notifications, not reconstruct display state from raw message history.

This is the concrete follow-through after adapter unification and thread item snapshot introduction.

# Progress snapshot (2026-03-18)

Completed in this iteration:

1. `thread/read` hydration contract for first-party clients is now items-first in production paths.
2. Web and CLI legacy hydration branches that depended on `thread/read.messages` / `thread/read.transcript` were removed.
3. Protocol `ThreadReadResponse` removed legacy `messages` and `transcript` fields.
4. Runtime no longer populates legacy `thread/read` fields.
5. Regressions for running-state settling and resume hydration were covered and validated by full test runs.

Still remaining after this iteration:

1. Decide whether and when to retire `childSessions` from `thread/read`.
2. If `childSessions` is retired, enrich snapshot items so collab UI can render equivalent detail without child-session payload.
3. Publish explicit breaking-change migration notes for third-party clients relying on removed legacy fields.
4. Optional cleanup pass: remove now-unused compatibility comments and any stale references in docs/release notes.

# Why this plan now

Recent regressions showed the cost of transitional dual paths:

- running/idle state drift when event mapping bridges are incomplete
- resume history gaps when one client expects `items` while another still depends on `messages`

As long as both item and legacy hydration contracts remain active, regressions can reappear in different combinations.

This plan removes that ambiguity by defining one canonical thread-read contract and one removal sequence.

# Goals

1. Make `thread/read.items` the only required hydration payload for first-party clients.
2. Ensure server sends display-complete semantics (no client-side transcript interpretation requirement).
3. Remove Web and CLI fallback parsing paths in a controlled order.
4. Remove legacy `thread/read` fields from protocol once all first-party consumers are migrated.
5. Keep live and resume behavior semantically identical for user-visible thread state.

# Non-Goals

1. Redesign session persistence format.
2. Introduce frontend-specific snapshot DTOs.
3. Change tool render payload schema version in this plan.
4. Keep indefinite backward compatibility for pre-items clients.

# Canonical target contract

## Thread read (target)

`thread/read` should be treated as a display snapshot API:

- required: `items`
- required: thread execution metadata (`isRunning`, `currentEffort`, `currentModel`, etc.)
- optional transitional/debug only: `messages`, `transcript`, `childSessions` (to be removed)

## Live stream alignment

Live notifications must remain reducible into the same client state model as `thread/read.items` hydration:

- thread status notifications (`busy`/`idle`) are authoritative for running UI state
- item lifecycle notifications (`item/started`, `item/delta`, `item/completed`) are authoritative for stream rendering
- `agent/event` remains for bounded event types that are not represented as item lifecycle payloads

## Server ownership boundary

Runtime/app-server owns transformation from persistence/runtime internals to display-level protocol items.
Clients own presentation only.

# Execution plan

## Phase 0 — Guardrails before removal

1. Lock explicit invariants in tests:
   - `turn/completed` + `thread/status/changed(idle)` always clears running state in Web and CLI
   - resume hydrates user/assistant/tool history from `items`
2. Add/keep compatibility tests proving temporary fallback behavior while migration is in progress.
3. Freeze public migration note in changelog/plan references.

Exit criteria:

- status/running regressions are test-covered in both clients
- resume/hydration regressions are test-covered in both clients

## Phase 1 — Make items contract strict in runtime

1. Ensure `handleThreadRead` always returns non-empty semantic `items` when transcript exists.
2. Audit runtime item builder to ensure all first-party render-critical semantics are encoded in items:
   - user messages
   - assistant messages (text/thinking/duration)
   - tool lifecycle with final render payload
   - compaction entries
   - collaboration summary events used in timeline UI
3. Keep legacy fields but mark them transitional in protocol comments/docs.

Exit criteria:

- no first-party feature requires reading `messages`/`transcript` for normal hydration
- all existing resume/live E2E tests pass with items as primary source

## Phase 2 — Remove fallback hydration in Web and CLI

### 2A. Web

1. Remove `getDisplayMessages(payload.transcript ?? payload.messages)` path.
2. Remove legacy transcript/message parsing branches in `thread-hydration.ts`.
3. Keep only `items`-based hydration logic.
4. Preserve reducer behavior for status/turn boundary notifications.

### 2B. CLI

1. Remove resume fallback that hydrates from `thread.messages`.
2. Keep resume hydration exclusively items-based.
3. Keep explicit `thread/status/changed` → `status_change` bridge in controller.

Exit criteria:

- Web/CLI hydrate exclusively from `items`
- no client code path parses `thread/read.messages` or `thread/read.transcript` for UI hydration

## Phase 3 — Protocol and runtime legacy field retirement

1. Remove optional legacy fields from `ThreadReadResponse` schema:
   - `messages`
   - `transcript`
   - (optionally) `childSessions` if fully represented by items for first-party usage
2. Remove runtime population of deleted fields.
3. Update all affected tests (runtime/web/cli/e2e) to assert items-only payloads.
4. Publish breaking-change note for third-party clients.

Exit criteria:

- protocol types encode items-only thread hydration contract
- runtime no longer computes or sends legacy hydration fields

## Phase 4 — Legacy path sweep and hardening

1. Repository-wide grep sweep for legacy thread hydration usage patterns:
   - `payload.messages` in hydration contexts
   - `payload.transcript` in hydration contexts
   - transcript-to-render reconstruction helpers no longer used
2. Remove dead helpers and stale comments.
3. Run full suite and protocol lifecycle E2E.

Exit criteria:

- no production first-party code depends on legacy thread-read hydration fields
- full tests green

# File-level worklist

## Runtime / Protocol

- `packages/runtime/src/app-server/thread-handlers.ts`
- `packages/protocol/src/client-requests.ts`
- related runtime tests under `packages/runtime/test/app-server/`
- protocol lifecycle E2E under `packages/e2e/`

## Web

- `packages/web/src/client/lib/thread-hydration.ts`
- `packages/web/src/client/lib/thread-store.ts`
- `packages/web/test/client/lib/thread-store.test.ts`

## CLI

- `packages/cli/src/tui/app-session-lifecycle.ts`
- `packages/cli/src/tui/app-event-controller.ts`
- `packages/cli/test/tui/*.test.ts` (resume/status regression coverage)

# Risk analysis

## Risk 1: resume regression for old sessions

If items builder misses an edge case, older sessions may hydrate partially.

Mitigation:

- complete phase-1 item completeness tests before phase-2 fallback removal
- include fixture sessions with compaction, tools, and collab events

## Risk 2: running status drift

If status bridge logic is removed or bypassed, UI can remain busy after completion.

Mitigation:

- explicit controller-level tests for `thread/status/changed`
- integration tests asserting final idle status after `turn/completed`

## Risk 3: third-party client breakage

Removing legacy fields is a protocol breaking change.

Mitigation:

- perform removal only in phase 3 after first-party clients are fully migrated
- communicate break in release notes with migration guidance

# Rollback strategy

If regressions appear during phase 2 or 3:

1. restore legacy fields in `ThreadReadResponse` schema
2. restore runtime field population in `handleThreadRead`
3. re-enable temporary client fallback hydration path

Rollback is intentionally bounded to migration period only; it is not a long-term dual-contract policy.

# Done criteria

This plan is complete only when all conditions are true:

1. first-party Web and CLI hydrate from `thread/read.items` only
2. runtime computes and returns display-complete items for all first-party thread features
3. protocol no longer exposes legacy hydration fields
4. live and resume rendering are behaviorally aligned in tests
5. no remaining legacy hydration branches in production code

