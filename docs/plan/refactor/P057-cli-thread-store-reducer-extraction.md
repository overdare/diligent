---
id: P057
title: CLI thread-store reducer extraction
type: refactor
status: backlog
owner: diligent
created: 2026-03-22
---

# Summary

Extract the remaining deterministic event-reduction logic out of `packages/cli/src/tui/components/thread-store.ts` into a pure `reduceThreadEvent()` API, leaving `ThreadStore` as the owner of timers, async child-detail loading, active prompt wiring, and render invalidation. The target shape should align with the Web reducer pattern: protocol events are reduced into explicit state transitions plus declarative effects, rather than mutating store fields inline inside a stateful class.

This plan is intentionally CLI-first. It prepares the event-reduction seam needed for future Web/CLI sharing, but does not force immediate cross-client unification in the same change.

# Why now

`packages/cli/src/tui/components/thread-store.ts` is still the largest CLI file at ~804 LOC and continues to mix three concerns:

1. pure event → state transitions
2. render-time/lifecycle ownership (timers, Markdown instance lifecycle, requestRender)
3. TUI-specific formatting and collab/tool presentation assembly

The file already contains a partial extraction in `thread-event-reducer.ts`, but the high-churn logic is still class-owned via reducer delegates and `handleToolEnd()`. That means the core event semantics are still split across two places, making future collab work riskier and blocking any realistic reducer sharing with the Web client.

This refactor should land before the next collab-heavy feature or sooner if the file grows past 900 LOC.

# Goals

1. Define a pure reducer entry point for CLI thread events that owns deterministic state transitions.
2. Replace delegate-style “come back to the class and mutate more state” flows with declarative reducer outputs.
3. Keep `ThreadStore` focused on lifecycle, timers, async child-detail loading, and view invalidation.
4. Make CLI reducer structure intentionally comparable to the Web reducer flow so future shared reduction logic is possible.

# Non-Goals

1. Do not merge CLI and Web reducers in this plan.
2. Do not move TUI rendering primitives (`MarkdownView`, ANSI formatting, transcript rendering) into protocol/runtime.
3. Do not redesign thread item shapes across clients.
4. Do not change protocol notifications or runtime event semantics.
5. Do not address unrelated `ThreadStore` responsibilities such as active question ownership or expanded child-thread fetch orchestration.

# Architectural direction

The reducer boundary should follow the project’s “one runtime, multiple clients” philosophy while respecting that frontend presentation remains client-owned.

- Runtime/protocol remains the source of thread event semantics.
- CLI should reduce those events through a pure function rather than class-local mutation cascades.
- Web and CLI do not need identical item schemas yet, but they should converge on the same architecture: reducer owns state transitions, class/hook owns lifecycle.

The current CLI partial extraction (`reduceThreadStoreEvent`) proves the seam, but it stops too early and returns delegates for the interesting cases. The next iteration should move from:

- **pure reducer + imperative delegate mutations**

to:

- **pure reducer + declarative effects / patches + imperative lifecycle runner**

# Current state snapshot

## Already extracted

- `packages/cli/src/tui/components/thread-event-reducer.ts` owns busy/idle, usage, compaction, knowledge-saved, and error transitions.
- `ThreadStore.handleEvent()` maps reducer output back into mutable class fields.

## Still class-owned and should be planned for extraction

- `message_start` / `message_delta` / `message_end` assistant-flow transitions
- `tool_start` / `tool_update` / `tool_end` transitions
- collab label derivation and collab item creation
- `plan` / `skill` / generic tool result item creation
- thinking-block commit sequencing and assistant chunk commit sequencing

## Should remain class-owned after refactor

- overlay timers and blink refresh intervals
- `MarkdownView` instance lifecycle and invalidation
- async child-thread detail loading / caching
- requestRender triggering
- active prompt/question ownership

# Proposed target design

## Reducer API

Introduce a pure reducer that takes a serializable CLI thread state snapshot and returns the next state plus declarative effects for lifecycle-only work.

