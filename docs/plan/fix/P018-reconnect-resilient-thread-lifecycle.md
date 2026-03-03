---
id: P018
status: done
created: 2026-03-03
---

# Reconnect-resilient thread lifecycle

## Context

Web client's session lifecycle is tied to the WebSocket connection. When the user refreshes the page or the socket reconnects, in-progress operations (tool execution, sub-agent runs) become invisible to the client:

1. **UI loses busy state**: After reconnect, `thread/read` doesn't report whether a turn is running. The UI always shows "idle" even when tools/sub-agents are still executing on the server.
2. **Notifications silently dropped during disconnect gap**: When `close()` fires, `routeNotification` finds no live session for the thread and silently drops events (`sessions.get(ownerSessionId)` returns `null` after `sessions.delete()`). Notifications during the gap between disconnect and reconnect are lost.

## Changes

### 1. Protocol: add `isRunning` to `ThreadReadResponse`

**File**: `packages/protocol/src/client-requests.ts`

Add `isRunning: z.boolean()` to `ThreadReadResponseSchema`. This tells the client whether the thread has an active turn.

### 2. App server: return `isRunning` from `handleThreadRead`

**File**: `packages/core/src/app-server/server.ts`

```diff
- return { messages, hasFollowUp, entryCount };
+ return { messages, hasFollowUp, entryCount, isRunning: runtime.isRunning };
```

### 3. RPC bridge: broadcast when owner session is dead

**File**: `packages/web/src/server/rpc-bridge.ts`

Two changes:

**a) `close()` — keep thread ownership alive**

Don't delete `threadOwners` entry on disconnect. The entry will be overwritten when a new session resumes the thread.

```diff
- if (session.currentThreadId) {
-   this.threadOwners.delete(session.currentThreadId);
- }
```

**b) `routeNotification()` — broadcast instead of dropping**

When the owning session is dead (disconnected), fall back to broadcast instead of silently dropping:

```diff
  const session = this.sessions.get(ownerSessionId);
  if (!session) {
-   return;
+   this.broadcast({ type: "server_notification", notification });
+   return;
  }
```

This ensures notifications that arrive while the client is reconnecting reach any currently-connected session (including the new one if it connected fast enough).

### 4. Client: set `threadStatus` from `isRunning` on hydrate

**File**: `packages/web/src/client/lib/thread-store.ts`

In `hydrateFromThreadRead`, read `isRunning` from the payload and set `threadStatus`:

```diff
  const base: ThreadState = {
    ...state,
    items: [],
    seenKeys: {},
    itemSlots: {},
    usage: zeroUsage,
    planState: null,
+   threadStatus: payload.isRunning ? "busy" : "idle",
  };
```

## Files touched

| File | Change |
|------|--------|
| `packages/protocol/src/client-requests.ts` | Add `isRunning` to schema |
| `packages/core/src/app-server/server.ts` | Return `isRunning` in `handleThreadRead` |
| `packages/web/src/server/rpc-bridge.ts` | Keep thread ownership on disconnect; broadcast to live sessions when owner is dead |
| `packages/web/src/client/lib/thread-store.ts` | Set `threadStatus` from `isRunning` in `hydrateFromThreadRead` |

## Verification

1. `bun test` — existing protocol and collab tests pass
2. Manual: start a long turn (e.g. sub-agent), refresh browser mid-execution
   - After reconnect, UI shows "busy" with pulsing status dot
   - When the turn completes, UI transitions to "idle"
   - Chat history is fully restored
3. Manual: disconnect briefly (DevTools > Network > Offline), reconnect
   - Events that fired during the gap appear (broadcast fallback)
   - Future events continue streaming normally
