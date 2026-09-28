# Studio change collector: RAM history and session markers

Date: 2026-09-28

Ticket: OVDR-15373

Branch: `feat/ovdr-15373-studio-change-collector`

Baseline: `main` at `3f4d3ab5`

Status: Written design awaiting user review; implementation has not started.

## Intent and agreed constraints

Replace per-session consumption and disk archival of Studio edit logs with one
background collector in the agent host process. Multiple main sessions must see
the same external changes independently, without deleting another session's
unread history. A session must not confuse its own descendants' edits with an
external author's edits.

The user selected RAM-only retention. No new database, archive files, or cursor
files are created. Losing unreported history on process exit or bounded eviction
is acceptable, provided the agent receives an explicit instruction to inspect
current Studio state instead of assuming its previous state is current.

The collector polls approximately once per second. Authorship remains the actual
executing session ID; root-session grouping is an internal agent concern. No
Studio engine schema change is required. Existing bounded summaries, paginated
details, and the shared Web/TUI context presentation remain available.

## Why this approach

Keeping source logs until every consumer catches up makes abandoned sessions a
retention problem and couples file cleanup to session delivery. A persistent
database would improve restart recovery but adds storage and migration work the
user explicitly declined. A bounded process-local journal separates collection
from delivery and matches the accepted recovery mechanism: re-read Studio state.

## Current behavior and relevant defects

- `studiorpc/index.ts` has provider-wide mutable `turnState`. Each main prompt
  replaces its session ID and snapshot state. Concurrent main sessions and
  inherited child tool objects can therefore use another main's RPC identity.
- `studio-changes-tool.ts` rotates source logs on prompt submission, archives
  envelopes to disk, and finalizes deletion before returning the loop injection.
  One consumer can remove the source another consumer has not observed.
- `studio-change-store.ts` persists batches under the product namespace's
  `logs/studio-changes` directory. This is not the proposed RAM storage model.
- `edit-log.ts` accepts concatenated JSON and currently ignores incomplete
  trailing objects. Background consumption cannot silently delete that tail.
- Child tools reuse parent tool objects. Binding an ID only when tools are
  constructed does not establish the identity of the session executing them.

These observations describe the checked-out baseline, not the pending
`feat/ovdr-15298-snapshot-context` worktree. That separate work overlaps execution
context and snapshot handling; it will not be merged or modified by this task.

## Ownership and lifecycle

A sidecar-owned `StudioChangeCollector` owns ingestion, RAM history, consumer
markers, bounded batch descriptors, and source-file retry state. A process-local
registry keyed by canonical project directory shares it across bundled tools and
hosted MCP entry points. Sessions and individual tool objects never create their
own polling timers or consume source files directly.

Start collection when the owning product host is initialized, with an immediate
poll followed by one-second polling. Serialize polls and explicit refreshes;
never overlap them. Shutdown stops scheduling, waits for an in-flight poll to
settle, and clears collector resources. Timers must not keep tests or a stopped
host alive. Lifecycle tests use an injected scheduler, not real one-second waits.

This design supports multiple sessions inside one owning process. It does not
implement cross-process broadcasting. Independently running sidecar processes
for the same Studio project must not be represented as sharing this RAM history.
Standalone MCP integrations without an agent execution context do not silently
inherit a main session's identity or take ownership from an existing host.

## RAM model and proposed bounds

The following defaults are proposed for written-spec approval. They are internal
limits, not new user-facing configuration fields.

| State | Proposed limit | Overflow behavior |
| --- | --- | --- |
| Retained journal | 16 MiB encoded payload and 10,000 records | Evict oldest records; advance retained floor |
| One input file read | 8 MiB | Record a gap before deliberately discarding oversized input |
| Source backlog | 64 MiB of recognized inputs | Discard oldest inputs until below cap, recording a gap |
| Consumer markers | 4,096 entries | Evict least recently used inactive entries |
| Session/group identities | 4,096 entries | Evict inactive entries; unknown authors remain visible |
| Detail batch descriptors | 256 entries | Evict oldest descriptors; expired IDs return an error |
| Source retry entries | 256 entries | Defer additional inputs without ingesting them |
| Inputs processed per poll | 4 files | Continue remaining work on subsequent polls |