```ts
export interface CliThreadState {
  items: ThreadItem[];
  thinkingStartTime: number | null;
  thinkingText: string;
  overlayStatus: ReducerOverlayStatus | null;
  statusBeforeCompaction: string | null;
  isThreadBusy: boolean;
  busyStartedAt: number | null;
  lastUsage: { input: number; output: number; cost: number } | null;
  planCallCount: number;
  hasCommittedAssistantChunkInMessage: boolean;
  collabAgentNamesByThreadId: Record<string, string>;
  collabByToolCallId: Record<string, { toolName: string; label: string; prompt?: string }>;
  toolCalls: Record<
    string,
    {
      startedAt: number;
      input?: unknown;
      startRender?: ToolRenderPayload;
    }
  >;
}

export type CliThreadReducerEffect =
  | { kind: "open_markdown" }
  | { kind: "append_markdown_delta"; text: string }
  | { kind: "finalize_markdown_message" }
  | { kind: "start_status_timers" }
  | { kind: "cleanup_status_timers_if_idle" };

export interface CliThreadReducerResult {
  state: CliThreadState;
  handled: boolean;
  requestRender: boolean;
  effects: CliThreadReducerEffect[];
}

export function reduceThreadEvent(
  state: CliThreadState,
  event: AgentEvent,
  deps: CliThreadReducerDeps,
): CliThreadReducerResult;
```

Notes:

- The reducer should be pure for the same input state + event + deps.
- `deps` may provide deterministic helpers for formatting or item construction, but must not perform I/O.
- Effects should be limited to lifecycle concerns that cannot be represented in plain state.

## ThreadStore role after extraction

`ThreadStore` becomes an orchestration shell around the pure reducer.

```ts
handleEvent(event: AgentEvent): void {
  if (isChildScopedStreamEvent(event)) return;

  const result = reduceThreadEvent(this.snapshotState(), event, this.reducerDeps());
  if (!result.handled) return;

  this.applyReducerState(result.state);
  this.runReducerEffects(result.effects);

  if (result.requestRender) {
    this.options.requestRender();
  }
}
```

`snapshotState()` / `applyReducerState()` should become the only bridge between the mutable class and reducer-owned state.

## Web alignment target

This refactor should borrow the Web structure, not its exact item model:

- one top-level reducer entry point
- state object passed through pure functions
- helper reducers/utilities for specialized domains (tool, collab, hydration-style helpers)
- no hidden secondary imperative path for major event types

That means the CLI reducer can later split into focused helpers such as:

- `reduceAssistantEvent()`
- `reduceCliToolEvent()`
- `reduceCliCollabEvent()`

without keeping core semantics trapped in `ThreadStore` methods.

# File Manifest

## packages/cli/src/tui/components/

| File | Action | Description |
|------|--------|-------------|
| `thread-store.ts` | MODIFY | Shrink class into lifecycle/render owner that snapshots/applies reducer state and runs effects |
| `thread-event-reducer.ts` | MODIFY | Expand partial reducer into the canonical pure `reduceThreadEvent()` entry point |
| `thread-store-utils.ts` | MODIFY | Host pure formatting/item-construction helpers currently buried in class methods |
| `thread-store-primitives.ts` | MODIFY | Optionally add serializable item/state helpers needed by reducer-owned transitions |
| `markdown-view.ts` | MODIFY (optional) | Only if a smaller adapter seam is needed for reducer effects around markdown commit/finalize |

## packages/cli/test/tui/components/

| File | Action | Description |
|------|--------|-------------|
| `thread-event-reducer.test.ts` | MODIFY | Expand pure reducer coverage to assistant/tool/collab transitions |
| `thread-store.test.ts` | MODIFY | Narrow to lifecycle/effects/render integration behavior after extraction |

## packages/web/src/client/lib/

| File | Action | Description |
|------|--------|-------------|
| `app-state.ts` | REFERENCE ONLY | Structural reference for reducer ownership; no functional changes planned |
| `thread-store.ts` | REFERENCE ONLY | Structural reference for reducer decomposition; no functional changes planned |

## docs/plan/refactor/

| File | Action | Description |
|------|--------|-------------|
| `P057-cli-thread-store-reducer-extraction.md` | CREATE | Execution plan for reducer extraction |

# Implementation Tasks

## Task 1: Define the reducer-owned CLI thread state boundary

**Files:** `packages/cli/src/tui/components/thread-event-reducer.ts`, `packages/cli/src/tui/components/thread-store.ts`
**Decisions:** D045, D046

