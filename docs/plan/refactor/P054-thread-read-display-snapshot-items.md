---
id: P054
title: Canonical display snapshot for thread/read
type: refactor
status: proposed
owner: diligent
created: 2026-03-17
---

# Summary

`thread/read` currently returns raw conversation-oriented data (`messages`, `transcript`, `childSessions`) and leaves Web and TUI to independently reconstruct the display model from that data.

This plan proposes a producer-first, protocol-level fix: add `thread/read.items` as the canonical display snapshot for a thread and make that snapshot use the same semantic item vocabulary as live `item/started`, `item/delta`, and `item/completed` notifications.

The target outcome is:

- runtime computes display semantics once
- protocol carries display-ready thread snapshot items
- Web and TUI stop parsing raw transcript structures for normal hydration
- resume/reconnect state matches live-rendered state much more closely

This is the same architectural move that `P040` made for tool render payloads, but applied to the broader thread hydration path.

## Why now

Recent work on structured tool render payloads exposed a broader protocol smell.

The original issue looked like a local renderer metadata problem (`tool-info.ts` as a shadow registry), but the deeper pattern is larger:

> when the protocol transports raw internal representations, each consumer is forced to derive its own display model from them.

Tool rendering already moved away from that pattern:

- producers now emit `render` payloads
- the protocol carries those payloads
- consumers render them with minimal local interpretation

`thread/read` still uses the old pattern.

## Architectural framing

This plan follows the architecture principle in `ARCHITECTURE.md`:

- app-server is the single source of truth
- protocol is the boundary
- Web, TUI, and Desktop are thin clients

A thin client should render a shared boundary model, not reverse-engineer a display model from runtime persistence shapes.

# Current State

## Current `thread/read` shape

`ThreadReadResponse` currently includes:

- `messages: Message[]`
- `transcript?: TranscriptEntry[]`
- `childSessions?: ChildSession[]`
- `errors?: ...`
- thread metadata such as `cwd`, `isRunning`, `currentEffort`, and `totalCost`

This is useful for debugging and storage-oriented inspection, but it is not a display snapshot.

## What clients must do today

### TUI

`packages/cli/src/tui/app-session-lifecycle.ts`

`hydrateThreadHistory()` walks `thread.transcript` and reconstructs visible content by inspecting raw provider/message block shapes.

Examples:

- extracting user text by filtering blocks of type `text`
- extracting assistant text by filtering `text` blocks
- extracting assistant reasoning by filtering `thinking` blocks
- replaying tool results separately from transcript messages

The current code includes casts such as:

- `(b as { text: string }).text`
- `(b as { thinking: string }).thinking`

That is direct evidence that the boundary is too raw for the consumer.

### Web

`packages/web/src/client/lib/thread-hydration.ts` is currently a large consumer-side derivation layer.

It does all of the following during hydration:

- parse user message text and images from raw content blocks
- parse assistant text and thinking from raw content blocks
- derive tool start rows from assistant `tool_call` blocks
- match tool start rows with later `tool_result` messages
- attach `render` payloads from tool results
- special-case collab tools (`spawn_agent`, `wait`, `close_agent`)
- inspect `childSessions` to derive child tool and child message summaries
- reconstruct plan state from tool outputs
- infer in-progress tool status when thread is still running

This is exactly the kind of duplicated consumer logic that thin clients should not own.

## Live protocol is already closer to the target model

The live notification path already exposes shared semantic units:

- `item/started`
- `item/delta`
- `item/completed`

with protocol models such as:

- `ThreadItem`
- `ThreadItemDelta`
- `ToolRenderPayload`

This means the protocol already has the beginnings of a display-oriented item model.

However, `thread/read` still returns raw transcript data rather than a snapshot built from the same semantic vocabulary.

## Core inconsistency

Today the system has two distinct frontend contracts:

1. **live path**: mostly semantic, event-oriented items
2. **hydrate path**: raw persisted messages/transcript plus client-side re-derivation

That split causes drift, code duplication, and replay inconsistencies.

# Problem Statement

`thread/read` currently exposes storage-shaped data rather than UI-shaped data.

As a result:

1. Web and TUI each maintain their own hydration parser.
2. Resume/reconnect rendering can diverge from live rendering.
3. New frontends must re-implement transcript interpretation logic.
4. Runtime loses ownership of display semantics even though it has the most context.
5. Rich producer-owned improvements like tool render payloads only solve part of the problem.