Byte limits account for encoded payload, not the process's exact RSS. Parsed
objects, runtime overhead, and one bounded input buffer consume additional RAM.
Count limits bound metadata growth; batch descriptors reference journal ranges
and never copy entire batches. Retry bookkeeping refers only to recognized source
files and is removed after successful deletion or deliberate discard.

If a consumer or identity map is full and every entry is active, reject new
state admission with an explicit capacity notice rather than growing the map or
evicting a currently executing session. Unknown-origin records remain external.
Root snapshot state is request-scoped and released after the request and its
participating child operations finish; it is not an additional history cache.

Journal records contain a process-local monotonic `seq`, an edit envelope or gap
notice, byte cost, and a resolved root author when known. Keep the original
`Origin.SessionId` unchanged. `retainedFloor` identifies the oldest available
sequence; a process epoch distinguishes batches from a prior process lifetime.

Consumer markers are a RAM map keyed by actual consuming session ID. Main
sessions are independent consumers. A child that explicitly queries changes has
its own marker and never advances its parent's marker. A separate session-to-root
map supports filtering; it is not a delivery cursor.

There is no waiting for all consumers before eviction. If a marker is evicted or
falls behind the retained floor, the next read reports a gap. Retain resolved
author roots on journal records so identity-cache eviction does not reinterpret
already classified records. If an origin cannot be safely resolved, retain the
record rather than suppressing it as an own edit.

## Collection and source deletion

1. Discover only the project-root `Edit.Log` name, case-insensitively, and precisely
   recognized rotation names created by this collector or the previous reader.
   Do not delete arbitrary files merely because they end in `.consuming`.
2. Rotate the live file using the existing rename boundary. Read recognized
   rotated files, not a mutable live path. Check size before allocating a buffer.
3. Decode the existing UTF-8/UTF-16 formats and parse concatenated JSON with
   distinct outcomes for complete records, malformed records, and an incomplete
   tail. Preserve record occurrence and source order; identical transactions are
   not deduplicated merely because their JSON hashes match.
4. Append complete envelopes to RAM before deleting their source. For an input
   with an incomplete tail, preserve the rotated file and remember its consumed
   prefix so later polls do not append that prefix twice. Retry the tail; do not
   call truncation a successful parse. Malformed input produces a visible gap
   notice. Delete malformed input only after that notice is recorded.
5. After successful ingestion, remove the exact recognized source path. If
   deletion fails, retry deletion without ingesting its records again. A read or
   rename failure preserves the source for retry and reports collector health;
   it must not be converted to a silent empty result.
6. Oversized input and excessive source backlog are deliberate bounded-loss
   cases. Store a gap notice first, then remove only the validated source files.
   Gap state must survive journal eviction through the retained-floor check.

Rotating assumes Studio writes finalized transactions through reopened log
handles, as the existing reader expects. Incomplete-tail tests must simulate a
writer appending to an already-rotated file before completion. This task does not
claim transactional guarantees for writers that append new transactions to an
unlinked handle indefinitely; that would require a Studio-side handoff protocol.

## Actual execution identity and snapshot isolation

Add a generic runtime session-execution scope backed by async-local storage.
`SessionManager` establishes the actual session ID and its root ownership for
each run. A child establishes a new scope with its own actual ID while retaining
the root identity. Resume obtains ancestry from session metadata, not the last
main prompt or ambient context of another session.

Studio RPC resolves `meta.sessionId` from this execution scope at invocation
time. A main A sends A, child A1 sends A1, and main B sends B even if their calls
interleave. A call without a runtime identity omits the agent session metadata;
it never falls back to provider-wide `turnState.sessionId`.

Replace provider-wide turn state with root-scoped request snapshot state.
Children may intentionally share their root's rollback baseline, while another
root has an independent baseline, prompt label, and capture result. Existing
snapshot failure and request rollback behavior must remain covered by tests.
Keep shared identity plumbing product-agnostic in runtime; Studio collection and
filtering remain in the sidecar, with no Studio imports in core.

## Reading, filtering, and marker advancement

A read captures a fixed high-water sequence. Subsequent collected records belong
to the next read. Filter only explicit `mcp` records whose known root author is
the consumer's root. Never label every non-own record as human: unknown, legacy,
mixed, and other MCP origins are external context with their original origin.

Automatic injection is main-only. Its hook reads the RAM range before a sampling
round, summarizes within the existing output limits, and prepares a batch ID.
It must not advance the marker merely because `beforeTurn` returned an injection.