Replace the current narrow reducer state shape with a state object that can fully represent deterministic thread event handling. This is the key contract change: if a transition depends only on current store data + event payload + deterministic helpers, it belongs in reducer state.

```ts
export interface CliThreadReducerState {
  items: ThreadItem[];
  overlayStatus: ReducerOverlayStatus | null;
  thinkingText: string;
  thinkingStartTime: number | null;
  isThreadBusy: boolean;
  busyStartedAt: number | null;
  statusBeforeCompaction: string | null;
  lastUsage: { input: number; output: number; cost: number } | null;
  planCallCount: number;
  hasCommittedAssistantChunkInMessage: boolean;
  toolCalls: Record<string, ToolCallState>;
  collabByToolCallId: Record<string, CollabToolState>;
  collabAgentNamesByThreadId: Record<string, string>;
}
```

`ThreadStore` should stop exposing individual field-by-field reduction logic and instead round-trip reducer state through a dedicated bridge.

**Verify:** `ThreadStore.handleEvent()` can apply reducer-owned state without special-casing message/tool events.

## Task 2: Replace delegate-based message handling with pure assistant-event reduction

**Files:** `packages/cli/src/tui/components/thread-event-reducer.ts`, `packages/cli/src/tui/components/thread-store-utils.ts`, `packages/cli/test/tui/components/thread-event-reducer.test.ts`
**Decisions:** D045

Move `message_start`, `message_delta`, and `message_end` logic out of `runReducerDelegate()` and into reducer-owned state transitions.

Important detail: the reducer should own the decision logic for:

- when thinking text accumulates
- when thinking is committed into a transcript item
- when markdown text becomes an assistant chunk
- when overlay status changes from Thinking to idle

If `MarkdownView` is still needed for rendering-oriented chunk accumulation, keep the instance in the class but drive it through reducer effects rather than freeform mutation.

```ts
export type CliThreadReducerEffect =
  | { kind: "markdown_open" }
  | { kind: "markdown_push"; delta: string }
  | { kind: "markdown_finalize_commit" };
```

The key rule is that the reducer decides **what** should happen; the class only performs the minimal lifecycle action needed to realize that decision.

**Verify:** Pure reducer tests cover streaming thinking-only, text-only, mixed thinking→text, and end-of-message commit sequences.

## Task 3: Move tool/collab result assembly into pure reducer helpers

**Files:** `packages/cli/src/tui/components/thread-event-reducer.ts`, `packages/cli/src/tui/components/thread-store-utils.ts`, `packages/cli/test/tui/components/thread-event-reducer.test.ts`
**Decisions:** D045

Refactor `handleToolEnd()` and the tool start/update branches so the reducer owns deterministic item creation for:

- generic tool results
- structured-render tool results
- `plan` output parsing
- `skill` loaded messages
- collab tools: `spawn_agent`, `wait`, `send_input`, `close_agent`

This likely means introducing pure helpers for tool-item construction and collab label transitions.

```ts
interface ReduceToolEventDeps {
  nowMs: number;
  buildToolResultItem(args: BuildToolResultItemArgs): ThreadItem;
  buildPlanItem(args: BuildPlanItemArgs): ThreadItem;
  buildCollabItem(args: BuildCollabItemArgs): ThreadItem;
}
```

Avoid pushing ANSI/theme concerns into the reducer body directly if helper extraction keeps the reducer legible; however, those helpers must remain pure.

**Verify:** Reducer tests cover `plan`, generic tool output, structured render payloads, and collab spawn/wait completion state.

## Task 4: Collapse ThreadStore into lifecycle/effects owner

**Files:** `packages/cli/src/tui/components/thread-store.ts`, `packages/cli/test/tui/components/thread-store.test.ts`
**Decisions:** D045

After Task 2 and Task 3, remove `runReducerDelegate()` and shrink `handleToolEnd()` into either pure helpers or effect runners.

Remaining `ThreadStore` responsibilities should be explicit:

- reducer state snapshot/apply
- status timer start/cleanup
- markdown effect execution
- child-detail async loading/caching
- imperative utility methods unrelated to event reduction (`setActiveQuestion`, `consumePendingSteers`, etc.)

