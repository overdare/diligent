---
id: P056
title: Thread read items-only cutover and fallback retirement
type: refactor
status: done
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

# Progress snapshot (2026-03-20)

Completed in this iteration:

1. `thread/read` hydration contract for first-party clients is now items-first in production paths.
2. Web and CLI legacy hydration branches that depended on `thread/read.messages` / `thread/read.transcript` were removed.
3. Protocol `ThreadReadResponse` removed legacy `messages` and `transcript` fields.
4. Runtime no longer populates legacy `thread/read` fields.
5. Regressions for running-state settling and resume hydration were covered and validated by full test runs.
6. `childSessions` was removed from protocol `ThreadReadResponse` and runtime `thread/read` payload population.
7. Phase 4 direction is now fixed: parent snapshots do not embed child thread detail; collab detail loads via explicit child `thread/read` requests.
8. Web collab detail expansion now loads child thread detail on demand via explicit `thread/read({ threadId: childThreadId })`.
9. Web collab expansion now includes per-child-thread in-session caching plus inline loading/error/retry states.
10. Web hydration/tests were updated to remove parent `childSessions` dependency and keep items-only hydration contract.
11. CLI assumptions were swept to keep parent snapshot independent from embedded child-session payloads.

Still remaining after this iteration:

1. Publish explicit breaking-change migration notes for third-party clients that previously consumed `thread/read.childSessions`.
2. Optional cleanup pass: remove now-unused compatibility comments and any stale references in docs/release notes.

# Decision record — `childSessions` is replaced, not formalized

This plan now explicitly resolves the long-running Phase 4 ambiguity:

- `childSessions` is not part of the permanent items-only `thread/read` contract.
- The replacement is explicit child-thread reads for expanded collab detail, not richer embedded parent payloads.
- Collab items in the parent thread remain identifiers and summaries, not containers for child transcript state.

Why this is the durable choice:

1. it keeps the parent snapshot bounded and predictable regardless of child thread size
2. it preserves the core P056 rule that hydration comes from `items`, not from hidden side payloads
3. it removes ambiguous coupling where collab rendering silently depends on extra parent response fields
4. it lets clients pay for child detail only when the user actually expands that detail

This means future collab work should not reintroduce parent-level embedded child snapshots unless a new protocol plan intentionally reopens that design.

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
- no embedded child-session payloads

## Resolved direction for collab child details

`childSessions` should not remain part of the long-term parent `thread/read` contract.

The chosen direction is:

1. parent `thread/read` returns only parent snapshot items plus thread metadata
2. parent collab items keep only the minimum data needed to identify and label the child thread
3. when the UI expands a collab item and needs child detail, it performs a separate `thread/read({ threadId: childThreadId })`
4. child message/tool/timeline previews are derived from the child thread response, not embedded into the parent response

This keeps the parent snapshot bounded, preserves the items-first contract, and makes child-thread detail an explicit on-demand read rather than hidden payload coupling.

## Minimum collab item contract

To replace `childSessions` cleanly, parent collab items must continue to carry enough metadata for the UI to render collapsed state and decide whether expansion is possible without another discovery step.

Expected parent collab item fields:

- `childThreadId` when a child thread exists
- human-facing labels already emitted in items when available (`nickname`, `description`)
- status-style summary fields already emitted in items when available (`status`, `message`, `agents`, `timedOut`)

Not expected in parent items:

- child tool transcript/history
- child message history
- child timeline/history previews derived from child internals

Those richer details belong to the child thread's own `thread/read` response.

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
   - `childSessions`
2. Remove runtime population of deleted fields.
3. Update all affected tests (runtime/web/cli/e2e) to assert items-only payloads.
4. Publish breaking-change note for third-party clients.

Exit criteria:

- protocol types encode items-only thread hydration contract
- runtime no longer computes or sends legacy hydration fields

## Phase 4 — Legacy path sweep and hardening

Phase 4 is resolved in favor of explicit child-thread reads. The implementation work in this phase is now cleanup and hardening against regressions, not an open design decision.

1. Repository-wide grep sweep for legacy thread hydration usage patterns:
   - `payload.childSessions`
   - child-session summary extraction from parent snapshot payloads
   - collab hydration paths that assume embedded child thread messages in parent `thread/read`
2. Add explicit client-side on-demand child thread reads for collab detail expansion.
3. Remove dead helpers and stale comments.
4. Run full suite and protocol lifecycle E2E.

Exit criteria:

