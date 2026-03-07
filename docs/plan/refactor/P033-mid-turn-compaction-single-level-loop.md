---
id: P033
status: pending
created: 2026-03-06
decisions: [D095]
---

# Mid-Turn Compaction: Move Production Turn Ownership into `SessionManager`

## Context

Compaction currently triggers only at two session-manager boundaries:

1. **Proactive** — before entering the inner agent loop
2. **Reactive** — after the inner agent loop fails with `context_overflow`

There is still **no compaction check between turns inside one `agentLoop()` invocation**. If a session starts near the threshold and the model performs multiple tool-use turns inside the same loop, token growth is invisible to `SessionManager` until the provider rejects the next request.

### Current shape

```text
runSession()                ← owns compaction + persistence
  └─ agentLoop()            ← owns multi-turn LLM/tool loop
       ├─ turn 1: LLM → tools
       ├─ turn 2: LLM → tools   ← token growth happens here
       └─ turn N: ...
```

The architectural mismatch is simple:

- `SessionManager` owns compaction and persistence
- `agentLoop()` owns the in-flight `allMessages` array across turns
- therefore `SessionManager` cannot compact or replace the active context between turns without exiting and re-entering `agentLoop()`

## Review corrections from the second pass

The first draft was directionally right, but it overstated how much can be deleted. The current codebase adds a few important constraints.

### 1. `agentLoop()` is not internal-only

`agentLoop()` is still part of the public core surface and has direct consumers:

- `packages/core/test/agent-loop.test.ts`
- `packages/core/test/agent-loop-steering.test.ts`
- `packages/core/test/agent-loop-retry.test.ts`
- `packages/core/test/agent-mode-filter.test.ts`
- `packages/e2e/conversation.test.ts`
- `@diligent/core` public exports

So P033 should **remove `agentLoop()` from the production `SessionManager` path**, but **must not remove the public wrapper API** in this change.

### 2. `resolveAgentConfig()` must still run at each turn boundary

Today `SessionManager.runSession()` deliberately re-resolves agent config before each outer re-entry. That matters because app-server factories read live runtime state on each call:

- `runtime.mode`
- `runtime.effort`
- `runtime.abortController.signal`
- approval / user-input callbacks
- current model selection
- permission engine
- tool assembly via `buildDefaultTools(...)`
- optional fresh `AgentRegistry` instances

The app-server already has explicit logic to re-bind collab handlers when `runtime.registry` changes. A single-level design must preserve this by **resolving config at the top of every turn**, then deriving turn-local resources from that resolved config.

### 3. Steering timing is microtask-sensitive

Current comments in `manager.ts` are correct: when `agentConfig` resolves synchronously, the first `drainSteering()` must still happen without introducing an unnecessary async boundary before turn 1. Otherwise immediate `steer()` calls after `run()` can land on the wrong turn.

### 4. Pending-message rebuilds are mostly an artifact of the 2-level split

Today the outer loop sometimes rebuilds context from persisted entries because the active message array lived inside `agentLoop()`. After flattening, `runSession()` will own the live `currentMessages` array directly, so steering follow-ups can usually append in place instead of rebuilding the entire context.

## Goal

Move the **production** multi-turn loop into `SessionManager.runSession()` so compaction can trigger **between any two turns**, not only before or after a whole `agentLoop()` invocation.

## Non-Goals

- Changing compaction logic itself (`performCompaction`, `shouldCompact`, `generateSummary`)
- Changing the session entry model or persistence format
- Changing provider streaming semantics
- Changing collab/sub-agent architecture
- Removing the public `agentLoop()` API in this plan
- Redesigning mode / effort / approval protocols

## D095: `SessionManager` owns the production turn loop; `agentLoop()` stays as a compatibility wrapper

- **Decision**: Move the production turn loop into `SessionManager.runSession()` so it owns active messages, compaction checks, and persistence in one place. Keep `agentLoop()` as a public compatibility/composition API built on shared helpers.
- **Rationale**: Mid-turn compaction requires access to the live message array between turns. That ownership belongs in `SessionManager`, not across an inner stream boundary. However, `agentLoop()` is still publicly exported and directly used by tests and e2e flows, so deleting it in P033 would widen scope unnecessarily.
- **Date**: 2026-03-06

