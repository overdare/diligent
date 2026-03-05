---
id: P028
status: pending
created: 2026-03-05
decisions: [D089, D090, D091, D092, D093, D094]
---

# P028: Thread Operations (Fork/Compact/Archive) + Streaming Granularity

Two protocol evolutions inspired by Codex-RS, adding first-class thread lifecycle operations and fine-grained streaming delta types.

## Context

### Current State

Diligent's protocol (v1, `packages/protocol/`) supports a thread/turn/item model with:
- **Thread lifecycle**: `thread/start`, `thread/resume`, `thread/list`, `thread/read`, `thread/delete`
- **Streaming deltas**: Unified `item/delta` notification with 3 `ThreadItemDelta` variants:
  - `messageText` — LLM text output
  - `messageThinking` — extended thinking blocks
  - `toolOutput` — tool execution output

### Gaps vs Codex-RS

| Feature | Codex-RS | Diligent (current) |
|---------|----------|-------------------|
| Fork | `thread/fork` — duplicate thread to branch point | ✗ No fork |
| Compact | `thread/compact/start` — explicit user-triggered compaction | Only auto-compaction (proactive/reactive) |
| Archive | `thread/archive`, `thread/unarchive` — soft-delete with recovery | Only hard delete (`thread/delete`) |
| Rollback | `thread/rollback` — revert to a specific turn | ✗ No rollback |
| Name | `thread/name/set` — user-assigned thread name | ✗ Names in session_info entry but no API |
| Streaming | 8 delta types: `agentMessage/delta`, `plan/delta`, `commandExecution/outputDelta`, `fileChange/outputDelta`, `terminalInteraction`, `reasoning/textDelta`, `reasoning/summaryTextDelta`, `reasoning/summaryPartAdded` | 1 unified `item/delta` with 3 sub-types |

---

## Feature 1: Thread Operations (D089–D092)

### D089: Thread Fork — Branch-point duplication

**What**: Client sends `thread/fork` to create an independent copy of a thread. The fork copies all session entries up to the current leaf, producing a new session file with its own ID. The forked thread has `forkedFromId` metadata linking to the parent.

**Semantics**:
- Fork creates a **new JSONL file** with the same entries (deep copy up to current leaf)
- The forked session gets a new `SessionHeader.id` and `forkedFromId` field
- The original thread is unchanged
- Both threads are independently modifiable after fork
- Fork is **NOT** the same as the existing tree-based `parentId` branching — this is a full file-level duplication for user-visible "try a different approach" workflows

**Why file copy, not tree branch**: The existing `parentId` tree is an internal mechanism for context building. Fork is a user-facing operation that creates a separate thread in `thread/list`. Users want to see "forked from X" in the UI, not navigate a hidden tree structure.

**Protocol**:
```
Client → Server: thread/fork
  params: { threadId: string, name?: string }
  response: { threadId: string, forkedFromId: string }

Server → Client: thread/started
  params: { threadId: string }
```

**Session format change**: `SessionHeader` gains optional `forkedFromId: string`.

**Implementation locations**:
- `packages/protocol/src/methods.ts` — add `THREAD_FORK`
- `packages/protocol/src/client-requests.ts` — `ThreadForkParams/Response`
- `packages/core/src/session/persistence.ts` — `forkSession(sessionsDir, sourceSessionId, name?)` function
- `packages/core/src/session/types.ts` — `SessionHeader.forkedFromId`
- `packages/core/src/app-server/server.ts` — `handleThreadFork()`

### D090: Thread Compact — User-triggered compaction

**What**: Client sends `thread/compact/start` to explicitly trigger context compaction on a thread, regardless of whether auto-compaction thresholds are met. Uses the same compaction machinery that already exists in `SessionManager.performCompaction()`.

**Why**: Users sometimes want to compact proactively (e.g., before a complex task) or when the context feels "stale". Currently compaction is purely automatic.

**Protocol**:
```
Client → Server: thread/compact/start
  params: { threadId: string }
  response: { tokensBefore: number, tokensAfter: number, summary: string }

Server → Client: thread/compacted
  params: { threadId: string, tokensBefore: number, tokensAfter: number }
```

**Notification**: New `thread/compacted` notification (Codex-RS pattern) in addition to the existing `compaction_start`/`compaction_end` AgentEvents that fire during auto-compaction. The `thread/compacted` notification is only for explicit user-triggered compaction.

**Constraints**:
- Cannot compact while a turn is running (reject with error)
- Minimum token threshold: skip compaction if context is already small (< 4000 tokens)

**Implementation locations**:
- `packages/protocol/src/methods.ts` — add `THREAD_COMPACT`
- `packages/protocol/src/client-requests.ts` — `ThreadCompactParams/Response`
- `packages/protocol/src/server-notifications.ts` — `ThreadCompactedNotification`
- `packages/core/src/session/manager.ts` — extract `compactNow()` public method from existing `performCompaction()`
- `packages/core/src/app-server/server.ts` — `handleThreadCompact()`

### D091: Thread Archive/Unarchive — Soft delete with recovery

