# Session lifecycle

This guide describes the current runtime-owned session/thread lifecycle in Diligent.

[Goal mode](goals.md) adds explicit-request persistent objectives and automatic continuation
to root sessions. Its state ledger is separate from conversation entries.

## Core model

Sessions are project-local and persist under `.diligent/sessions/` as append-only JSONL.

- First line: session header (`type: "session"`, `version`, `id`, `cwd`, optional `parentSession` and child metadata)
- Remaining lines: ordered session entries

In protocol/client surfaces, session IDs are exposed as thread IDs.

## What is persisted

Current persisted entry families include:

- message entries (user/assistant/tool_result)
- model changes (`model_change`)
- mode changes (`mode_change`)
- effort changes (`effort_change`)
- compaction entries (`compaction`)
- optional thread naming (`session_info`)

Runtime can reconstruct multiple views from the same file:

- **context view** for future model calls
- **transcript/snapshot view** for UI rendering

Runtime message entries may be marked `visibility: "internal"` with an opaque `source`. Internal
messages stay replayable in provider context and in the append-only parent chain without becoming
user messages or visible message counts. Most are excluded from transcripts, snapshots, and
previews. A trusted runtime hook may attach validated presentation metadata; runtime then exposes a
structured context notice in both live events and `thread/read` while keeping the injected model
message internal. Older untagged reminder messages remain visible because only explicit entry
metadata controls visibility.

## Starting and resuming threads

### `thread/start`

- Creates a new session file and returns `{ threadId }`
- Emits `thread/started`
- Sets the started thread as active in runtime
- Updates the requesting connection's `currentThreadId`

Defaults on start:

- `mode` defaults to `default` when omitted
- `cwd` and `mode` can be injected from connection defaults
- model and effort reuse the cwd's loaded runtime selection when available, otherwise configured defaults
- starting a thread never scans saved conversations to discover defaults; resuming a thread restores its own persisted settings

### `thread/resume`

Params must include either:

- `threadId`, or
- `mostRecent: true`

Behavior:

1. If target thread is already loaded in memory, runtime reuses it.
2. Otherwise runtime searches known cwd session directories, loads the session, and reconstructs state.
3. On success, emits `thread/resumed` with `restoredMessages` and returns `{ found: true, threadId }`.
4. On miss, returns `{ found: false }`.

Resume is a runtime operation (not frontend-local reconstruction). It returns no history;
clients display history through `thread/history` (see below) and use resume only to make
the runtime ready for new turns.

Reusing an idle in-memory thread first reconciles it from disk, so its settings and entry count
match the history clients may already be displaying. Concurrent resumes of the same thread ID
share one in-flight restoration, so orphan repair runs once. Thread-scoped requests for a
thread under restoration wait for it instead of loading a second runtime.

A resume (or start) sets the connection's implicit current thread only when no newer
`thread/start` or `thread/resume` from that connection has begun in the meantime. A slow
restoration therefore cannot take over a conversation the user has since opened.

The persistence lookup resolves an explicit ID to `<sessionId>.jsonl` directly,
rather than searching unrelated transcripts for the target. The ID must be safe and
match the file header. Missing, corrupt, or unsupported JSONL targets are not found.
No unrelated history is read to choose resume defaults. `mostRecent` explicitly lists
sessions by persisted modification time and excludes child sessions.

On resume, runtime also repairs orphaned assistant tool calls by appending synthetic `[Cancelled]` tool results when needed.

## Active thread resolution and implicit threadId

For thread-scoped methods (`turn/start`, `turn/interrupt`, `turn/steer`, `thread/read`, `thread/compact/start`, etc.), if `threadId` is omitted:

1. request default uses connection `currentThreadId`
2. runtime fallback uses server `activeThreadId`

If neither exists, runtime returns `No active thread`.

## Listing threads

`thread/list` accepts `{ limit?, includeChildren?, cursor? }` and returns
`{ data: SessionSummary[], nextCursor? }`.

`SessionSummary` fields:

- `id` (session/thread ID)
- `path`
- `cwd`
- `name?`
- `created`
- `modified` (session file modification time)
- `messageCount?` (`0` for a header-only file; otherwise omitted)
- `firstUserMessage?`
- `parentSession?`

Notes:

- child sessions are excluded unless `includeChildren: true`
- runtime default limit is 20 files per page; protocol schema caps `limit` at 500
- pages are discovery batches in file-name order, not a global newest-first slice; a page
  may be empty and still carry `nextCursor`
- clients merge batches by ID and sort by `modified` descending, with ID as the tie-breaker
- cursors are opaque; an invalid cursor fails with `Invalid session list cursor.`