## Design

## Behavioral invariants to preserve

1. **Same event contract**: `AgentEvent` ordering and payload shapes stay compatible.
2. **Per-turn dynamic config**: mode, effort, model, tools, permission filtering, approval callbacks, and collab registry refresh must still be picked up at turn boundaries.
3. **No mid-tool interruption**: compaction only runs before an LLM call, never during tool execution.
4. **First-turn steering timing**: synchronous config factories must still allow immediate steering injection on turn 1.
5. **Public compatibility**: direct `agentLoop()` consumers keep working.

### Before

```text
SessionManager.runSession()
  ├─ proactive compaction check
  ├─ while (true)
  │    ├─ resolveAgentConfig()
  │    ├─ agentLoop(currentMessages, config)
  │    │    └─ while (turnCount < maxTurns)
  │    │         ├─ drainSteering
  │    │         ├─ streamAssistantResponse
  │    │         ├─ executeTools
  │    │         └─ continue / break
  │    ├─ relay inner events to outer stream
  │    ├─ persist via handleEvent(...)
  │    ├─ catch context_overflow → compact → retry
  │    └─ pendingMessages? rebuild context and re-enter
  └─ end
```

### After

```text
SessionManager.runSession()
  ├─ agent_start
  ├─ while (turnCount < maxTurns)
  │    ├─ resolveAgentConfig()                    ← every turn
  │    ├─ derive turn resources from config       ← tools / registry / prompts / retry
  │    ├─ compaction check                        ← proactive on turn 1, mid-turn later
  │    ├─ drainSteering                           ← persist immediately
  │    ├─ streamAssistantResponse                 ← shared helper
  │    ├─ persist assistant message + usage
  │    ├─ executeToolCalls                        ← shared helper
  │    ├─ persist tool results
  │    ├─ loop detection
  │    └─ continue / break
  └─ agent_end
```

### Key ownership change

`runSession()` becomes the owner of the live `currentMessages` array.

That enables three things cleanly:

- after compaction, replace `currentMessages` in place
- after steering, append directly to `currentMessages` and persist immediately
- after tool execution, keep the updated context without exiting and re-entering another loop abstraction

## What Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/core/src/session/manager.ts` | MODIFY | Inline the production turn loop, add a turn-top compaction check, and persist messages directly without inner-stream relaying |
| `packages/core/src/agent/loop.ts` | MODIFY | Extract reusable turn helpers and keep `agentLoop()` as a thin compatibility wrapper |
| `packages/core/src/agent/index.ts` | MODIFY | Re-export extracted helpers as needed while keeping `agentLoop` |
| `packages/core/src/index.ts` | MODIFY | Preserve public exports; add helper exports only if intended |
| `packages/core/test/session-manager.test.ts` | MODIFY | Add mid-turn compaction coverage at the session-manager level |
| `packages/core/test/agent-loop*.test.ts` | VERIFY / minimal touch | Wrapper should keep these tests green with little or no rewrite |
| `packages/e2e/conversation.test.ts` | VERIFY | Direct `agentLoop()` API remains intact |
| `packages/e2e/mode-and-config.test.ts` | VERIFY | Confirms per-turn config resolution semantics still hold |

## What Does NOT Change

- `compaction.ts` core logic
- `context-builder.ts` semantics
- session entry types and JSONL persistence format
- collab / sub-agent architecture
- app-server registry rebind strategy when a fresh `AgentRegistry` appears
- `AgentEvent` shapes
- public `agentLoop()` availability

## Implementation

### Task 1: `packages/core/src/agent/loop.ts` — Extract shared turn primitives

#### Scope

Refactor `loop.ts` so `SessionManager` can reuse the same turn mechanics without calling the public `agentLoop()` stream wrapper.

#### Required changes

1. Export read-only helpers that are already conceptually shared:
   - `extractLatestPlanState`
   - `withPlanStateInjected`
