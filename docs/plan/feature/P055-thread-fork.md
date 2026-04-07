---
id: P055
status: proposed
created: 2026-03-18
decisions: [D089]
---

# P055: Thread Fork Proposal

## Summary

This proposal refines D089 into an implementation-ready design for `thread/fork` in Diligent.

The core recommendation is:

- keep Diligent's current user-facing fork goal
- borrow the validated fork mental model from codex-rs
- adapt it to Diligent's existing append-only JSONL session model
- explicitly avoid over-importing codex-rs complexity that Diligent does not need yet

The result should be a **flat, independent, file-level fork**:

- `thread/fork` creates a new top-level session file
- the fork copies the visible lineage of the source thread
- the fork records `forkedFromId` metadata in the session header
- the fork becomes independently mutable immediately after creation
- the original thread remains unchanged

This is a user-visible "try a different approach from here" operation, not an internal tree-branching primitive.

## Why this needs a deeper proposal

The short D089 decision captured the direction, but several design questions are still open in the current codebase:

1. What exactly is the fork source in a tree-shaped session model that already uses `parentId` internally?
2. Should the copied file include all entries or only the currently visible path?
3. How should collab child sessions interact with fork lineage?
4. How should TUI and Web expose the new fork to users without diverging?
5. Which codex-rs fork semantics should be adopted, and which should be intentionally left out?

This document answers those questions.

## Current Diligent State

Current codebase audit date: **2026-03-27**.

Today Diligent has:

- session headers persisted as the first line of a JSONL file in `packages/runtime/src/session/types.ts`
- append-only session entries persisted through `packages/runtime/src/session/persistence.ts`
- internal branch semantics via `parentId` on entries
- top-level vs child-session distinction via `parentSession` on session headers
- thread lifecycle handlers in `packages/runtime/src/app-server/thread-handlers.ts`
- no protocol method for fork yet
- no fork metadata in protocol `SessionSummary` or `thread/read`
- no TUI or Web fork affordance yet

Concrete current-state notes:

- `packages/protocol/src/methods.ts` has `thread/start`, `thread/resume`, `thread/list`, `thread/read`, `thread/compact/start`, `thread/delete`, `thread/subscribe`, and `thread/unsubscribe`, but no `thread/fork`.
- `packages/protocol/src/client-requests.ts` uses optional `threadId` for thread-scoped operations such as `thread/read`, `thread/compact/start`, `turn/start`, `mode/set`, and `effort/set`.
- `packages/protocol/src/data-model.ts` exposes `parentSession` in `SessionSummary`, but no `forkedFromId`.
- `packages/runtime/src/session/types.ts` is still on `SESSION_VERSION = 8` and `SessionHeader` does not yet include fork ancestry.
- `packages/runtime/src/app-server/thread-handlers.ts` already reconciles idle runtimes from disk before `thread/read`, which is the right precedent for `thread/fork` as well.
- `packages/cli/src/tui/commands/builtin/session.ts` exposes `new`, `resume`, `delete`, and `status`, but no `/fork`.
- `packages/web/src/client/components/Sidebar.tsx` currently exposes open/delete thread actions only.

Important current properties:

### 1. `parentId` is already an internal branch mechanism

`buildSessionContext()` and `buildSessionTranscript()` reconstruct the visible session path by walking backward from a leaf entry through `parentId`.

That means Diligent already has internal branching semantics inside a single session file. But that mechanism is not user-facing thread management.

This distinction matters:

- **internal branch** = entry graph inside one session file
- **thread fork** = new top-level thread listed separately in `thread/list`

The proposal keeps those concerns separate.

### 2. `parentSession` is already used for collab child sessions

`parentSession` in the session header currently means "this session is a child session spawned by collaboration". `thread/list` hides these by default unless `includeChildren` is requested.

This means `parentSession` must **not** be reused for thread fork ancestry. Doing so would incorrectly classify forks as child sessions and make them disappear from the default top-level thread list.

### 3. Session metadata already has room for top-level lineage

The session header is the correct place to store fork ancestry, because fork provenance is a property of the thread file itself, not of a single entry.

## Codex-RS Reference: What matters

