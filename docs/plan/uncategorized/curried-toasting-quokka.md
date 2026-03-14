---
id: P047
title: Split AgentEvent — CoreAgentEvent in core, RuntimeAgentEvent in runtime
type: refactor
status: proposed
owner: diligent
created: 2026-03-14
---

# Context

`packages/core/src/agent/types.ts` defines `AgentEvent` as a flat union of all event types, but only the events that `loop.ts` actually emits belong in core. Runtime-specific events (compaction, knowledge, collab) are currently defined in core despite being emitted from `packages/runtime`.

Additionally, `packages/core/package.json` lists `@diligent/protocol` as a dependency, but no source file in `packages/core/src/` currently imports from it. This dead dependency should be removed.

This plan is a focused implementation slice of P046 Phase 1.

**Layer target:**
```
protocol   (independent)
core       (independent — no protocol dependency)
runtime    (depends on core + protocol)
cli/web    (depend on runtime)
```

# What `loop.ts` actually emits (stays in core)

Confirmed by grepping `stream.push` in `packages/core/src/agent/loop.ts`:

```
agent_start, agent_end
turn_start, turn_end
message_start, message_delta, message_end
tool_start, tool_update, tool_end
status_change, usage, error
loop_detected, steering_injected
```
Total: 15 event types → `CoreAgentEvent`

# What runtime emits (moves to runtime)

```
compaction_start, compaction_end   ← runtime/src/session/manager.ts
knowledge_saved                    ← runtime/src/tools/add-knowledge.ts
collab_spawn_begin/end             ← runtime/src/collab/registry.ts
collab_wait_begin/end              ← runtime/src/collab/registry.ts
collab_close_begin/end             ← runtime/src/collab/registry.ts
collab_interaction_begin/end       ← runtime/src/collab/registry.ts
```
Total: 12 event types → `RuntimeAgentEvent`

# Tasks

## Task 1 — core/agent/types.ts

- Rename `AgentEvent` → `CoreAgentEvent`
- Remove 12 runtime event types
- Remove inline collab helper types: `CollabAgentStatus`, the inline agent-ref/status-entry shapes (these live in `@diligent/protocol` as `CollabAgentStatus`, `CollabAgentRef`, `CollabAgentStatusEntry`)

Resulting shape:
```ts
export type CoreAgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: Message[] }
  | { type: "turn_start"; turnId: string; childThreadId?: string; nickname?: string; turnNumber?: number }
  | { type: "turn_end"; turnId: string; message: AssistantMessage; toolResults: ToolResultMessage[] }
  | { type: "message_start"; itemId: string; message: AssistantMessage }
  | { type: "message_delta"; itemId: string; message: AssistantMessage; delta: MessageDelta }
  | { type: "message_end"; itemId: string; message: AssistantMessage }
  | { type: "tool_start"; itemId: string; toolCallId: string; toolName: string; input: unknown; childThreadId?: string; nickname?: string }
  | { type: "tool_update"; itemId: string; toolCallId: string; toolName: string; partialResult: string; childThreadId?: string; nickname?: string }
  | { type: "tool_end"; itemId: string; toolCallId: string; toolName: string; output: string; isError: boolean; childThreadId?: string; nickname?: string }
  | { type: "status_change"; status: "idle" | "busy" | "retry"; retry?: { attempt: number; delayMs: number } }
  | { type: "usage"; usage: Usage; cost: number }
  | { type: "error"; error: SerializableError; fatal: boolean }
  | { type: "loop_detected"; patternLength: number; toolName: string }
  | { type: "steering_injected"; messageCount: number; messages: Message[] };
```

## Task 2 — core/agent/loop.ts

- Update import: `AgentEvent` → `CoreAgentEvent`

## Task 3 — core/agent/index.ts

- Update re-export: `AgentEvent` → `CoreAgentEvent`

## Task 4 — core/index.ts

- Update re-export: `AgentEvent` → `CoreAgentEvent`

## Task 5 — core/package.json

- Remove `@diligent/protocol` from `dependencies` (no source files in core/src/ import it)

## Task 6 — runtime/src/agent-event.ts (new file)