2. Export or extract turn-construction helpers:
   - `drainSteering`
   - `streamAssistantResponse`
   - tool-execution helper for sequential/parallel tool calls
   - turn-runtime builder for active tools, registry, prompt, retry wrapper
3. Keep small utility functions reusable where needed:
   - `filterAllowedTools`
   - `toolPermission`
   - `toolToDefinition`
   - `createEmptyAssistantMessage`
   - `calculateCost`
   - `toSerializableError`
4. Adjust `drainSteering` so `SessionManager` can persist drained messages directly without re-reading event payloads later.

#### Notes

- Do not change `AgentEvent` payload shapes.
- Do not change provider-stream event handling semantics.
- Keep `agentLoop()` behavior stable for direct callers.

#### Acceptance criteria

- `agentLoop()` still passes existing unit tests unchanged or with only import-level touch-ups.
- Extracted helpers are sufficient for `SessionManager` to run turns without nesting `agentLoop()`.

### Task 2: `packages/core/src/session/manager.ts` — Inline the production turn loop

#### Scope

Replace the current nested `agentLoop()` production path with a single `runSession()` turn loop owned by `SessionManager`.

#### Required changes

1. Keep `run()` startup behavior intact:
   - user message appended first
   - context built from session entries
   - outer stream created once
   - sync config resolution path preserved when possible
2. Rewrite `runSession()` so it:
   - owns `currentMessages`
   - resolves config at the top of every turn
   - derives turn-local runtime data from the resolved config
   - performs turn-top compaction checks
   - drains steering directly into `currentMessages`
   - streams assistant response directly
   - persists assistant messages directly
   - executes tools directly
   - persists tool results directly
   - performs loop detection directly
3. Preserve reactive fallback for provider `context_overflow`.
4. Preserve `agent_start` / `agent_end` outer lifecycle semantics.

#### Notes

- Use the per-turn resolved config's `model.contextWindow`, not `initialConfig.model.contextWindow`, for the compaction threshold.
- Keep compaction at turn-top only; never interrupt running tools.
- Keep one loop detector per `run()` invocation.

#### Acceptance criteria

- A production session can compact between two turns without leaving `runSession()`.
- Turn event ordering remains compatible with current consumers.
- First-turn steering still lands on the correct turn for sync config factories.

### Task 3: `packages/core/src/session/manager.ts` — Remove inner relaying and dead persistence indirection

#### Scope

Delete the now-unnecessary inner-stream relay path and simplify persistence to local direct writes.

#### Required changes

1. Remove the inner `agentLoop()` stream iteration from `runSession()`.
2. Remove `handleEvent()` if no longer used.
3. Replace indirect persistence with direct calls:
   - drained steering messages → `appendMessageEntry(...)`
   - assistant message → `appendMessageEntry(...)`
   - tool results → `appendMessageEntry(...)`
4. Keep `lastApiInputTokens` updates correct after direct assistant persistence.

#### Notes

- Event emission should remain externally equivalent even if persistence is now local.
- Avoid double-appending tool results if the execution helper already mutates `currentMessages`.

#### Acceptance criteria

- `handleEvent()` is removed or clearly reduced to no-op compatibility with no production caller.
- No duplicate message/tool-result persistence occurs.

### Task 4: `packages/core/src/agent/loop.ts`, `packages/core/src/agent/index.ts`, `packages/core/src/index.ts` — Preserve public compatibility

#### Scope

Keep `agentLoop()` as a public API while moving production ownership into `SessionManager`.

#### Required changes

1. Retain exported `agentLoop(messages, config)`.
2. Recompose it from the extracted shared helpers where practical.
3. Update agent/core barrel exports only as needed for newly shared helpers.
4. Do not remove `agentLoop` from public exports.

#### Notes

- This is compatibility work, not a new feature surface.
- Prefer minimal export churn: only export helpers that truly need cross-file reuse.

#### Acceptance criteria

- Direct imports from `../src/agent/loop` still work.
- `@diligent/core` exports remain backward compatible for current tests/e2e.

### Task 5: `packages/core/test/session-manager.test.ts` — Add mid-turn compaction regression coverage

#### Scope

Add tests at the layer where P033 delivers value: `SessionManager`.