Listing reads only each file's header and the leading records needed for a preview, with
bounded concurrency, and takes `modified` from file metadata instead of reading the tail.
It does not create an index or retain summary caches. Unreadable files are skipped.
Web, TUI, and VSCode share this runtime path. OVERDARE production stores sessions under
`<cwd>/.overdare/sessions/`, which may reside on a slow network filesystem. The
non-interactive CLI `--list` still reads full files and prints message counts.

Web loads the sidebar in the background, independently of provider readiness,
the composer, and explicitly selected conversations. Each batch appears as it arrives
while a loading indicator remains until the last page. Loading and failure states
stay in the sidebar; a failed refresh retains the previous list. Background listing
has no fixed RPC deadline, but disconnect still rejects it. Other RPC deadlines are
unchanged. Older refresh responses cannot overwrite newer ones.

At startup, Web reuses the completed list for automatic recent-session selection.
It restores only while the user has not begun interacting or navigated elsewhere;
late results cannot replace a new draft. Opening an explicit thread ID does not wait
for this list. TUI startup and explicit-ID resume also avoid unrelated history reads;
session pickers open with the first batch and add later batches while they are shown.

There is no storage migration or cache invalidation.

## Reading thread history

`thread/history` accepts `{ threadId, cursor?, limit? }` and returns
`{ cwd, items, nextCursor? }`.

- the first page holds the most recent history; each `nextCursor` page goes further back
- items within a page are chronological
- a page follows the active parent chain backwards for up to `limit` records (default 50,
  maximum 100) and stops early after about 1 MB; a single record larger than that still
  forms a page
- image blobs are materialized only for records on the returned page
- a cursor is bound to the session file it came from; a replaced or rewritten file fails
  with an error rather than returning mismatched history
- a loaded thread that has not persisted a turn yet returns `items: []`
- reading history never restores the runtime, repairs orphaned tool calls, or writes to the file

A tool call and its result may land on different pages. Clients merge pages by item ID,
keeping the older page's input and render data and the newer page's output and timing.

Opening a conversation shows the first page immediately and then calls `thread/resume` in
the background. Sending stays disabled until resume completes; a failed resume is shown with
a retry, and the visible history remains. Web runs that resume without an RPC deadline and
offers "Load earlier history" at the top of the transcript. TUI prints the first page, and
`/older` appends the next earlier page to scrollback after a loading notice;
pages already printed are never rewritten. Late history or resume results are discarded if
the user has navigated elsewhere.

## Reading thread state

`thread/read` accepts `{ threadId?, includeItems? }` and returns a runtime-built snapshot:

- `cwd`
- `items`
- `hasFollowUp`
- `entryCount`
- `isRunning`
- `currentEffort`
- `currentModel?`
- `totalCost?`

Important behavior:

- if thread is idle, runtime can reconcile memory from disk before producing the snapshot
- `includeItems: false` returns metadata from the loaded runtime with `items: []`, skipping
  reconciliation and transcript building; `totalCost` is omitted in this mode
- cost is omitted for entries whose model is no longer in the model catalog, so sessions using
  retired models stay readable
- `items` are built from transcript entries (`userMessage`, `agentMessage`, `toolCall`, `compaction`, `error`)
- live collaboration status can be overlaid onto persisted snapshot items
- a failed turn persists a raw `error` session entry on the parent chain; `thread/read` returns it as an
  `error` item at the same transcript position with runtime presentation derived on read, using the
  provider recorded on that path. Web and TUI render it as a timestamped transcript row and offer its
  recovery action only when it is the trailing item of an idle thread

## Turn lifecycle hooks into thread lifecycle

`turn/start` drives thread busy/idle transitions:

1. runtime marks thread busy and emits `thread/status/changed` (`busy`)
2. emits `turn/started`
3. runs turn
4. emits `turn/completed` or `turn/interrupted`
5. emits `thread/status/changed` (`idle`)

Related operations:

- `turn/interrupt`: aborts only when a turn is currently running
- `turn/steer`: queues steering in session manager for a subsequent run boundary

Web Stop and TUI Ctrl+C retain the automatic restart policy: when a pending steer exists,
the client starts a new turn with the first pending steer's text and image attachments after
`turn/interrupted`. With no pending steer, the turn simply stops. The client keeps the full
`PendingSteer` through interruption, including attachments returned by `thread/read`, and
resubmits them as `local_image` content blocks. This does not submit the Web composer's unsent
draft or require an extra Send action. A rejected interruption does not trigger a restart.
`turn/interrupt` retires the active turn and emits `turn/interrupted` and idle before replying;
it does not wait for provider, tool, or lifecycle-hook cleanup. Late events and completion from
the retired turn are suppressed. Session cleanup remains serialized before the next execution
so its writes cannot race with a replacement turn. A replacement waiting for that cleanup is
itself interruptible. Compaction and deletion remain unavailable until session execution has settled.
An already-idle response refreshes the Web thread instead of waiting for another notification.