In short:

> `thread/read` tells clients what happened internally, but not what they should display.

# Goals

1. Add `thread/read.items` as the canonical snapshot for UI hydration.
2. Move transcript-to-display derivation into runtime.
3. Use the same semantic item vocabulary across live notifications and hydrated thread reads.
4. Preserve producer-owned tool `render` payloads as a natural field on tool items.
5. Remove the need for normal Web/TUI hydration paths to parse raw `Message` content blocks.
6. Make resume/reconnect behavior closer to replaying live events from the beginning.
7. Keep debugging and compatibility options available during migration.

# Non-Goals

1. Do not redesign session persistence format in this plan.
2. Do not remove plain-text tool output or raw stored messages from persistence.
3. Do not introduce frontend-specific snapshot shapes.
4. Do not move UI component rendering logic into runtime.
5. Do not attempt to solve every future timeline/replay/export use case in the first change.

# Design Principle

## Producer-owned display semantics

The boundary should carry the highest-level shared representation that remains transport-neutral and frontend-neutral.

That means:

- runtime owns interpretation
- protocol owns typed display DTOs
- clients own presentation only

The boundary should not force clients to reconstruct meaning that runtime already knows.

## Snapshot and stream must converge on one model

A client should be able to build the same state from either:

- a fresh `thread/read.items` snapshot, or
- replaying `item/*` notifications over time

That is the central invariant of this plan.

# Proposed Direction

## Add `thread/read.items`

Extend `ThreadReadResponse` with a new canonical field:

```ts
interface ThreadReadResponse {
  cwd: string;
  items: ThreadItem[];
  hasFollowUp: boolean;
  entryCount: number;
  isRunning: boolean;
  currentEffort: ThinkingEffort;
  currentModel?: string;
  totalCost?: number;
  planState?: PlanState | null;

  // Legacy/debug during migration
  messages?: Message[];
  transcript?: TranscriptEntry[];
  childSessions?: ChildSession[];
  errors?: SerializableThreadError[];
}
```

`items` becomes the primary hydration contract.

`messages`, `transcript`, and `childSessions` remain temporarily for:

- backwards compatibility
- tests in transition
- debugging or diagnostic tools

## Important clarification: current `ThreadItem` is not enough as-is

The current protocol `ThreadItem` shape still contains raw message structures in some variants, especially:

- `agentMessage.message: AssistantMessageSchema`
- `userMessage.message: UserMessageSchema`

That means simply adding `items: ThreadItem[]` without changing item semantics would not solve the core problem. Consumers would still need to parse raw content blocks.

Therefore this plan includes a semantic upgrade:

> `ThreadItem` must represent display-oriented thread items, not raw provider message wrappers.

## Target semantic item model

The exact field names can be tuned during implementation, but the item model should move in this direction.

### User message item

```ts
{
  type: "userMessage";
  itemId: string;
  timestamp: number;
  text: string;
  images: Array<{
    url: string;
    fileName?: string;
    mediaType?: string;
  }>;
}
```

### Agent message item

```ts
{
  type: "agentMessage";
  itemId: string;
  timestamp: number;
  text: string;
  thinking: string;
  thinkingDone: boolean;
  reasoningDurationMs?: number;
  turnDurationMs?: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
  model?: string;
}
```

### Tool call item

```ts
{
  type: "toolCall";
  itemId: string;
  timestamp: number;
  toolCallId: string;
  toolName: string;
  input: unknown;
  output?: string;
  isError?: boolean;
  status: "streaming" | "done";
  startedAt: number;
  durationMs?: number;
  render?: ToolRenderPayload;
  childThreadId?: string;
  nickname?: string;
}
```

### Collab event item

```ts
{
  type: "collabEvent";
  itemId: string;
  timestamp: number;
  eventKind: "spawn" | "wait" | "close" | "interaction";
  childThreadId?: string;
  nickname?: string;
  description?: string;
  prompt?: string;
  status?: string;
  message?: string;
  agents?: Array<{
    threadId: string;
    nickname?: string;
    status?: string;
    message?: string;
  }>;
  timedOut?: boolean;
  childTools?: Array<{
    toolCallId: string;
    toolName: string;
    status: "running" | "done";
    isError: boolean;
    inputText: string;
    outputText: string;
  }>;
  childMessages?: string[];
}
```