- no production first-party code depends on embedded child-session payloads in parent `thread/read`
- collab detail expansion works via explicit child-thread reads
- full tests green

# File-level worklist

## Runtime / Protocol

- `packages/runtime/src/app-server/thread-handlers.ts`
- `packages/protocol/src/client-requests.ts`
- related runtime tests under `packages/runtime/test/app-server/`
- protocol lifecycle E2E under `packages/e2e/`

Specific work:

- remove `ChildSessionSchema` from `ThreadReadResponse`
- stop calling `readChildSessions()` from parent `handleThreadRead`
- preserve enough collab item metadata for later lookup (`childThreadId`, nickname, description, status)
- document migration: callers needing child detail must issue a separate `thread/read` for the child thread

## Web

- `packages/web/src/client/lib/thread-hydration.ts`
- `packages/web/src/client/lib/thread-store.ts`
- `packages/web/src/client/components/CollabEventBlock.tsx`
- `packages/web/src/client/components/CollabGroup.tsx`
- `packages/web/test/client/lib/thread-store.test.ts`

Specific work:

- remove `payload.childSessions` hydration logic from parent snapshot handling
- stop deriving `childTools`, `childMessages`, and `childTimeline` from parent `thread/read`
- when a collab item with `childThreadId` is expanded, request the child thread explicitly
- cache fetched child thread detail by `childThreadId` to avoid repeated requests during a session
- render loading and error states for expanded collab items without switching the active parent thread
- derive child previews from the fetched child thread's `items`

## CLI

- `packages/cli/src/tui/app-session-lifecycle.ts`
- `packages/cli/src/tui/app-event-controller.ts`
- `packages/cli/test/tui/*.test.ts` (resume/status regression coverage)

Specific work:

- keep CLI hydration independent of parent `childSessions`
- if/when TUI adds expandable child-thread detail, use the same explicit child `thread/read` pattern rather than reviving embedded payloads

# Recommended implementation sequence

1. Remove `childSessions` from protocol and runtime `thread/read` handling.
   - Delete the field from `ThreadReadResponse`.
   - Stop building embedded child-session payloads in parent `handleThreadRead`.
   - Update protocol/runtime tests to assert the reduced response shape.

2. Finalize the minimum collab item metadata that must remain in the parent thread.
   - Keep enough information for discovery and later lookup: `childThreadId`, nickname, description, status, and event summary.
   - Ensure live notifications and hydrated history produce the same collab item shape.

3. Add explicit child-thread reads for Web collab expansion.
   - When a collab item is expanded, request `thread/read({ threadId: childThreadId })`.
   - Keep the parent thread active while filling detail inside the expanded collab block.
   - Include loading, error, and retry behavior.

4. Add Web-side child detail caching and derive previews from fetched child items.
   - Cache child thread responses by `childThreadId` for the current session.
   - Build timeline/message/tool previews from fetched child `items`.
   - Remove the old parent-payload-based child detail derivation.

5. Sweep CLI assumptions and keep the same architecture boundary.
   - Confirm TUI does not depend on parent `childSessions`.
   - If expandable child detail is added later, use the same explicit child-read path instead of embedded payloads.

6. Close with regression coverage and migration notes.
   - Validate items-only hydration, collab expansion behavior, and protocol compatibility expectations.
   - Publish the breaking-change guidance for callers that previously used `childSessions`.

Recommended execution order: `1 → 2 → 3 → 4 → 5 → 6`.

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

## Risk 4: collab detail latency on expand

Moving child detail to on-demand reads introduces a second fetch and visible loading state.

Mitigation:

- keep collapsed collab items informative without extra fetches
- fetch only on explicit expand
- cache child thread detail after the first successful read
- show non-blocking loading/error UI inside the expanded collab block

# Rollback strategy

If regressions appear during phase 2 or 3:

1. restore legacy fields in `ThreadReadResponse` schema
2. restore runtime field population in `handleThreadRead`
3. re-enable temporary embedded child-session hydration path

Rollback is intentionally bounded to migration period only; it is not a long-term dual-contract policy.

# Done criteria

This plan is complete only when all conditions are true:

1. first-party Web and CLI hydrate from `thread/read.items` only
2. runtime computes and returns display-complete items for all first-party thread features
3. protocol no longer exposes legacy hydration fields
4. live and resume rendering are behaviorally aligned in tests
5. no remaining embedded child-session hydration branches in production code
6. collab child detail expansion reads the child thread explicitly instead of relying on parent snapshot payloads