**What**: Archive moves a thread to an "archived" state. Archived threads are excluded from `thread/list` by default (shown when `archived: true` filter is passed). Unarchive restores them.

**Implementation approach**: Instead of moving files, add an `archived` flag. Two options:

**Option A — Header flag**: Rewrite the session header line to add `archived: true`. Problem: violates append-only JSONL principle.

**Option B — Archive entry (chosen)**: Append a new `SessionEntry` type `{ type: "archive", archived: boolean }`. Last archive entry determines state. Preserves append-only invariant. `listSessions()` reads this to filter.

**Protocol**:
```
Client → Server: thread/archive
  params: { threadId: string }
  response: { threadId: string }

Server → Client: thread/archived
  params: { threadId: string }

Client → Server: thread/unarchive
  params: { threadId: string }
  response: { threadId: string }

Server → Client: thread/unarchived
  params: { threadId: string }
```

**Session format change**: New `ArchiveEntry` type in `SessionEntry` union. `SESSION_VERSION` bumped to 6.

**Implementation locations**:
- `packages/protocol/src/methods.ts` — add `THREAD_ARCHIVE`, `THREAD_UNARCHIVE`
- `packages/protocol/src/client-requests.ts` — params/response pairs
- `packages/protocol/src/server-notifications.ts` — archive/unarchive notifications
- `packages/core/src/session/types.ts` — `ArchiveEntry`, bump version
- `packages/core/src/session/persistence.ts` — `listSessions()` gains `archived` filter
- `packages/core/src/app-server/server.ts` — handlers
- `packages/protocol/src/client-requests.ts` — `ThreadListParams` gains `archived?: boolean`

### D092: Thread Name — Set/update thread name

**What**: Client sends `thread/name/set` to give a thread a display name. Currently `session_info` entries exist but there's no protocol API to create them.

**Protocol**:
```
Client → Server: thread/name/set
  params: { threadId: string, name: string }
  response: {}

Server → Client: thread/name/updated
  params: { threadId: string, name: string }
```

**Implementation**: Appends a `SessionInfoEntry` with the name. The `SessionSummary` already has a `name` field that reads from this.

**Implementation locations**:
- `packages/protocol/src/methods.ts` — add `THREAD_NAME_SET`
- `packages/protocol/src/client-requests.ts` — params/response
- `packages/protocol/src/server-notifications.ts` — `ThreadNameUpdatedNotification`
- `packages/core/src/session/manager.ts` — `setName(name: string)` method
- `packages/core/src/app-server/server.ts` — handler

---

## Feature 2: Streaming Granularity (D093–D094)

### D093: Fine-grained streaming delta types

**What**: Replace the unified `item/delta` notification with type-specific delta notifications, matching Codex-RS's approach. This allows clients to render different content types with different UI treatments.

**Current flow** (unified):
```
item/delta { delta: { type: "messageText", delta: "Hello" } }
item/delta { delta: { type: "messageThinking", delta: "Let me think..." } }
item/delta { delta: { type: "toolOutput", delta: "file.ts" } }
```

**New flow** (type-specific notifications):
```
item/agentMessage/delta       { delta: "Hello" }
item/reasoning/summaryTextDelta { delta: "Let me think..." }
item/plan/delta               { delta: "- Step 1\n- Step 2" }
item/toolExecution/outputDelta { delta: "file.ts" }
```

**New delta notification types** (6 total, replacing 1 `item/delta`):

| Notification | Source | When |
|-------------|--------|------|
| `item/agentMessage/delta` | LLM text_delta | Regular text streaming |
| `item/reasoning/summaryTextDelta` | LLM thinking_delta | Extended thinking / reasoning (hidden by default, summarized) |
| `item/plan/delta` | `plan` tool output | Plan tool streaming output (currently emitted as tool_update) |
| `item/toolExecution/outputDelta` | Tool partial output | Bash/read/grep tool output streaming |
| `item/fileChange/outputDelta` | Write/edit tool output | File modification result streaming |
| `item/reasoning/textDelta` | Future: raw reasoning | Raw reasoning text (for debug/advanced view) |

**Key design**: The `item/delta` method is **kept as deprecated** for backward compatibility. New clients use the specific delta methods. The server emits **both** during a transition period (version 1 → 2), controlled by a capability flag.

**Mapping from AgentEvent to new deltas**:

| AgentEvent | Old Protocol | New Protocol |
|-----------|-------------|-------------|
| `message_delta { delta: { type: "text_delta" } }` | `item/delta { delta: { type: "messageText" } }` | `item/agentMessage/delta` |
| `message_delta { delta: { type: "thinking_delta" } }` | `item/delta { delta: { type: "messageThinking" } }` | `item/reasoning/summaryTextDelta` |
| `tool_update` (bash/grep/ls/glob/read) | `item/delta { delta: { type: "toolOutput" } }` | `item/toolExecution/outputDelta` |
| `tool_update` (write/edit) | `item/delta { delta: { type: "toolOutput" } }` | `item/fileChange/outputDelta` |
| `tool_update` (plan) | `item/delta { delta: { type: "toolOutput" } }` | `item/plan/delta` |

