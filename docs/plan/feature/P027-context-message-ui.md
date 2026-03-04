---
id: P027
status: done
created: 2026-03-04
---

# Render compaction summary as context UI, not user bubble

## Context

When a session is reopened, `context-builder.ts` injects the compaction summary as `role: "user"` for the LLM. The Web UI's `hydrateFromThreadRead()` treats it as a regular user message and renders it as a user bubble — confusing because the user never wrote it. This only happens on session reload; real-time compaction shows a toast.

**Goal:** Add `kind: "context"` to `RenderItem` so summary messages render as a collapsible system-like element, not a user bubble.

## Changes

### 1. Export `SUMMARY_PREFIX` and `isSummaryMessage` from core/client

**File:** `packages/core/src/client.ts`

All imports in `compaction.ts` are `import type`, so re-exporting is browser-safe:

```typescript
export { SUMMARY_PREFIX, isSummaryMessage } from "./session/compaction";
```

### 2. Add `kind: "context"` to RenderItem

**File:** `packages/web/src/client/lib/thread-store.ts`

Add variant to the union:

```typescript
| { id: string; kind: "context"; summary: string; timestamp: number }
```

### 3. Detect summary in `hydrateFromThreadRead()`

**File:** `packages/web/src/client/lib/thread-store.ts`

In the `message.role === "user"` branch, check `isSummaryMessage()` first. If true, strip `SUMMARY_PREFIX` and create `kind: "context"` item. Otherwise create `kind: "user"` as before.

### 4. Create `ContextMessage` component

**File:** `packages/web/src/client/components/ContextMessage.tsx` (new)

- Collapsed by default: single line "Previous context (compacted)" with disclosure triangle
- Expandable: click reveals full summary rendered via `MarkdownContent`
- Muted system-like styling: `text-muted`, subtle border, no user bubble appearance

### 5. Wire into MessageList

**File:** `packages/web/src/client/components/MessageList.tsx`

Add `kind: "context"` branch → `<ContextMessage>`.

### TUI

Not affected — TUI uses streaming events, not `thread/read` hydration.

## Verification

1. `bun test` — existing tests pass
2. Open a session that had compaction → summary renders as collapsible context block, not user bubble
3. Regular user messages still render as bubbles
4. Click to expand context → markdown summary renders correctly
