---
id: P062
status: in-progress
created: 2026-04-06
---

# Compacting Indicator Component (Web UI)

## Goal

Replace toast notifications for compaction start/end events with a dedicated "Compacting..." inline component rendered in the conversation view, providing persistent, contextual feedback during compaction.

## Prerequisites

- `compaction_start` / `compaction_end` AgentEvents already flow through the thread-store reducer.
- `StreamingIndicator` component exists as a style reference.

## Artifact

During compaction (automatic or manual):
- A `CompactingIndicator` appears in the message list area (below messages, above input), styled similarly to `StreamingIndicator`.
- No toast notification is shown for compaction start or end.
- On error during manual compaction, an error toast is shown as before.

## Scope

### What changes

| Area | What Changes |
|------|-------------|
| `packages/web/src/client/lib/thread-store.ts` | Add `isCompacting: boolean` to `ThreadState`; reducer handles `compaction_start`/`compaction_end`/`compaction_error` actions instead of toasting |
| `packages/web/src/client/components/CompactingIndicator.tsx` | New component — animated "Compacting…" pill, styled like `StreamingIndicator` |
| `packages/web/src/client/components/MessageList.tsx` | Add `isCompacting?: boolean` prop; render `CompactingIndicator` below messages |
| `packages/web/src/client/App.tsx` | Remove local `isCompacting` state; pass `state.isCompacting` to `MessageList` and `use-app-actions` |
| `packages/web/src/client/lib/use-app-actions.ts` | Remove `isCompacting`/`setIsCompacting` props; remove toast calls for compaction start/end; dispatch `compaction_error` on failure |

### What does NOT change

- TUI compaction UX (separate concern).
- Protocol event types or runtime compaction logic.
- `ContextMessage` component (compaction checkpoint rendering after compaction completes).
- Title bar "Compacting…" text indicator (kept as-is, driven by `state.isCompacting`).

## File Manifest

### packages/web/src/client/lib/

| File | Action | Description |
|------|--------|------------|
| `thread-store.ts` | MODIFY | Add `isCompacting` state field; update `compaction_start`/`compaction_end` cases; add `compaction_error` action |
| `use-app-actions.ts` | MODIFY | Remove `isCompacting`/`setIsCompacting` params; remove compaction toasts; dispatch `compaction_error` on catch |

### packages/web/src/client/components/

| File | Action | Description |
|------|--------|------------|
| `CompactingIndicator.tsx` | CREATE | Animated "Compacting…" pill component |
| `MessageList.tsx` | MODIFY | Accept `isCompacting` prop; render `CompactingIndicator` |

### packages/web/src/client/

| File | Action | Description |
|------|--------|------------|
| `App.tsx` | MODIFY | Remove local `isCompacting` state; wire `state.isCompacting` to `MessageList` and action handler |

## Implementation Tasks

### Task 1: Add `isCompacting` to thread-store

**Files:** `packages/web/src/client/lib/thread-store.ts`

Add `isCompacting: boolean` to `ThreadState`. Default `false`. Replace toast dispatch in `compaction_start`/`compaction_end` cases. Add `compaction_error` action that resets `isCompacting`.

```typescript
// ThreadState addition
isCompacting: boolean;

// Reducer cases
case "compaction_start":
  return { ...state, isCompacting: true };

case "compaction_end":
  return { ...state, isCompacting: false };

// New action type
case "compaction_error":
  return { ...state, isCompacting: false };
```

### Task 2: Create CompactingIndicator component

**Files:** `packages/web/src/client/components/CompactingIndicator.tsx`

```typescript
export function CompactingIndicator() {
  return (
    <div className="flex items-center gap-2 rounded-full border border-border/10 bg-surface/50 px-4 py-2 text-sm text-muted shadow-sm">
      <span className="flex gap-1">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-info" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-info [animation-delay:200ms]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-info [animation-delay:400ms]" />
      </span>
      Compacting…
    </div>
  );
}
```

### Task 3: Update MessageList to render CompactingIndicator

**Files:** `packages/web/src/client/components/MessageList.tsx`

Add `isCompacting?: boolean` to `MessageListProps`. Render `CompactingIndicator` when `isCompacting` is true and `threadStatus` is not busy (compaction can run while idle, between turns, or during busy — render it whenever true).

### Task 4: Update App.tsx

**Files:** `packages/web/src/client/App.tsx`

- Remove `const [isCompacting, setIsCompacting] = useState(false)`
- Remove `showCompactingIndicator` (use `state.isCompacting` directly)
- Pass `isCompacting={state.isCompacting}` to `MessageList`
- Remove `isCompacting` and `setIsCompacting` from `useAppActions` call

### Task 5: Update use-app-actions.ts

**Files:** `packages/web/src/client/lib/use-app-actions.ts`

- Remove `isCompacting: boolean` and `setIsCompacting` from params/deps
- Remove toast dispatches for compaction start/success
- Keep error toast; dispatch `{ type: "compaction_error" }` in the catch block
- Guard against double-trigger using `state.isCompacting` from store

## Acceptance Criteria

1. During compaction (automatic or manual), `CompactingIndicator` appears in the message list area.
2. No toast is shown for compaction start or end.
3. On manual compaction error, an error toast is still shown.
4. `isCompacting` state resets correctly after compaction ends or errors.
5. Title bar "Compacting…" text indicator continues to work (driven by `state.isCompacting`).
6. `bun run build` passes with no type errors.

## Risk Areas

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Manual compaction error leaves `isCompacting: true` stuck | UX frozen in compacting state | Dispatch `compaction_error` in catch block |
| `compaction_end` event arrives before `THREAD_READ` completes | Brief flash of non-compacting state | Acceptable — compaction itself is done |