### Compaction item

```ts
{
  type: "compaction";
  itemId: string;
  timestamp: number;
  summary: string;
  tokensBefore?: number;
  tokensAfter?: number;
}
```

### Optional future extension items

This plan does not require them on day one, but it is compatible with later additions such as:

- error items
- knowledge items
- loop-detection items
- approval/request markers
- user-input request markers

The key requirement is that the item model stays semantic and display-oriented.

# Why this is better than only adding more `render`

Adding `render` to `thread/read` tool results is helpful, but incomplete.

It improves the **content** of a rendered tool row, but it does not solve who constructs the row in the first place.

Without semantic snapshot items, clients still need to:

- find assistant `tool_call` blocks
- create tool start rows
- match them with `tool_result` messages
- derive in-progress vs done state
- special-case collab tools
- extract assistant text and thinking

`render` is a tool presentation payload.

`items` is the thread display snapshot.

Both are needed, but `items` is the architectural fix.

# Proposed Runtime Responsibility

## New builder: canonical thread display snapshot

Introduce a runtime-side builder responsible for producing the exact snapshot that clients hydrate from.

Suggested home:

- `packages/runtime/src/app-server/thread-display-snapshot.ts`
- or `packages/runtime/src/session/thread-display-snapshot.ts`

Suggested function shape:

```ts
buildThreadDisplaySnapshot(params): {
  items: ThreadItem[];
  planState: PlanState | null;
  ...other snapshot metadata
}
```

## Builder inputs

The builder will likely need access to:

- persisted session transcript/path entries
- current context/messages
- child sessions
- in-memory runtime state for active turn information
- known tool render payloads
- collab runtime information if needed

## Builder outputs

The builder should emit fully interpreted snapshot items, not raw transcript wrappers.

## What the builder must own

### 1. User message extraction

From raw user content, extract:

- `text`
- `images`

Clients should no longer parse content blocks for routine hydration.

### 2. Assistant message extraction

From raw assistant content, extract:

- visible `text`
- visible `thinking`
- `thinkingDone`
- timestamps and optional duration metadata

Clients should not filter message block arrays to recover display strings.

### 3. Tool reconstruction

The builder must reconstruct tool items from persisted assistant tool-call blocks and later tool-result messages.

Responsibilities include:

- create a tool item when a `tool_call` is observed
- attach input and start timestamp
- resolve corresponding `tool_result` by `toolCallId`
- attach `output`, `isError`, `durationMs`, and `render`
- mark unresolved tools as `status: "streaming"` when appropriate

### 4. Collab interpretation

This is essential for the one-step fix.

The builder must absorb today’s consumer-side collab parsing logic, including:

- `spawn_agent`
- `wait`
- `send_input`
- `close_agent`
- child session summary extraction where needed

These should surface as semantic `collabEvent` items, not as tool rows that each client later reclassifies.

### 5. Compaction conversion

Compaction entries should become semantic `compaction` items directly.

### 6. Plan state derivation

If plan state is required in hydrated UI, runtime should also derive and return it rather than requiring Web to parse plan outputs again.

# Protocol Strategy

## Single semantic vocabulary for hydration and streaming

The long-term contract should be:

- `thread/read.items` returns the current snapshot in semantic item form
- live notifications use the same semantic item form for `item/started` and `item/completed`
- live notifications use semantic deltas only for streaming efficiency

This gives the system one shared notion of what a thread contains.

## Snapshot completeness requirement

`thread/read.items` must be sufficient to render the thread without replaying any hidden state.

That means a client reconnecting in the middle of a turn should still get a coherent, displayable snapshot.

If the thread is active, the snapshot should reflect the best current state known by runtime, including:

- current thread status
- partial assistant text and thinking if available
- partial tool output if available
- in-progress tool states

Whether partial active content is represented directly in `items` or in adjunct fields is an implementation detail, but the resulting snapshot must be self-sufficient for hydration.

# Identity and Stability Requirements

## Stable `itemId`

Stable IDs are critical.

The same semantic item should have the same `itemId` across:

- live notifications
- `thread/read.items`
- reconnect or resume hydration

Without this, clients will produce duplicates or flicker when switching between hydrated and live state.

## Recommended ID strategy

