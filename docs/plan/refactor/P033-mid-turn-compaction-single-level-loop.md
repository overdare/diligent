---
id: P033
status: pending
created: 2026-03-06
decisions: [D095]
---

# Mid-Turn Compaction: Merge 2-Level Loop into 1-Level Loop

## Context

Compaction currently only triggers at two points:
1. **Proactive** — before `agentLoop` starts (`manager.ts:251-257`)
2. **Reactive** — after `agentLoop` fails with `context_overflow` (`manager.ts:309-313`)

There is **no compaction check between turns** inside `agentLoop`. If a session starts at 60% capacity and the LLM runs many tool-use turns within a single `agentLoop` invocation, tokens can silently exceed the threshold. Compaction doesn't fire until the provider actually rejects the request.

### Root cause: 2-level loop architecture

```
runSession() — outer loop (manager.ts:267)     ← knows compaction
  └─ agentLoop() — inner loop (loop.ts:136)    ← doesn't know compaction
       └─ turn 1: LLM → tools
       └─ turn 2: LLM → tools  ← tokens overflow here, no check
       └─ turn N: ...
```

The inner loop (`runLoop`, lines 136-397) owns `allMessages` as a local array. The outer loop can't inspect or replace it. Compaction lives in the outer loop but the token growth happens in the inner loop.

### How Codex-RS solves this

Codex-RS uses a **single-level loop** in `run_turn()`. After every LLM sampling response, it checks tokens and compacts inline:

```rust
// codex.rs:4744-4771
let total_usage_tokens = sess.get_total_token_usage().await;
if total_usage_tokens >= auto_compact_limit && needs_follow_up {
    run_auto_compact(&sess, &turn_context,
        InitialContextInjection::BeforeLastUserMessage).await;
    continue;
}
```

## Goal

Merge the 2-level loop (`runSession` + `agentLoop`) into a 1-level loop in `SessionManager.runSession()`, so that compaction can trigger **between any two turns**, not only before/after the entire agent loop.

## Non-Goals

- Changing compaction logic itself (`performCompaction`, `shouldCompact`, `generateSummary`)
- Changing the session persistence model or entry types
- Adding Codex-RS style `InitialContextInjection` distinction (future plan)
- Modifying the provider/streaming layer
- Changing how collab/sub-agents work (they go through `SessionManager.run()`)

## D095: Single-Level Agent Loop — SessionManager owns the turn loop

- **Decision**: Inline the agent loop logic (LLM streaming, tool execution, loop detection) directly into `SessionManager.runSession()`, eliminating the separate `agentLoop()` function. This enables compaction checks between any two turns without crossing module boundaries.
- **Rationale**: The 2-level architecture (outer session loop + inner agent loop) was a clean separation when compaction didn't exist. Now compaction needs to inspect and replace messages between turns — exactly where the boundary prevents access. Codex-RS's single-level `run_turn()` demonstrates this is the proven pattern. The existing `agentLoop` has no independent consumers — only `SessionManager` calls it (collab goes through `SessionManager.run()`).
- **Date**: 2026-03-06

## Design

### Before (2-level)

