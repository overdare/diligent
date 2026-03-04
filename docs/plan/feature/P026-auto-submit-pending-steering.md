---
id: P026
status: done
created: 2026-03-04
---

# Auto-submit pending steering on stop

## Context

When the user types a message while the agent is running, it's queued as a steering message in `SessionManager.steeringQueue`. If the agent loop drains it in time, it gets injected mid-conversation. But if the user presses **stop** (Ctrl+C / cancel) before the steering is drained, the message sits in the queue indefinitely. The user's latest intent is lost — they have to retype it.

Expected: after stop, any pending steering messages should automatically become the input for the next turn.

## What Changes

| File | Change |
|------|--------|
| `packages/core/src/session/manager.ts` | Add `popPendingSteering(): string[] \| null` |
| `packages/core/src/app-server/server.ts` | In `consumeStream` finally, auto-start turn from pending steering |

## Implementation

### SessionManager — expose pending steering

```typescript
/** Pop any undrained steering messages. Returns null if empty. */
popPendingSteering(): string[] | null {
  if (this.steeringQueue.length === 0) return null;
  const contents = this.steeringQueue.map((m) => (typeof m.content === "string" ? m.content : ""));
  this.steeringQueue.length = 0;
  return contents;
}
```

### App Server — auto-submit after stop

In `consumeStream`, after the finally block sets `isRunning = false` and emits idle, check for pending steering and auto-start:

```typescript
finally {
  runtime.abortController = null;
  runtime.isRunning = false;
  await this.emit({
    method: DILIGENT_SERVER_NOTIFICATION_METHODS.THREAD_STATUS_CHANGED,
    params: { threadId: runtime.id, status: "idle" },
  });

  // Auto-submit pending steering messages as next turn
  const pendingSteering = runtime.manager.popPendingSteering();
  if (pendingSteering && pendingSteering.length > 0) {
    const message = pendingSteering.join("\n");
    await this.handleTurnStart(runtime.id, message);
  }
}
```

This reuses the existing `handleTurnStart` — it emits `TURN_STARTED`, creates a new `AbortController`, and starts the agent loop. The TUI/Web see idle → busy naturally.

## What Does NOT Change

- `steer()` / `drainSteeringQueue()` — existing mid-loop steering unchanged
- `followUp()` — already handled by post-loop follow-up mechanism
- TUI / Web frontends — no changes needed, they react to server notifications

## Verification

1. `bun run typecheck`
2. `bun test` — full suite
3. Manual TUI test:
   - Start a long-running task
   - Type "do X instead" while agent is running
   - Press Ctrl+C
   - Verify: "do X instead" auto-submits as the next turn immediately
4. Manual Web test: same flow via web UI stop button
