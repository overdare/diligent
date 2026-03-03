---
id: P002
status: done
created: 2026-02-27
---

status: done
---

# Steering Queue Implementation Plan

## Context

The agent loop currently has no mechanism for external intervention during execution. Once `SessionManager.run()` starts, the only option is abort (kill). The attractor spec (§2.5-2.6) defines a two-queue steering pattern: `steer()` for mid-task redirection and `follow_up()` for post-task continuation. This is a P1 backlog item and a key enabler for library-first usage.

Loop detection already demonstrates the injection pattern: user-role messages pushed into `allMessages[]` at natural breakpoints. Steering generalizes this to an externally-controlled queue.

## Changes

### 1. Session types — `packages/core/src/session/types.ts`

Add `SteeringEntry`:
```typescript
export interface SteeringEntry {
  type: "steering";
  id: string;
  parentId: string | null;
  timestamp: string;
  message: Message;
  source: "steer" | "follow_up";
}
```

- Add `SteeringEntry` to `SessionEntry` union
- Bump `SESSION_VERSION` 3 → 4

### 2. Agent types — `packages/core/src/agent/types.ts`

Add `getSteeringMessages` callback to `AgentLoopConfig`:
```typescript
getSteeringMessages?: () => Message[];
```

Add event to `AgentEvent` union:
```typescript
| { type: "steering_injected"; messageCount: number }
```

### 3. Agent loop — `packages/core/src/agent/loop.ts`

Add `drainSteering()` helper:
```typescript
function drainSteering(config, allMessages, stream): boolean {
  if (!config.getSteeringMessages) return false;
  const msgs = config.getSteeringMessages();
  if (msgs.length === 0) return false;
  for (const msg of msgs) allMessages.push(msg);
  stream.push({ type: "steering_injected", messageCount: msgs.length });
  return true;
}
```

Two drain points in `runLoop()`:
- **Before LLM call** (line ~91, before `streamAssistantResponse`): drain steering so injected messages are visible to the next LLM call
- **After tool execution** (line ~177, after tool loop, before loop detection): drain steering between tool rounds for mid-task redirection

### 4. SessionManager — `packages/core/src/session/manager.ts`

**New private state:**
```typescript
private steeringQueue: Message[] = [];
private followUpQueue: Message[] = [];
```

**New public API:**
- `steer(content: string)` — Creates `[Steering] ${content}` user-role message, pushes to `steeringQueue`, persists `SteeringEntry`
- `followUp(content: string)` — Creates user-role message, pushes to `followUpQueue`, persists `SteeringEntry`
- `hasFollowUp(): boolean` — Check if follow-up messages are pending

**Private wiring:**
- `drainSteering(): Message[]` — Returns and clears steeringQueue
- `appendSteeringEntry(message, source)` — Persist to JSONL (same pattern as `appendModeChange`)
- `resolveAgentConfig()` gains `getSteeringMessages: () => this.drainSteering()`

**Follow-up loop — refactor `runWithCompaction` + `proxyAgentLoop`:**
- Extract `runAgentLoopInner()` that proxies events but filters `agent_start`/`agent_end` from inner stream
- `runWithCompaction` pushes `agent_start` at beginning, `agent_end` at end
- After first agent loop, while `followUpQueue` is non-empty: drain follow-ups into messages, run another inner loop

### 5. Context builder — `packages/core/src/session/context-builder.ts`

Handle `SteeringEntry` in both compacted and non-compacted branches:
```typescript
case "steering":
  messages.push(entry.message);
  break;
```

### 6. Exports — `packages/core/src/session/index.ts` + `packages/core/src/index.ts`

Export `SteeringEntry` type.

## File List

| File | Change |
|------|--------|
| `packages/core/src/session/types.ts` | SteeringEntry, SESSION_VERSION 4 |
| `packages/core/src/agent/types.ts` | getSteeringMessages, steering_injected event |
| `packages/core/src/agent/loop.ts` | drainSteering helper + 2 drain points |
| `packages/core/src/session/manager.ts` | steer(), followUp(), queues, follow-up loop, refactored proxy |
| `packages/core/src/session/context-builder.ts` | SteeringEntry → Message |
| `packages/core/src/session/index.ts` | Export SteeringEntry |
| `packages/core/src/index.ts` | Export SteeringEntry |
| `packages/core/test/agent-loop-steering.test.ts` | New: drain tests |
| `packages/core/test/session-steering.test.ts` | New: steer/followUp API + persistence tests |

## Verification

```bash
bun test                  # All 575+ existing tests pass
bun run typecheck         # No type errors
bun run lint              # Clean
```

New test coverage:
- Agent loop drain: before LLM (messages visible to next call), after tools (mid-task), empty queue (no-op)
- SessionManager.steer(): queue + persist + drain lifecycle
- SessionManager.followUp(): queue + persist + triggers new agent loop
- Context builder: SteeringEntry correctly produces user-role messages on resume
- Session version: VERSION = 4