```
SessionManager.runSession()  (manager.ts:241-335)
  ├─ proactive compaction check  (lines 251-257)
  ├─ agent_start event  (line 259)
  ├─ resolveConfig closure  (line 265)
  ├─ while (true):  (line 267)
  │    ├─ resolveAgentConfig()  (lines 566-578: sync/async factory + steering callbacks)
  │    ├─ agentLoop(messages, config)  (loop.ts:119-134 → runLoop:136-397)
  │    │    └─ runLoop: local allMessages, turnCount, maxTurns, LoopDetector
  │    │         ├─ mode filtering (PLAN_MODE_ALLOWED_TOOLS)
  │    │         ├─ permission filtering (filterAllowedTools)
  │    │         ├─ effective system prompt (mode suffix)
  │    │         ├─ retry wrapper setup
  │    │         └─ while (turnCount < max):  (line 185)
  │    │              ├─ drainSteering  (line 196, via config.getSteeringMessages callback)
  │    │              ├─ streamAssistantResponse  (line 199)
  │    │              ├─ executeTools (parallel or sequential)
  │    │              ├─ loop detection  (lines 370-382)
  │    │              └─ check hasPendingMessages  (line 222)
  │    ├─ handleEvent: persist message_end/turn_end/steering_injected  (lines 462-478)
  │    ├─ fatal error → detect context_overflow or abort  (lines 288-305)
  │    ├─ catch ProviderError(context_overflow) → compact  (lines 309-313)
  │    ├─ check signal.aborted → return  (lines 320-322)
  │    └─ check pendingMessages → rebuild context  (lines 324-334)
  └─ end
```

### After (1-level)

```
SessionManager.runSession()
  ├─ agent_start
  ├─ while (turnCount < maxTurns):
  │    ├─ ★ compaction check               ← covers proactive + mid-turn
  │    │    if shouldCompact(lastApiInputTokens):
  │    │      performCompaction()
  │    │      currentMessages = rebuilt
  │    ├─ drainSteering
  │    ├─ streamAssistantResponse          ← inlined from agentLoop
  │    ├─ executeTools                     ← inlined from agentLoop
  │    ├─ check hasPendingMessages
  │    └─ loop detection
  └─ end
```

Single compaction check at loop-top replaces both the pre-loop proactive check and the post-tool mid-turn check:
- **First iteration**: checks initial messages = proactive compaction
- **Subsequent iterations**: checks after previous turn's tool results = mid-turn compaction

### Key change: `allMessages` is now `currentMessages` owned by `runSession()`

- After compaction, `currentMessages` is replaced with the rebuilt context
- The LLM sees compacted history on the very next turn
- No need to exit and re-enter a separate function

## What Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/core/src/session/manager.ts` | MODIFY | Inline agent loop logic into `runSession()` (lines 241-335), remove `handleEvent()` (lines 462-478), add mid-turn compaction check |
| `packages/core/src/agent/loop.ts` | MODIFY | Export shared helpers currently private: `drainSteering` (106-117), `streamAssistantResponse` (399-495), `filterAllowedTools` (23-36), `toolPermission` (15-19). Extract tool execution from `runLoop` (233-368). Keep `agentLoop` as thin `@internal` wrapper |
| `packages/core/src/agent/index.ts` | MODIFY | Add new helper exports (currently only exports `agentLoop`, `LoopDetector`, types, `withPlanStateInjected`, `extractLatestPlanState`) |
| `packages/core/src/index.ts` | MODIFY | Update re-exports if needed (currently re-exports from `agent/index` at lines 127-163) |
| `packages/core/test/agent-loop.test.ts` | MODIFY | Adapt tests to new structure |
| `packages/core/test/agent-loop-steering.test.ts` | MODIFY | Adapt steering tests |
| `packages/core/test/agent-loop-retry.test.ts` | MODIFY | Adapt retry tests |
| `packages/core/test/agent-mode-filter.test.ts` | MODIFY | Adapt mode filter tests |

## What Does NOT Change

- `compaction.ts` — all compaction logic stays as-is (`estimateTokens`, `shouldCompact`, `findRecentUserMessages`, `generateSummary`, `extractFileOperations`)
- `context-builder.ts` — `buildSessionContext()` (lines 22-116) unchanged
- `types.ts` (session) — entry types unchanged
- `persistence.ts` — write logic unchanged
- `collab/registry.ts` — uses `SessionManager.run()`, not `agentLoop()` directly
- `AgentEvent` types — all 15 event types preserved (including collab events)
- `AgentLoopConfig` — interface stays (lines 154-177 in `agent/types.ts`, becomes config for `runSession` internals)
- `agent/types.ts` — `ModeKind`, `PLAN_MODE_ALLOWED_TOOLS`, `MODE_SYSTEM_PROMPT_SUFFIXES` unchanged
- `agent/loop-detector.ts` — `LoopDetector` class unchanged
- Provider/streaming layer — untouched
- e2e tests — use `SessionManager` or real flows, not `agentLoop` directly

