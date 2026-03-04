---
id: P028
status: done
created: 2026-03-04
---

# Fix: Race condition — zombie agent loop corrupts session entries

## Context

When a user sends a steering message + stop (Ctrl+C) while the `wait` tool is running, a race condition causes the `wait` tool's `tool_result` to be appended with the wrong `parentId`. This happens because:

1. `registry.wait()` ignores the abort signal, so it keeps running after abort
2. `consumeStream`'s finally block runs before `executeLoop` finishes — the zombie loop continues to call `handleEvent` → `appendMessageEntry`, mutating `leafId` after a new turn has already started

The result: orphaned `tool_result` entries that cause API rejection (`unexpected tool_use_id found in tool_result blocks`).

## Fix 1: Signal propagation to `registry.wait`

**Goal**: `wait` tool returns immediately when the parent abort signal fires.

### `packages/core/src/collab/wait.ts`
- Pass `ctx.signal` as 4th argument to `registry.wait()`

### `packages/core/src/collab/registry.ts`
- Add optional `signal?: AbortSignal` parameter to `wait()` method
- Create an abort promise that rejects/resolves when signal fires
- Race it alongside the existing `Promise.all(racers)` and `timeoutPromise`
- When aborted, collect current statuses and return `{ status, timedOut: true }`

## Fix 2: Await inner loop completion before auto-submit

**Goal**: `consumeStream`'s finally block waits for `executeLoop` to fully settle before cleaning up state and starting new turns.

### `packages/core/src/event-stream.ts`
- Add `private innerWork?: Promise<void>`
- Add `setInnerWork(promise: Promise<void>)` method
- Add `waitForInnerWork(): Promise<void>` method (returns `Promise.resolve()` if unset)

### `packages/core/src/session/manager.ts`
- In `run()`: capture the `executeLoop(...).catch(...)` promise
- Call `outerStream.setInnerWork(promise)` with it

### `packages/core/src/app-server/server.ts`
- In `consumeStream` finally block: `await stream.waitForInnerWork().catch(() => {})` **before** clearing `runtime.abortController` and `runtime.isRunning`

## Verification

1. Run existing tests: `bun test`
2. Manual test: start a session with subagents, send steering + Ctrl+C while `wait` is running — verify no API error on next turn