### User and assistant messages

Use the persisted session entry ID where possible.

### Tool calls

Prefer a deterministic mapping from `toolCallId` to `itemId`.

### Compaction

Use compaction entry ID.

### Collab events

Use a stable key derived from the underlying orchestration call identity.

Examples:

- `collab:spawn:<callId>`
- `collab:wait:<callId>`
- `collab:close:<callId or threadId>`

The exact mapping should be chosen deliberately and used consistently in both live and snapshot paths.

# Migration Plan

## Phase 1 — Define the target boundary in protocol

1. Add `items` to `ThreadReadResponse`.
2. Evolve `ThreadItem` toward display semantics.
3. Keep legacy `messages`, `transcript`, and `childSessions` temporarily.
4. Document `items` as the preferred hydration contract.

### Decision note: evolve `ThreadItem` vs introduce a new type

There are two implementation options:

1. **Evolve `ThreadItem` in place**
   - best long-term conceptual clarity
   - stronger parity between stream and snapshot
   - higher migration blast radius

2. **Introduce a temporary `ThreadDisplayItem`**
   - lower immediate risk
   - creates parallel models temporarily
   - weakens the “one vocabulary” goal

For the architectural end-state, this plan recommends **one shared semantic item vocabulary**.

If implementation risk is too high, a temporary bridge type is acceptable only as a short-lived transition, not as the end design.

## Phase 2 — Implement runtime snapshot builder

1. Extract transcript-to-display logic into runtime.
2. Build canonical item snapshot generation in one place.
3. Populate `thread/read.items` from that builder.
4. Keep existing raw fields intact until clients migrate.

## Phase 3 — Migrate Web hydration

1. Make `hydrateFromThreadRead()` prefer `payload.items`.
2. Delete raw transcript parsing logic once equivalent item coverage exists.
3. Reuse more of the live reducer logic where possible.
4. Preserve temporary fallback to raw fields while rollout is in progress.

Expected outcome:

- large reduction in `thread-hydration.ts`
- fewer protocol casts
- less client-specific collab parsing

## Phase 4 — Migrate TUI hydration

1. Replace transcript block inspection in `hydrateThreadHistory()` with item replay.
2. Remove direct content-block casts.
3. Let the TUI transcript store consume semantic item snapshots in the same spirit as live events.

Expected outcome:

- no more raw assistant/user block parsing in CLI resume path
- simpler parity between live and resume rendering

## Phase 5 — Tighten invariants and remove legacy dependence

1. Make tests assert parity between hydrated snapshot state and replayed live state.
2. Deprecate direct UI dependence on `messages`, `transcript`, and `childSessions`.
3. Decide whether to remove legacy raw fields entirely or keep them for debug-only use.

# Detailed Implementation Plan

## Protocol work

### Changes

- update `packages/protocol/src/client-requests.ts`
- update `packages/protocol/src/data-model.ts`
- update any tests that validate `ThreadReadResponseSchema`

### Tasks

1. Add `items` to `ThreadReadResponseSchema`.
2. Rework `ThreadItemSchema` toward display-oriented item variants.
3. Ensure `ThreadItemDeltaSchema` still complements streaming use cases.
4. Decide whether raw message-carrying item variants should be deprecated or removed.

## Runtime work

### Changes

- add snapshot builder module
- update `packages/runtime/src/app-server/thread-handlers.ts`
- possibly add helper modules for collab parsing and plan derivation
- add focused tests

### Tasks

1. Build semantic item snapshot from session/runtime state.
2. Reuse producer-owned tool render payloads directly on tool items.
3. Move collab interpretation out of Web hydration and into runtime.
4. Return `items` in `handleThreadRead()`.
5. Derive `planState` server-side if clients currently depend on parsed plan tool output.

## Web work

### Changes

- simplify `packages/web/src/client/lib/thread-hydration.ts`
- update thread store types if needed
- update tests that hydrate thread state from RPC payloads

### Tasks

1. Add `payload.items` hydration path.
2. Reduce or remove transcript parsing helpers.
3. Keep a temporary fallback for older server payloads if needed.
4. Ensure collab, tool render, and thinking parity with live events.

## TUI work

### Changes

- update `packages/cli/src/tui/app-session-lifecycle.ts`
- possibly add a semantic item replay adapter for `TranscriptStore`
- update related tests