```ts
private runReducerEffects(effects: CliThreadReducerEffect[]): void {
  for (const effect of effects) {
    switch (effect.kind) {
      case "start_status_timers":
        this.ensureStatusTimers();
        break;
      case "cleanup_status_timers_if_idle":
        this.cleanupStatusTimersIfIdle();
        break;
      case "markdown_open":
      case "markdown_push":
      case "markdown_finalize_commit":
        this.runMarkdownEffect(effect);
        break;
    }
  }
}
```

**Verify:** `thread-store.test.ts` keeps integration coverage for timer-driven rendering and markdown lifecycle behavior while reducer semantics are tested separately.

## Task 5: Lock the architecture with focused tests and follow-up seam checks

**Files:** `packages/cli/test/tui/components/thread-event-reducer.test.ts`, `packages/cli/test/tui/components/thread-store.test.ts`
**Decisions:** D045

Strengthen the tests so future growth does not regress the extraction boundary.

Add assertions that:

- major protocol event types are fully handled by the reducer without class-specific delegates
- pure reducer tests do not require timers, async loading, or `MarkdownView` instances unless explicitly effect-driven
- `ThreadStore` integration tests focus on lifecycle-only behavior rather than reproducing reducer logic exhaustively

Also capture a simple maintainability invariant in test naming or comments: `thread-store.ts` should not be the primary place where event semantics are authored.

**Verify:** CLI test suite for reducer/store passes and code review can trace event semantics from reducer tests first.

# Acceptance Criteria

1. `packages/cli/src/tui/components/thread-store.ts` no longer contains the primary semantic logic for `message_*` and `tool_*` event transitions.
2. CLI exposes a pure reducer entry point that handles deterministic thread event reduction without delegate handoff for major event families.
3. `ThreadStore` remains responsible only for lifecycle/effect execution, timers, async child-detail loading, and render invalidation.
4. `packages/cli/test/tui/components/thread-event-reducer.test.ts` covers assistant, tool, and collab reduction paths beyond the current busy/compaction cases.
5. Existing transcript-visible behavior for plan output, collab output, thinking blocks, and busy overlay remains unchanged.
6. The resulting structure is obviously mappable to the Web reducer architecture, even if no shared module is introduced yet.

# Testing Strategy

| Category | What to Test | How |
|----------|-------------|-----|
| Unit | Pure reducer transitions for assistant/tool/collab events | `bun test packages/cli/test/tui/components/thread-event-reducer.test.ts` |
| Integration | ThreadStore lifecycle effects, markdown handling, status timers | `bun test packages/cli/test/tui/components/thread-store.test.ts` |
| Regression | Transcript rendering parity for plan/collab/thinking flows | CLI component tests under `packages/cli/test/tui/components/` |
| Manual | Stream a turn with thinking, plan tool, and collab events in TUI | Run CLI TUI and inspect transcript/status behavior |

# Risk Areas

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Over-extracting non-serializable Markdown behavior into the pure reducer | Confusing API or hidden impurity | Keep Markdown instance in `ThreadStore`; use reducer effects for imperative interaction |
| Entangling ANSI formatting directly with reducer logic | Reducer becomes hard to read/test | Move formatted item building into pure helper functions with deterministic inputs |
| Conflating reducer extraction with Web/CLI shared-module work | Scope blowup and delayed delivery | Keep this plan CLI-first; document Web alignment as a follow-up seam, not an in-scope merge |
| Accidentally changing transcript-visible ordering or elapsed-time behavior | User-visible regression in TUI | Preserve current snapshots with targeted reducer/store regression tests |
| Leaving half the logic in class methods again | Architecture does not materially improve | Acceptance criterion requires primary `message_*` and `tool_*` semantics to live in reducer code |

# Decisions Referenced

| ID | Summary | Where Used |
|----|---------|------------|
| D045 | TUI uses inline rendering with a custom component framework | Preserves `ThreadStore` as lifecycle/render owner rather than replacing it wholesale |
| D046 | App server/protocol boundary stays above clients | Supports reducer alignment across clients without moving presentation into runtime/core |

# Follow-up after this plan

If P057 lands cleanly, the next planning question is whether a shared client-side event-reduction package is justified. That should be a separate plan only after the CLI reducer shape and the Web reducer shape are close enough to share semantics without forcing one client’s item model onto the other.