```ts
// @summary AgentEvent union — CoreAgentEvent extended with runtime-emitted events
import type { CoreAgentEvent } from "@diligent/core";
import type { CollabAgentStatus, CollabAgentRef, CollabAgentStatusEntry } from "@diligent/protocol";

export type RuntimeAgentEvent =
  | { type: "compaction_start"; estimatedTokens: number }
  | { type: "compaction_end"; tokensBefore: number; tokensAfter: number; summary: string; tailMessages?: Array<{ role: string; preview: string }> }
  | { type: "knowledge_saved"; knowledgeId: string; content: string }
  | { type: "collab_spawn_begin"; callId: string; prompt: string; agentType: string }
  | { type: "collab_spawn_end"; callId: string; childThreadId: string; nickname?: string; agentType?: string; description?: string; prompt: string; status: CollabAgentStatus; message?: string }
  | { type: "collab_wait_begin"; callId: string; agents: CollabAgentRef[] }
  | { type: "collab_wait_end"; callId: string; agentStatuses: CollabAgentStatusEntry[]; timedOut: boolean }
  | { type: "collab_close_begin"; callId: string; childThreadId: string; nickname?: string }
  | { type: "collab_close_end"; callId: string; childThreadId: string; nickname?: string; status: CollabAgentStatus; message?: string }
  | { type: "collab_interaction_begin"; callId: string; receiverThreadId: string; receiverNickname?: string; prompt: string }
  | { type: "collab_interaction_end"; callId: string; receiverThreadId: string; receiverNickname?: string; prompt: string; status: CollabAgentStatus };

export type AgentEvent = CoreAgentEvent | RuntimeAgentEvent;
```

## Task 7 — runtime internal imports (9 files)

Change `import type { AgentEvent } from "@diligent/core/agent/types"` →
`import type { AgentEvent } from "../agent-event"` (adjust relative path per file):

| File | New import path |
|------|----------------|
| `runtime/src/app-server/event-mapper.ts` | `../agent-event` |
| `runtime/src/app-server/server.ts` | `../agent-event` |
| `runtime/src/collab/types.ts` | `../agent-event` |
| `runtime/src/collab/__tests__/helpers.ts` | `../../agent-event` |
| `runtime/src/collab/__tests__/registry.test.ts` | `../../agent-event` |
| `runtime/src/notification-adapter.ts` | `./agent-event` |
| `runtime/src/session/manager.ts` | `../agent-event` |
| `runtime/src/session/__tests__/manager.test.ts` | `../../agent-event` |
| `runtime/src/session/__tests__/steering.test.ts` | `../../agent-event` |

Note: `runtime/src/client.ts` and `runtime/src/index.ts` re-export `AgentEvent` from `@diligent/core` today; after this change they should import from `./agent-event` instead.

## Task 8 — runtime/src/index.ts and runtime/src/client.ts

- Remove `AgentEvent` from the `@diligent/core` re-export block
- Add `export type { AgentEvent, RuntimeAgentEvent } from "./agent-event"`
- `CoreAgentEvent` can also be re-exported if consumers need it: `export type { CoreAgentEvent } from "@diligent/core"`

# Files touched

```
packages/core/src/agent/types.ts       (rename + remove 12 types)
packages/core/src/agent/loop.ts        (import rename)
packages/core/src/agent/index.ts       (export rename)
packages/core/src/index.ts             (export rename)
packages/core/package.json             (remove @diligent/protocol dep)
packages/runtime/src/agent-event.ts   (NEW)
packages/runtime/src/app-server/event-mapper.ts
packages/runtime/src/app-server/server.ts
packages/runtime/src/collab/types.ts
packages/runtime/src/collab/__tests__/helpers.ts
packages/runtime/src/collab/__tests__/registry.test.ts
packages/runtime/src/notification-adapter.ts
packages/runtime/src/session/manager.ts
packages/runtime/src/session/__tests__/manager.test.ts
packages/runtime/src/session/__tests__/steering.test.ts
packages/runtime/src/client.ts
packages/runtime/src/index.ts
```

# Not in scope

- `packages/protocol/src/data-model.ts` — `AgentEventSchema` is the wire format; unchanged
- CLI, web, e2e — already import `AgentEvent` from `@diligent/runtime`; no changes needed
- Removing other protocol imports from core (provider, model, render types) — tracked in P046

# Verification

```bash
cd packages/core && bun run typecheck
cd packages/runtime && bun run typecheck
bun test packages/runtime
bun test packages/core
```

Confirm `@diligent/protocol` does not appear in `packages/core/package.json` after the change.