## Implementation

### Task 1: Extract reusable helpers from `loop.ts`

Export these currently-private functions from `loop.ts`:

```typescript
// loop.ts — already standalone functions, just need `export` keyword

// Lines 106-117: drains pending steering via config.getSteeringMessages callback
export function drainSteering(
  config: AgentLoopConfig,
  allMessages: Message[],
  stream: EventStream<AgentEvent, Message[]>,
): boolean

// Lines 74-95: already exported
export function withPlanStateInjected(messages: Message[]): Message[]

// Lines 44-64: already exported
export function extractLatestPlanState(messages: Message[]): string | null

// Lines 23-36: removes tools denied by permission engine
export function filterAllowedTools(tools: Tool[], permissionEngine?: PermissionEngine): Tool[]

// Lines 15-19: maps tool name to permission category
export function toolPermission(toolName: string): "read" | "write" | "execute"

// Lines 98-103: converts Error to SerializableError
export function toSerializableError(err: unknown): SerializableError

// Lines 399-495: streams LLM response with plan state injection and delta events
// NEW: needs to be extracted from runLoop scope (currently uses closure variables)
export async function streamAssistantResponse(
  messages: Message[], config: AgentLoopConfig, activeTools: Tool[],
  effectiveSystemPrompt: SystemSection[],
  streamFn: StreamFunction, agentStream: EventStream<AgentEvent, Message[]>,
  generateItemId: () => string,
): Promise<AssistantMessage>

// NEW: extract tool execution from runLoop (lines 233-368)
// Handles both parallel and sequential tool execution paths
export async function executeToolCalls(
  toolCalls: ToolCallBlock[], registry: Map<string, Tool>,
  config: AgentLoopConfig, allMessages: Message[],
  stream: EventStream<AgentEvent, Message[]>, generateItemId: () => string,
): Promise<{ toolResults: ToolResultMessage[]; abortRequested: boolean }>
```

### Task 2: Inline turn loop into `runSession()`

Replace the current `runSession()` body (manager.ts:241-335) with a single-level loop:

```typescript
private async runSession(
  messages: Message[],
  compactionConfig: { enabled: boolean; reservePercent: number; keepRecentTokens: number },
  outerStream: EventStream<AgentEvent, Message[]>,
  initialConfig: AgentLoopConfig,
): Promise<void> {
  let currentMessages = [...messages];
  let turnCount = 0;
  const maxTurns = initialConfig.maxTurns ?? 100;

  outerStream.push({ type: "agent_start" });

  // Setup: tools, system prompt, retry, loop detector (moved from runLoop)
  const activeMode = initialConfig.mode ?? "default";
  const activeTools = filterAllowedTools(
    activeMode === "plan" ? initialConfig.tools.filter(t => PLAN_MODE_ALLOWED_TOOLS.has(t.name)) : initialConfig.tools,
    initialConfig.permissionEngine,
  );
  const registry = new Map(activeTools.map(t => [t.name, t]));
  const effectiveSystemPrompt = /* mode-based prompt building */;
  const retryStreamFn = withRetry(initialConfig.streamFunction, { /* retry config */ });
  const loopDetector = new LoopDetector();
  let itemCounter = 0;
  const generateItemId = () => `item-${++itemCounter}`;

  while (turnCount < maxTurns) {
    if (initialConfig.signal?.aborted) break;

    // ★ UNIFIED COMPACTION CHECK (loop-top)
    // First iteration: proactive check on initial messages
    // Subsequent iterations: mid-turn check after previous turn's tool results
    if (compactionConfig.enabled) {
      const tokens = Math.max(estimateTokens(currentMessages), this.lastApiInputTokens);
      if (shouldCompact(tokens, initialConfig.model.contextWindow, compactionConfig.reservePercent)) {
        currentMessages = await this.performCompaction(tokens, compactionConfig, outerStream, initialConfig);
      }
    }

    turnCount++;

    // Resolve config per-turn (supports dynamic config factory)
    const configResult = this.resolveAgentConfig();
    const config = configResult instanceof Promise ? await configResult : configResult;

    const turnId = `turn-${turnCount}`;
    outerStream.push({ type: "turn_start", turnId });

    // Drain steering
    drainSteering(config, currentMessages, outerStream);

    // Stream LLM response
    let assistantMessage: AssistantMessage;
    try {
      assistantMessage = await streamAssistantResponse(
        currentMessages, config, activeTools, effectiveSystemPrompt,
        retryStreamFn, outerStream, generateItemId,
      );
    } catch (err) {
      // Reactive fallback: provider rejected with context_overflow
      if (isContextOverflow(err) && compactionConfig.enabled) {
        const tokens = Math.max(estimateTokens(currentMessages), this.lastApiInputTokens);
        currentMessages = await this.performCompaction(tokens, compactionConfig, outerStream, initialConfig);
        continue;
      }
      throw err;
    }

    currentMessages.push(assistantMessage);
    this.appendMessageEntry(assistantMessage);
    if (assistantMessage.usage.inputTokens > 0) {
      this.lastApiInputTokens = assistantMessage.usage.inputTokens;
    }

    // Emit usage
    outerStream.push({ type: "usage", usage: assistantMessage.usage, cost: calculateCost(initialConfig.model, assistantMessage.usage) });

    // Execute tool calls
    const toolCalls = assistantMessage.content.filter(b => b.type === "tool_call");

    if (toolCalls.length === 0) {
      const hasPending = config.hasPendingMessages?.() ?? false;
      outerStream.push({ type: "turn_end", turnId, message: assistantMessage, toolResults: [] });
      if (hasPending) continue;
      break;
    }

    const { toolResults, abortRequested } = await executeToolCalls(
      toolCalls, registry, config, currentMessages, outerStream, generateItemId,
    );
    // Persist tool results
    for (const tr of toolResults) this.appendMessageEntry(tr);

    // Loop detection
    for (const tc of toolCalls) loopDetector.record(tc.name, tc.input);
    const loopResult = loopDetector.check();
    if (loopResult.detected) {
      outerStream.push({ type: "loop_detected", patternLength: loopResult.patternLength!, toolName: loopResult.toolName! });
      const warning: Message = { role: "user", content: `[WARNING: Loop detected...]`, timestamp: Date.now() };
      currentMessages.push(warning);
    }

    outerStream.push({ type: "turn_end", turnId, message: assistantMessage, toolResults });

    if (abortRequested) break;
    // → next iteration: loop-top compaction check runs with updated token count
  }

  outerStream.push({ type: "agent_end", messages: currentMessages });
  outerStream.end(currentMessages);
}
```

### Task 3: Update `handleEvent` → direct method calls

Currently `handleEvent` (manager.ts:462-478) processes events from the inner stream, persisting three event types:

- `message_end` → `this.appendMessageEntry(event.message)` + update `lastApiInputTokens` (lines 463-467)
- `turn_end` → `this.appendMessageEntry(toolResult)` for each tool result (lines 468-471)
- `steering_injected` → `this.appendMessageEntry(msg)` for each steering message (lines 472-476)

In the 1-level loop, these persist calls happen inline. The `handleEvent` method and the event-forwarding loop (lines 277-286) become unnecessary.

### Task 4: Handle pending messages (steering continuation)