The checked-in codex-rs reference confirms the following useful patterns:

### What codex-rs does

- `thread/fork` is a first-class thread lifecycle operation
- forking creates a **new thread id** with copied history
- the caller is auto-subscribed to the new thread
- the server emits `thread/started` for the forked thread
- the fork is independent after creation
- codex-rs supports both persistent forks and `ephemeral: true` in-memory forks
- codex-rs can fork from a selected branch point by truncating history before the nth user message

Concrete upstream references consulted during planning:

- `codex-rs/app-server/README.md`
- `codex-rs/app-server-protocol/schema/typescript/v2/ThreadForkParams.ts`
- `codex-rs/app-server/src/codex_message_processor.rs`
- `codex-rs/core/src/thread_manager.rs`
- `codex-rs/core/tests/suite/fork_thread.rs`

### What we should adopt from codex-rs

1. **Fork is a lifecycle operation, not a hack around resume/start**
2. **Fork creates a fresh top-level thread identity**
3. **Forked history is copied, not lazily linked**
4. **The fork request should activate the new thread immediately**
5. **The fork notification should reuse existing thread lifecycle semantics**

### What we should not adopt yet

1. **Ephemeral forks**
   - Diligent does not currently have a broader ephemeral thread model.
   - Adding it just for fork would widen scope without solving the primary user need.

2. **Full execution-config override surface on fork**
   - codex-rs lets callers override model, cwd, approval policy, sandbox, config, and instructions during fork.
   - Diligent does not need that on day one.
   - In Diligent, model/mode/effort can already be changed after fork through existing APIs.

3. **User-message-index branch-point selection**
   - codex-rs supports truncating before the nth user message.
   - Diligent currently has no user-facing rollback or turn-index selection model.
   - Introducing index-based branch selection before `thread/rollback` lands would create an awkward isolated API.

The immediate Diligent version should therefore be **simpler than codex-rs** while preserving the same user mental model.

## Decision

Implement `thread/fork` in Diligent as a **persistent top-level thread duplication of the source thread's current visible path**.

### Exact semantics

When the client calls `thread/fork`:

1. Resolve the source thread by `threadId`.
2. Reject if the thread is currently running.
3. Reconcile memory with disk first if the thread is idle.
4. Read the source session file.
5. Compute the source thread's current visible path using the current leaf, not raw file order.
6. Create a new session file with a fresh session ID.
7. Write a new session header with `forkedFromId` pointing to the source thread ID.
8. Copy the visible-path entries into the new file.
9. Re-root copied entries so the forked file is internally self-contained.
10. Optionally append a `session_info` name entry when the request includes a new name.
11. Create a loaded runtime for the forked thread and make it active.
12. Emit `thread/started` for the forked thread.
13. Return the new thread ID and `forkedFromId` in the response.

## Why copy only the visible path

This is the most important design choice.

### Recommendation

Copy **only the current visible path**, not every entry in the source file.

### Rationale

The source session file may contain internal branch remnants due to `parentId`-based history shape. Those branches are implementation detail. A user invoking fork is not asking for "duplicate hidden alternate branches". They are asking for:

> take what I am currently looking at and let me continue from there in a separate thread.

Copying the full file would leak internal branching structure into the new thread and create surprising behavior:

- the new fork would silently contain hidden alternate branches the user did not select
- future features like rollback or branch visualization would inherit ambiguity
- fork size would grow with irrelevant branch leftovers

Copying only the visible path produces the cleanest result:

- deterministic
- user-comprehensible
- minimal
- aligned with the meaning of "fork from here"

### Re-rooting rule

Because the copied file contains only a path, copied entries must be rewritten so their `parentId` chain is valid within the new file:

- first copied entry gets `parentId: null`
- each later copied entry points to the previous copied entry's copied ID

### Entry IDs

Generate **new entry IDs** for copied entries.

This avoids accidental cross-file identity confusion and makes it explicit that a fork is a new persisted history, not the same history viewed through another handle.

The copied message payloads and timestamps should remain the same, but entry-level identity should be fresh in the new file.

## Header metadata design

### Add to `SessionHeader`