#### Required test scenarios

1. **Mid-turn compaction before next LLM call**
   - session starts near threshold
   - first assistant response issues a tool call
   - tool result increases context enough to compact
   - next turn compacts before the next provider request
2. **Compacted context is actually used on the next call**
   - verify the second provider request sees rebuilt messages, not the pre-compaction full history
3. **Reactive overflow fallback still works**
   - provider throws `context_overflow`
   - compaction runs
   - turn retries successfully

#### Suggested assertions

- `compaction_start` and `compaction_end` appear between turn boundaries
- provider call count and order match expected retry/continue behavior
- compacted context is smaller or summary-prefixed as expected

#### Acceptance criteria

- New session-manager tests fail before the implementation and pass after it.
- Coverage proves mid-turn compaction, not just pre-run compaction.

### Task 6: Regression verification for dynamic config and compatibility

#### Scope

Confirm that flattening the production path does not break current contract-heavy behavior.

#### Files to touch only if needed

- `packages/core/test/agent-loop.test.ts`
- `packages/core/test/agent-loop-steering.test.ts`
- `packages/core/test/agent-loop-retry.test.ts`
- `packages/core/test/agent-mode-filter.test.ts`
- `packages/e2e/conversation.test.ts`
- `packages/e2e/mode-and-config.test.ts`

#### Required verification goals

1. `agentLoop()` wrapper still behaves the same for direct callers.
2. Steering tests still validate turn-top injection timing.
3. Retry tests still validate retry and abort behavior.
4. Mode/tool filtering tests still validate prompt/tool selection.
5. E2E mode/config behavior still proves per-turn config refresh semantics.

#### Acceptance criteria

- Existing tests stay green with minimal rewrites.
- No regression appears in mode, effort, retry, or public wrapper behavior.

## Execution order

1. **Task 1** — extract reusable loop primitives first
2. **Task 2** — move production ownership into `SessionManager.runSession()`
3. **Task 3** — remove relay/dead indirection after the new path is stable
4. **Task 4** — finalize wrapper/barrel compatibility
5. **Task 5** — add session-manager regression tests for the new behavior
6. **Task 6** — run/fix compatibility verification on existing tests

## Implementation checkpoints

### Checkpoint A — Helper extraction complete

- `loop.ts` exposes the primitives needed by `SessionManager`
- `agentLoop()` still works

### Checkpoint B — Production flattening complete

- `SessionManager.runSession()` no longer nests `agentLoop()`
- mid-turn compaction is possible in-process

### Checkpoint C — Regression coverage complete

- new session-manager tests prove the new behavior
- compatibility/e2e tests stay green

## Verification

1. `bun test packages/core/test/session-manager.test.ts`
2. `bun test packages/core/test/agent-loop.test.ts`
3. `bun test packages/core/test/agent-loop-steering.test.ts`
4. `bun test packages/core/test/agent-loop-retry.test.ts`
5. `bun test packages/core/test/agent-mode-filter.test.ts`
6. `bun test packages/e2e/conversation.test.ts`
7. `bun test packages/e2e/mode-and-config.test.ts`
8. Manual test: long tool-driven conversation compacts between turns without waiting for provider overflow
9. Manual collab test: registry replacement still streams child events correctly after repeated config resolution

## Risk Areas

| Risk | Mitigation |
|------|------------|
| Stale mode/model/tools/registry after flattening | Resolve config at the top of every turn and derive turn-local resources from that config, not from `initialConfig` |
| Steering timing regression on turn 1 | Preserve the sync path when `agentConfig` resolves synchronously; avoid adding a gratuitous `await` before first `drainSteering()` |
| Public API breakage | Keep `agentLoop()` exported and behaviorally compatible |
| Event ordering drift | Shared helpers still emit the same `AgentEvent` sequence; persistence moves local but stays in event order |
| Compaction interrupts tool execution | Compaction check remains turn-top only |
| Loop-detector scope changes subtly | Be explicit: keep one detector per `run()` invocation and cover expected behavior with tests |
| Collab handler drops after registry replacement | Preserve per-turn config resolution so app-server can continue re-binding to fresh registries |