The current outer loop's pending message check (manager.ts:324-334) and abort guard (lines 320-322) are now part of the single loop. When `hasPendingMessages` is true and no tool calls exist, the loop `continue`s. Steering messages are drained at loop-top via `drainSteering`.

Context rebuild on pending messages:
```typescript
// After processing pending steering messages, rebuild from session entries
// to ensure compacted state is reflected
if (needsContextRebuild) {
  const context = buildSessionContext(this.entries, this.leafId);
  currentMessages = context.messages;
}
```

### Task 5: Adapt tests

**Existing test files** that call `agentLoop()` directly:
- `agent-loop.test.ts` — main loop behavior tests
- `agent-loop-steering.test.ts` — steering injection and pending message peeking
- `agent-loop-retry.test.ts` — retry logic
- `agent-mode-filter.test.ts` — plan/execute mode filtering and system prompt injection
- `loop-detector.test.ts` — loop detection (independent, no changes needed)
- `session-manager.test.ts` — manager integration tests

Two options:
1. **Preferred**: Keep a thin `agentLoop()` wrapper (current lines 119-134) that delegates to extracted helpers, purely for test compatibility
2. **Alternative**: Rewrite tests to use `SessionManager.run()` (higher-level, more realistic)

Recommendation: Option 1 — keep `agentLoop()` as a lightweight composition of the extracted helpers, marked `@internal`. The current implementation (creates EventStream, calls runLoop, catches errors) is already this shape. This preserves all existing test coverage with minimal changes.

```typescript
/** @internal — Thin wrapper for test compatibility. Production code uses SessionManager.runSession(). */
export function agentLoop(messages: Message[], config: AgentLoopConfig): EventStream<AgentEvent, Message[]> {
  // Same implementation as current lines 119-134, composing the extracted helpers
}
```

**New test**: Add `test/mid-turn-compaction.test.ts`:
- Session starts near threshold, LLM does multi-turn tool use
- Verify compaction triggers mid-turn (not only after overflow)
- Verify messages are rebuilt correctly after mid-turn compaction
- Verify LLM sees compacted context on the next turn

### Task 6: Remove dead code

After confirming all tests pass:
- Remove `handleEvent` method from `SessionManager` (replaced by direct calls)
- Clean up any unused imports

## Verification

1. **Unit tests**: `bun test packages/core/test/` — all existing tests pass
2. **New test**: `bun test packages/core/test/mid-turn-compaction.test.ts`
3. **E2E test**: `bun test packages/e2e/` — conversation flows unchanged
4. **Manual test**: Start a session, use tools heavily, observe compaction triggers mid-turn in debug logs (`[Compaction] Rebuilt %d messages...`)
5. **Collab test**: Spawn sub-agent, verify it still compacts correctly

## Risk Areas

| Risk | Mitigation |
|------|-----------|
| Steering timing regression | Preserve sync config resolution path (manager.ts:261-265, `resolveAgentConfig` lines 566-578). Microtask timing is critical: `drainSteering` must run in same synchronous frame as `run()`. Test: `agent-loop-steering.test.ts` |
| Event ordering change | 1-level loop emits same events in same order. Direct persistence calls replace `handleEvent` (lines 462-478) event-ordered writes |
| `agentLoop` removal breaks external consumers | Keep thin `agentLoop` wrapper (lines 119-134) for backward compatibility. Only `SessionManager` uses it in production. `agentLoop` is also re-exported from `core/src/index.ts` |
| Fatal error detection regression | Current fatal error detection (lines 288-305) checks error messages for context overflow keywords — this logic must be preserved in the single-level loop's catch block |
| Abort signal handling | Current abort guard (lines 320-322) prevents re-entering loop with aborted signal. Must be preserved at loop-top |
| Mid-turn compaction during tool execution | Check happens at loop-top (before LLM call), never interrupts a tool |
| Compaction on every iteration overhead | `shouldCompact` is a trivial arithmetic check — negligible cost. `estimateTokens` is O(messages) but fast |