```ts
forkedFromId?: string;
```

### Do not reuse `parentSession`

`parentSession` already means collab child-session lineage.

Fork ancestry must remain distinct:

- `parentSession` = runtime child session relationship
- `forkedFromId` = user-visible top-level thread provenance

This keeps existing `includeChildren` behavior correct.

### Session version

Current `SESSION_VERSION` is 8.

Because this changes the persisted header schema, bump the session version to 9.

This is the cleanest way to document format evolution and avoid silently introducing a new persisted header field without version movement.

## Protocol proposal

### Request

```ts
thread/fork
params: {
  threadId?: string;
  name?: string;
}
```

### Why `threadId` should be optional

The current Diligent protocol already treats most thread-scoped operations as "active thread by default, explicit thread when provided" APIs. Using optional `threadId` keeps `thread/fork` aligned with:

- `thread/read`
- `thread/compact/start`
- `turn/start`
- `mode/set`
- `effort/set`

This avoids making fork the one thread operation with a different caller ergonomics model.

### Response

```ts
{
  threadId: string;
  forkedFromId: string;
}
```

### Notification

Reuse existing:

```ts
thread/started { threadId: string }
```

No dedicated `thread/forked` notification is needed for v1.

### Why reuse `thread/started`

This follows the useful part of codex-rs: once the fork exists, clients should treat it like a newly started thread that already has restored history.

That keeps frontend logic small:

- start new thread
- receive `thread/started`
- read thread state if needed
- render existing items from `thread/read`

## Loaded-runtime behavior

After fork, the new thread should be **loaded immediately** and set as the active thread for the requesting connection.

Why:

- this matches the user intent of "fork and continue here"
- this matches codex-rs's immediate activation behavior
- it avoids a two-step UX where users fork and then separately resume/select the fork

### Source-thread running policy

Reject `thread/fork` while the source thread is running.

Reason:

- current Diligent architecture separates in-memory staged state from committed persisted state
- forking mid-turn would force us to define whether pending items, active tool calls, and staged deltas are copied
- the clean answer for v1 is to forbid it

Suggested error semantics:

- `Cannot fork a running thread`

This can be relaxed later if a future design introduces snapshotting of active-turn visible state.

## Naming behavior

If `name` is provided in the request:

- append a `session_info` entry to the forked thread with that name

If `name` is omitted:

- do **not** copy the source thread name automatically

### Why not inherit the name by default

codex-rs intentionally avoids inheriting names for forks, and that choice also fits Diligent.

If names are copied automatically, thread lists become noisy and ambiguous:

- "Investigate auth bug"
- "Investigate auth bug"
- "Investigate auth bug"

Requiring explicit naming for differentiation is cleaner. If the client wants convenience, the client can prefill a suggested name such as `"<original name> (fork)"` in the UX while still sending it explicitly.

## Thread list and read shape changes

### `SessionSummary`

Add:

```ts
forkedFromId?: string;
```

This allows thread lists to show provenance directly without extra reads.

### `thread/read`

Add fork metadata at the thread level:

```ts
forkedFromId?: string;
```

This is useful for Web and TUI thread detail views and for future "jump to parent" UX.

### Why this belongs in protocol

Fork provenance is user-visible thread metadata, not client-local derived state. Under Diligent's architecture, protocol should carry the metadata clients need to present shared behavior consistently.

## UX proposal

This feature is user-facing only if both Web and TUI can expose it coherently.

### TUI

Add a slash command or command-path entry for fork:

- `/fork`
- optional follow-up prompt for name, or default unnamed fork

Expected flow:

1. user triggers fork on current thread
2. runtime returns new thread id
3. TUI switches active thread to the fork
4. TUI shows a lightweight confirmation such as `Forked from <sourceId>`

### Web

Add a thread action in the thread view and/or thread list:

- `Fork thread`

Expected flow:

1. user clicks fork
2. optional name prompt
3. active thread switches to the forked thread
4. UI shows lineage metadata

### Shared UX rule

Fork must feel like **open a new branch and continue there now**, not "create a copy somewhere else that I may later discover in the list".

## Interaction with future features

### `thread/name/set` (D092)