**Plan delta separation**: The `plan` tool currently emits output as a `tool_update` event. With this change, plan updates are emitted as `item/plan/delta` — a dedicated stream that clients can render as a persistent sidebar/overlay rather than inline tool output.

**Implementation locations**:
- `packages/protocol/src/methods.ts` — add 6 new notification methods
- `packages/protocol/src/server-notifications.ts` — 6 new notification schemas
- `packages/protocol/src/data-model.ts` — `ThreadItemDelta` updated with new variants OR new separate delta schemas
- `packages/core/src/app-server/server.ts` — `emitFromAgentEvent()` maps to new notification types
- `packages/core/src/agent/types.ts` — AgentEvent unchanged (internal events stay the same)

### D094: Streaming capability negotiation

**What**: Clients declare their supported streaming granularity during `initialize`. This lets the server decide whether to emit fine-grained deltas or legacy unified deltas.

**Protocol change in `initialize`**:
```typescript
// Client sends:
InitializeParams {
  clientName: string
  clientVersion: string
  protocolVersion: 1
  capabilities?: {
    streamingDeltaVersion?: 1 | 2   // 1 = unified item/delta, 2 = type-specific
  }
}

// Server responds:
InitializeResponse {
  ...existing fields...
  capabilities: {
    ...existing fields...
    streamingDeltaVersion: 1 | 2    // what the server will actually emit
  }
}
```

**Negotiation logic**:
- Client requests v2 → server emits fine-grained deltas
- Client requests v1 or omits → server emits legacy `item/delta`
- Server always emits `item/started` and `item/completed` regardless (these are unchanged)

This allows gradual client migration without breaking existing TUI or Web frontends.

---

## Migration Strategy

### Protocol Version

**No protocol version bump** — these are additive changes:
- New methods (`thread/fork`, `thread/compact/start`, `thread/archive`, etc.) are opt-in
- New delta notifications coexist with old `item/delta` via capability negotiation
- Existing clients continue to work unchanged

### Session Format Version

**Bump SESSION_VERSION from 5 → 6**:
- New `ArchiveEntry` type
- New `SessionHeader.forkedFromId` field
- Existing v5 sessions are forward-compatible (no archive entries = not archived, no forkedFromId = not forked)
- `readSessionFile()` already handles `version <= SESSION_VERSION` (loads fine)

### Implementation Phases

**Phase A: Protocol types only** (~200 lines)
- Add all new methods, schemas, notifications to `packages/protocol/`
- No runtime changes
- Tests: parse/reject for all new types

**Phase B: Thread operations** (~300 lines)
- Fork: `persistence.ts` + `manager.ts` + `server.ts`
- Compact: extract `compactNow()` + handler
- Archive: `ArchiveEntry` + filter + handlers
- Name: handler + manager method
- Tests: unit tests for each operation

**Phase C: Streaming granularity** (~200 lines)
- New delta emission in `emitFromAgentEvent()`
- Capability negotiation in `initialize`
- Plan delta separation from tool_update
- Tests: verify correct delta types emitted

**Phase D: Frontend integration** (scope TBD)
- TUI: render plan deltas in sidebar, show archive/fork controls
- Web: same + thread name editing

---

## Affected Files Summary

### `packages/protocol/src/`

| File | Changes |
|------|---------|
| `methods.ts` | +8 client request methods, +8 server notification methods, +6 delta methods |
| `client-requests.ts` | +5 param/response pairs (fork, compact, archive, unarchive, name) |
| `server-notifications.ts` | +8 notifications (fork started, compacted, archived, unarchived, name updated, 6 deltas) |
| `data-model.ts` | `SessionSummary` gains `forkedFromId`, `archived`. New delta schemas or extended `ThreadItemDelta` |

### `packages/core/src/`

| File | Changes |
|------|---------|
| `session/types.ts` | `ArchiveEntry`, `SessionHeader.forkedFromId`, `SESSION_VERSION` 5→6 |
| `session/persistence.ts` | `forkSession()`, `listSessions()` archive filter, `archiveSession()` |
| `session/manager.ts` | `compactNow()`, `setName()`, `archive()`, `unarchive()` |
| `app-server/server.ts` | 5 new handlers, `emitFromAgentEvent()` delta routing, capability state |
| `agent/types.ts` | No changes (internal events unchanged) |

---

## Size Estimate

| Component | Lines |
|-----------|-------|
| Protocol types (Phase A) | ~200 |
| Thread operations (Phase B) | ~300 |
| Streaming granularity (Phase C) | ~200 |
| Tests | ~250 |
| **Total** | **~950** |

---

## Non-Goals (Deferred)

- **Thread rollback** (`thread/rollback`): Requires turn-level indexing in session entries. Complex interaction with compaction. Defer to separate plan.
- **Terminal interaction deltas** (`item/commandExecution/terminalInteraction`): Requires interactive terminal support. Out of scope.
- **Raw reasoning text** (`item/reasoning/textDelta`): Only meaningful with OpenAI reasoning models. Placeholder method defined but no emission logic yet.
- **MCP tool call progress** (`item/mcpToolCall/progress`): Depends on MCP integration (L9, unimplemented).
