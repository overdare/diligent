# 12 — Thread rename, fork, and rewind (no storage layout change)

Status: proposal · Depends on: none · Out of scope: session storage location, directory layout, indexing

## Problem

Threads cannot be named, branched to try an alternative, or rewound to an earlier point. The session format already
stores a tree and a name field; no API writes them.

## Current state

| Fact | Evidence |
|---|---|
| Every entry has `id` and `parentId`; context and transcript are built by walking from a leaf to the root | `packages/runtime/src/session/types.ts:56-96`, `session/context-builder.ts:52-93, 209-210` |
| The leaf on load is the last entry in the file; appends move the leaf to the new entry | `session/state-store.ts:27, 40` |
| `session_info { name? }` entry type exists; listing and history read the latest name | `types.ts:77-83`, `persistence.ts:98`, `history.ts:183` |
| Nothing writes `session_info` | grep of `runtime/src` for `session_info` finds only readers |
| `SessionSummary` already has `name` and `parentSession` | `packages/protocol/src/data-model.ts:567-577` |
| `parentSession` in the header means "collab child of" | `types.ts:43-53` |
| Thread methods: start, resume, list, read, history, delete, compact, goal get/set — no rename/fork/rewind | `packages/protocol/src/methods.ts:6-24` |
| `SESSION_VERSION` 12, validated on read | `types.ts:9` |

## Reference survey

**codex** app-server: `thread/name/set`, `thread/fork` (params include `beforeTurnId`, `path`, `attachToSource`),
`thread/revert` with `thread/reverted` notification (`app-server-protocol/src/protocol/common.rs:587, 640, 809, 2066`;
`v2/thread.rs:565-692`). **oh-my-pi** exposes branching as session events (`session_before_branch`, `session_branch`).

## Design

### `thread/name/set`

```ts
params: { threadId: string; name: string }   // 1–120 chars after trim; empty string clears
result: {}
notification: "thread/name/updated" { threadId, name? }
```

Appends `session_info { name }` through the thread's keyed serializer, so it is safe while a turn runs. The entry
joins the path like any other; context building already ignores it. `thread/list` reflects it through the existing
summary reader.

### `thread/fork`

```ts
params: {
  threadId: string;
  throughEntryId?: string;   // inclusive fork point; must be on the active path
  beforeEntryId?: string;    // exclusive: fork point = parent of this entry ("edit and resend")
  name?: string;
}                            // neither → fork at the current leaf; both → invalid params
result: { threadId: string }
```

- Allowed while the source is running only for a point at or before the last **completed** turn; forking the live
  leaf of a running thread is rejected (the leaf is moving).
- The new session file is written in the same sessions directory with a fresh ID and header field
  `forkedFrom: { sessionId, entryId }` (new optional header field; not `parentSession`, which means collab child).
- Entries on the path root → fork point are copied verbatim (IDs preserved; they are unique per file). Image sidecar
  blobs are content-addressed in the same directory, so nothing is copied. Compaction entries and native checkpoints
  on the path are copied, so the fork resumes with the same model-visible context.
- Not copied: goal state (the fork starts without a goal), off-path branches.
- **Collab children:** entries may reference child threads whose header `parentSession` is the source. The fork restores
  those agents as shut down (existing `restoreAgent` path, `collab/registry.ts:841-845`) and refuses to resume a child
  whose `parentSession` is not the fork's own ID, so a fork can never append to the source's children.
- `SessionStart` hook (doc 01) fires with `source: "fork"`.

### `thread/rewind`

```ts
params: { threadId: string; toEntryId: string }   // must be on the active path; thread must be idle
result: { removedTurns: number }
notification: "thread/rewound" { threadId, toEntryId }
```

Appends a marker entry whose parent is the target:

```ts
interface BranchEntry { type: "branch"; id: string; parentId: string /* toEntryId */; timestamp: string; fromLeafId: string }
```

The marker becomes the leaf, so the next turn continues from `toEntryId`. The abandoned branch stays in the file
(nothing is destroyed; a later "switch branch" API can reach it via `fromLeafId`). Context and transcript builders treat
`branch` as a no-op on the path.

**Rewind restores the conversation only, not files.** Edits made by tools after the target remain on disk. The result
and both clients state this explicitly. File checkpoints are a separate, larger feature and are not implied.

### Versioning

`branch` and the `forkedFrom` header field require `SESSION_VERSION` 13, shared with doc 11's `context_prune` if both
ship in the same release; otherwise each bump is its own release step.

### Clients

TUI: `/rename <name>`, `/fork`, `/rewind` (pick a previous user message). Web: rename in the thread list; "fork from
here" and "rewind to here" on user messages. Both clients are updated in the same change as the protocol.

## Tests

- `packages/runtime/test/session/fork.test.ts`: copied path ends at the fork point; native checkpoint preserved;
  `beforeEntryId` excludes the entry; off-path entries absent.
- `packages/runtime/test/session/rewind.test.ts`: context after rewind ends at the target; transcript shows no abandoned
  turns; the file still contains them.
- `packages/runtime/test/collab/fork-children.test.ts`: resuming a source child from a fork is rejected.
- `packages/e2e/app-server/thread-fork-rename.test.ts`: `thread/name/set` → `thread/list` shows the name; `thread/fork`
  → `thread/read` of the fork returns the copied turns; `thread/rewind` on a running thread is rejected.