This pairs naturally with fork. A simple initial fork API can accept optional `name`, but the long-term naming workflow should still rely on `thread/name/set` as the general naming API.

### `thread/rollback`

Rollback and fork should compose, but fork does not need rollback to exist first.

Current recommendation:

- v1 fork always uses the current leaf
- if rollback later lets users move the visible leaf backward, fork naturally forks from that visible point
- only after that should we consider explicit branch-point parameters

### Archive / unarchive

Fork provenance should not affect archive semantics. A forked thread is still a normal top-level thread that can later be archived independently.

### Collaboration child sessions

Fork should copy only the main thread's visible path. It should **not** duplicate child session files.

Reason:

- child sessions are separate session files with their own runtime semantics
- copying them would transform fork into recursive project state cloning
- current `thread/read.childSessions` is already auxiliary data, not canonical thread history

If clients want to preserve awareness of child-session activity, that should continue to happen through copied main-thread messages and tool results already present on the visible path.

## Non-goals

This proposal explicitly does **not** include:

- ephemeral forks
- fork-time model/mode/effort/cwd overrides
- branch-point selection by user-message index or turn index
- recursive duplication of collab child sessions
- a fork tree UI
- a new dedicated `thread/forked` notification
- mid-turn forking

## Implementation plan

This section is updated to reflect the **current package layout and existing handler patterns** in the repo.

### 1. Session types and persistence

Files:

- `packages/runtime/src/session/types.ts`
- `packages/runtime/src/session/persistence.ts`

Changes:

- add `forkedFromId?: string` to `SessionHeader`
- add `forkedFromId?: string` to `SessionInfo`
- bump `SESSION_VERSION` from 8 to 9
- extend session creation helper to accept fork metadata
- add a persistence helper for file-level forking

Recommended persistence shape:

```ts
forkSessionFile({
  sessionsDir,
  sourcePath,
  sourceThreadId,
  forkedFromId,
  name,
}): Promise<{ path: string; header: SessionHeader }>
```

Implementation note:

- read source header + entries
- compute visible path using the same lineage semantics as `buildSessionContext()` / `buildSessionTranscript()`
- rewrite copied entries with fresh IDs and re-rooted parent links
- write a fresh header and append rewritten entries
- append `session_info` name entry if provided

Current-codebase note:

- `createSessionFile()` currently accepts `parentSession` and `collabMeta`; fork metadata should be added alongside these, not by overloading `parentSession`.
- `listSessions()` and `resume({ mostRecent: true })` already rely on `parentSession` meaning "collab child session". This invariant must remain true after fork is introduced.

### 2. Session manager surface

Files:

- `packages/runtime/src/session/manager.ts`

Changes:

- expose enough session state to fork from the committed visible leaf safely
- avoid reimplementing path selection logic in multiple places

Preferred pattern:

- keep file-copy logic in persistence
- keep runtime business rule checks in handlers/manager

Current-codebase note:

- `SessionManager` already exposes `reconcileFromDisk()`, `getContext()`, and transcript-oriented read helpers. Fork should reuse those boundaries rather than duplicating transcript logic in app-server code.
- If a dedicated manager method is added, it should stay orchestration-focused, for example `prepareForkSource()` or `forkCurrentVisiblePath()`, while persistence owns JSONL rewriting.

### 3. Protocol

Files:

- `packages/protocol/src/methods.ts`
- `packages/protocol/src/client-requests.ts`
- `packages/protocol/src/data-model.ts`

Changes:

- add `THREAD_FORK`
- add `ThreadForkParamsSchema`
- add `ThreadForkResponseSchema`
- add `forkedFromId` to `SessionSummarySchema`
- add `forkedFromId` to `ThreadReadResponseSchema`

Protocol-shape guidance:

- follow the existing naming pattern `ThreadCompactStartParamsSchema` / `ThreadCompactStartResponseSchema`
- keep `threadId` optional in `ThreadForkParamsSchema`
- return `{ threadId, forkedFromId }` directly rather than wrapping additional metadata prematurely
- keep this additive within protocol v1; no protocol version bump is required

### 4. App-server handlers

Files:

- `packages/runtime/src/app-server/thread-handlers.ts`
- `packages/runtime/src/app-server/server.ts`

Changes:

- add `handleThreadFork()`
- reject if source runtime is running
- reconcile source runtime from disk if idle
- create a new thread runtime bound to the forked file
- make the new thread active
- emit `thread/started`

Recommended handler pattern:

- mirror `handleThreadCompactStart()` for the running-thread rejection rule
- mirror `handleThreadRead()` for the idle-runtime `reconcileFromDisk()` rule
- wire the new method through `packages/runtime/src/app-server/server.ts` alongside other thread lifecycle cases
- return the fork response after the runtime is registered in `ctx.threads` and `ctx.setActiveThreadId()` is updated

### 5. Frontends

Files likely affected:

- `packages/cli/src/...`
- `packages/web/src/...`

Changes:

- expose fork action in both TUI and Web
- switch active thread to the returned thread id
- surface fork provenance in thread detail/list UI

Current-codebase note:

- TUI likely needs touches in `packages/cli/src/tui/thread-manager.ts` and `packages/cli/src/tui/commands/builtin/session.ts`.
- Web likely needs touches in `packages/web/src/client/App.tsx`, `packages/web/src/client/components/Sidebar.tsx`, and any RPC bridge/client layer that maps thread lifecycle requests.
- Because Diligent's product rule is that Web and TUI are thin clients over the same protocol, the plan should treat both client updates as part of the same feature slice, not as a follow-up backlog item.

## Validation plan

### Runtime tests

Add focused tests under package-level `test/` directories only.

Minimum cases:

1. `thread/fork` creates a new session file with a different session ID
2. forked header includes `forkedFromId`
3. fork copies only the visible path, not hidden branches
4. copied entries are re-rooted and internally valid
5. fork does not mark the thread as `parentSession`
6. forked thread appears in default `thread/list`
7. running thread fork is rejected
8. optional fork name creates a `session_info` entry in the fork only

### Protocol tests

Add schema coverage for new request/response fields.

### Frontend validation

- TUI can fork and immediately continue in the new thread
- Web can fork and immediately continue in the new thread
- provenance is visible and readable in both clients

## Remaining open questions

After re-checking the current codebase, the proposal is mostly implementation-ready. The remaining open questions are narrower than before:

1. Should `thread/read` expose fork provenance as a top-level response field or inside a future richer thread metadata object?
   - Recommendation: add the top-level field now, and migrate later if thread metadata is consolidated.

2. Should list views visually group forks under their source thread?
   - Recommendation: **no** for v1.
   - Show provenance metadata, but keep the list flat.

3. Should the fork action be exposed in the TUI as a direct `/fork [name?]` command, an interactive prompt, or both?
   - Recommendation: support `/fork [name?]` first, then add prompting only if needed.

## Codebase drift corrections from the original draft

The original draft was directionally correct, but these points required explicit correction after auditing the current repo:

- implementation locations must point to `packages/runtime/...` and `packages/protocol/...` rather than older `packages/core/...` references seen in adjacent planning docs
- `thread/fork` should follow current Diligent convention and accept `threadId?: string`, not require `threadId: string`
- `thread/read` and `SessionSummary` currently expose no fork metadata, so the document must treat these as planned additive changes rather than implied existing structure
- current frontend surfaces have no partial fork groundwork; this remains a full-stack feature across protocol, runtime, TUI, and Web
- `SESSION_VERSION` is still 8 today, so the version bump described here remains pending work, not already-landed format evolution

## Final recommendation

Ship `thread/fork` as a **simple, persistent, top-level, current-visible-path duplication**.

That gives users the important workflow immediately:

- try another approach
- preserve the original thread
- continue in the fork right away

It also keeps Diligent aligned with the valuable part of the codex-rs fork model without importing advanced branch-point and ephemeral-thread complexity before the rest of the thread lifecycle model is ready.

In short:

- adopt codex-rs's fork mental model
- keep Diligent's implementation append-only and JSONL-native
- copy only the visible path
- store provenance in `forkedFromId`
- keep forks top-level and active immediately

That is the cleanest, most understandable v1.