### Tasks

1. Replay snapshot items instead of parsing raw transcript messages.
2. Reuse existing rendering paths for user/assistant/tool/collab items.
3. Remove content block casts from resume hydration.

# Risks and Tradeoffs

## Risk 1 — Expanding `ThreadItem` is a protocol-wide change

This affects:

- runtime event mapping
- protocol schemas
- Web reducer paths
- TUI event/render paths
- tests across packages

Mitigation:

- stage rollout with legacy fallback
- keep the semantic model deliberately small and focused
- validate parity with explicit snapshot-vs-stream tests

## Risk 2 — Active-turn snapshot parity is tricky

Hydrating a thread while a turn is in progress can expose mismatch between persisted transcript state and in-memory live state.

Mitigation:

- make snapshot builder consume both persisted and current in-memory state
- test mid-turn reads explicitly
- define clear behavior for partial assistant/tool items

## Risk 3 — Collab semantics are easy to under-specify

Collab history is currently reconstructed from multiple raw signals.

Mitigation:

- explicitly scope collab snapshot coverage into this plan
- do not ship a “tool-only” snapshot model that leaves collab as consumer-derived logic

## Risk 4 — Overfitting the item model to today’s UI

If the schema becomes too presentation-specific, it may limit future clients.

Mitigation:

- keep items semantic and frontend-neutral
- place only interpreted meaning in protocol, not visual component details
- leave final visual layout decisions to each frontend

# Testing Strategy

## Core invariant

The most important test invariant is:

> for the same thread, hydrating from `thread/read.items` and replaying live `item/*` notifications should produce equivalent user-visible state.

## Recommended test coverage

### Protocol tests

- `ThreadReadResponseSchema` accepts `items`
- `ThreadItemSchema` validates new semantic item variants
- backwards compatibility behavior is explicit during migration

### Runtime tests

- snapshot builder converts raw session entries into expected item sequences
- tool calls pair correctly with tool results
- collab events are summarized correctly
- active running thread snapshot includes correct in-progress states
- plan state is derived correctly if included

### Web tests

- hydration from `payload.items` builds expected `ThreadState`
- hydrated tool render payloads match live tool item rendering
- collab items hydrate identically to live reducer behavior
- no transcript parsing needed in the preferred path

### TUI tests

- resume hydration from snapshot items replays visible transcript correctly
- tool results render with snapshot-provided `render`
- thinking text is restored without raw block inspection

### End-to-end tests

- run a thread with user, assistant, tool, collab, and compaction activity
- read thread mid-run and after completion
- verify Web/TUI render parity where practical

# Success Criteria

This plan is successful when all of the following are true:

1. `thread/read` returns `items` representing a complete display snapshot.
2. Web no longer relies on raw `TranscriptEntry` parsing for normal hydration.
3. TUI no longer relies on raw transcript content-block casts for resume hydration.
4. Tool `render` payloads flow naturally through snapshot tool items.
5. Collab hydration is owned by runtime rather than rebuilt in each client.
6. Snapshot hydration and live replay produce equivalent user-visible state for representative threads.

# Open Questions

## 1. Should `ThreadItem` be evolved in place or replaced once?

Architecturally, one shared semantic vocabulary is the best end-state.

The implementation decision depends on how much churn is acceptable in one pass.

## 2. How much active-turn partial state belongs in `items` versus separate snapshot metadata?

The principle is that hydration must be self-sufficient. The exact shape of partial active content can be tuned.

## 3. Should `errors` become items too?

They are already displayable and currently handled separately in Web state. Unifying them as items may further simplify clients, but it is not required for the first pass.

## 4. Should plan state remain a separate top-level field?

Likely yes for convenience, even if it is derived from tool items, because it drives dedicated UI state rather than transcript rendering alone.

# Recommendation

Adopt the one-step architecture change, not the partial fix.

That means:

1. add `thread/read.items`
2. make those items the canonical hydration contract
3. move transcript interpretation into runtime
4. align hydration items with the same semantic vocabulary used by live notifications
5. treat raw `messages`, `transcript`, and `childSessions` as legacy/debug fields during migration

This is the cleanest way to finish the producer-first shift that began with structured tool render payloads.

It turns `thread/read` from a storage-shaped API into a true display snapshot API, which is a much better fit for Diligent’s thin-client architecture.