Use a generic runtime acceptance helper that associates an injection's opaque
metadata object with an idempotent in-process callback in a `WeakMap`. Core
already forwards that metadata object unchanged. When `RuntimeAgent` receives
`context_injected`, the messages have already been added to its conversation;
the helper acknowledges the high-water sequence. Callback registration introduces
no serialized functions, protocol fields, disk receipts, or Studio branching in
core. A canceled or rejected injection does not acknowledge its marker.

Acceptance means inclusion in live session context, not proof that an LLM read
or acted on the notice, and not crash-safe delivery. Advancing across a range
containing only own-group records needs no visible notice. A gap notice is always
injected even when no surviving external edits remain.

An explicit `view="new"` query refreshes through the same collector and advances
only the executing consumer's marker after constructing its successful result.
This means successful tool execution, not proof of model comprehension. A failed
query does not advance it. `view="details"` does not advance any marker. Automatic
reads and queries use monotonic acknowledgment so overlapping captures cannot
move a marker backward or acknowledge beyond their captured high-water sequence.

## Details, restart behavior, and presentation

Keep the existing tool name, summary byte budgets, GUID/change-type filters, and
offset/limit pagination. Batch IDs identify bounded RAM range descriptors plus
the process epoch. Pagination fixes the original consumer filtering and high-water
range; later records do not alter an existing page sequence.

Remove new disk writes and misleading `archivePath` metadata/text. Explain that
full details are retained temporarily in RAM. An explicit unknown, evicted,
partially evicted, or prior-process batch ID returns an actionable expiration
error; it never falls back to the latest unrelated batch. Without an explicit
ID, details use that consumer's latest valid captured batch, or say none exists.
Old archives on disk remain untouched; this task does not delete user files.

The first read of an existing session after process startup reports that RAM
history is unavailable and Studio state should be refreshed. A genuinely new
session begins at the currently retained floor, can inspect retained external
changes, and receives a loss warning if collection has already discarded history.
Marker eviction is also a loss of delivery state, not permission to silently
assume the session is caught up.

Reuse the shared `studio-changes` context presentation for Web and TUI, including
gap-only notices. No client-specific collection logic or separate goal machinery
is introduced.

## Verification and implementation boundaries

Write behavior tests first in package-level `test/` directories:

- Two main sessions independently see the same external edit; reading A does not
  consume B's range. New polls do not repeat an acknowledged range.
- A and A1 exclude their group; B sees A1's edit. A child's explicit query leaves
  A's marker unchanged. Unknown and legacy origins remain visible.
- Interleaved A, A1, and B RPC calls carry their actual IDs; direct MCP calls carry
  no inherited ID. Root snapshot state remains isolated across concurrent runs.
- Collection, acknowledgment, and detail pagination have distinct side effects.
  Canceled injections and failed tool queries leave unread markers intact.
- Bounds evict abandoned consumers/history without unbounded metadata growth;
  gaps and expired batch IDs are observable even with no remaining edit records.
- Incomplete UTF-8/UTF-16 input, malformed data, read/delete failures, retry
  deduplication, oversized files, and strict source-name filtering are exercised.
- Start/stop and serialized polling leave no live timers or overlapping reads.
  Existing summary output limits and Web/TUI notices remain valid.

Primary sidecar files are `studiorpc/index.ts`, `rpc.ts`, `tools/edit-log.ts`,
`tools/studio-changes-tool.ts`, `tools/studio-change-store.ts`, a new collector
module, and owning host startup/shutdown paths. Generic runtime work is confined
to session execution identity, session lifecycle wiring, and injection acceptance.
Tests that inspect collector maps or runtime internals stay with their package;
only public JSON-RPC/client-observable scenarios belong in `packages/e2e/`.

Baseline local verification passed 46 existing Studio change/origin/RPC tests.
This is not evidence for the new design. After implementation, run the affected
sidecar and runtime suites, local integration checks, lint, and typecheck before
committing product changes. Jira remains In Progress. Push and PR creation require
the user's separate approval under the `ovdr-task` workflow.

## Review handoff

Written-spec approval is required before the implementation plan. The plan must
identify concrete test-first steps and an execution method before product code
changes begin. Review particularly the proposed caps, single-owner process scope,
source-loss warnings, and actual-context acceptance boundary.