## Lifecycle hook modes

Diligent has two hook tiers. The shell/plugin hooks below are coarse external lifecycle hooks and
may perform asynchronous I/O. Separately, trusted bundled product code can register synchronous
`AgentLoopHook` factories through `BundledToolProvider`. Runtime creates fresh hook instances per
main or child Agent; these hooks can observe sampling-loop phases and return structured internal
user-context injections, but cannot run tools, mutate Agent history directly, or cross the client
protocol. A throwing loop hook is logged and disabled for that Agent without failing the turn.
The built-in main-Agent plan reminder is enabled by default with a six-turn cadence. Studio human
edit detection uses the outer hook only to flush and freeze the asynchronous diff, then a main-Agent
loop hook injects that diff through the same context-injection path with a structured client notice.
Set
`planReminderIntervalTurns` to `0` to disable it or to another non-negative integer to tune the
cadence.

Shell and plugin lifecycle hooks support two execution modes. The mode controls scheduling, not the meaning of a hook's
return value:

- `mode: "sync"` (default): runtime waits for the hook execution before continuing. A synchronous shell hook has a
  default timeout of 10 seconds unless `timeout` is set.
- `mode: "async"`: runtime starts the hook and immediately continues without waiting for its output.

Current hook events:

- `UserPromptSubmit`: runs after the user submits a prompt and before the agent turn starts. Synchronous hook results
  may block that prompt or add `additionalContext`; asynchronous results are ignored.
- `Stop`: runs after a successful completion or user interruption as an external lifecycle notification, but not after
  an unexpected turn error. Synchronous Stop handlers settle before `turn/completed` or `turn/interrupted` is emitted.
  Runtime isolates and ignores all Stop outputs and errors. They never add model context, accept or reject an answer,
  or trigger another model run.

## Manual compaction

`thread/compact/start` is explicit user-triggered compaction.

- rejected while a turn is running
- marks the thread busy before the request and always returns it to idle afterward
- an adopted result emits `thread/compaction/started` followed by `thread/compacted`
- an ineligible or nonshrinking `compacted: false` result emits neither compaction notification
- busy and idle are emitted through `thread/status/changed` and bracket either result

Manual and automatic compaction use the same 50,000-estimated-token candidate minimum. A manual request below that
minimum completes with `compacted: false`; it does not force a summary or persist a compaction entry. An eligible
local or provider-native result is adopted only when effective provider context shrinks. Rejection preserves the
original messages and provider-native context state.

Confirmed provider context overflow is the only minimum bypass. Runtime permits one bounded attempt, still requires
effective shrinkage, and otherwise resurfaces the original overflow without a compaction or provider retry loop.

On failure, runtime emits `error` and still restores idle status.

## Deleting threads

`thread/delete`:

- rejects deletion of currently running in-memory thread
- removes session file from disk (across known cwd session roots)
- removes in-memory runtime state for that thread
- clears active thread when deleting the active one
- returns `{ deleted: boolean }`

## Subscription and notification fanout

Thread lifecycle notifications are runtime-owned and shared by all clients.

- `thread/subscribe` registers a connection-level subscription to a thread
- `thread/unsubscribe` removes that subscription
- when subscribers exist, thread-scoped notifications fan out to subscribers
- if no subscriber exists, notifications fall back to broadcast

This keeps Web/TUI/Desktop aligned on the same thread state machine.

## Key code paths

- `packages/runtime/src/app-server/server.ts`
- `packages/runtime/src/app-server/thread-handlers.ts`
- `packages/runtime/src/app-server/thread-read-builder.ts`
- `packages/runtime/src/app-server/session-handlers.ts`
- `packages/runtime/src/session/manager.ts`
- `packages/runtime/src/session/history.ts`
- `packages/runtime/src/session/persistence.ts`
- `packages/runtime/src/client/history-pages.ts`
- `packages/runtime/src/session/types.ts`
- `packages/protocol/src/methods.ts`
- `packages/protocol/src/client-requests.ts`
- `packages/protocol/src/server-notifications.ts`
- `packages/protocol/src/data-model.ts`
- `packages/e2e/app-server/protocol-lifecycle.test.ts`
- `packages/e2e/app-server/session-resume.test.ts`
- `packages/e2e/app-server/session-history.test.ts`
