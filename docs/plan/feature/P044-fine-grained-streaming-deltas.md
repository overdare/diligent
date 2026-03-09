---
id: P044
status: backlog
created: 2026-03-09
decisions: [D093]
---

# P044: Fine-grained Streaming Delta Types

## Goal

Replace the monolithic `item/delta` notification (3 variants) with 6 semantically typed delta notifications, enabling clients to render reasoning, plan steps, tool output, and file changes with distinct UI treatments. Old `item/delta` is removed entirely — no backward compatibility layer.

## Prerequisites

- Existing `item/delta` notification with `ThreadItemDelta` union (messageText, messageThinking, toolOutput) — **implemented**
- `event-mapper.ts` pure function mapping `AgentEvent` → protocol notifications — **implemented**
- `ProtocolNotificationAdapter` reverse-mapping notifications → `AgentEvent` — **implemented**

## Artifact

```
# During turn — text streaming
Server → item/agentMessage/delta       { itemId, delta: "Hello " }

# During turn — thinking
Server → item/reasoning/summaryTextDelta { itemId, delta: "Let me analyze..." }

# During turn — bash tool output
Server → item/toolExecution/outputDelta { itemId, delta: "$ ls\nfile.ts\n" }

# During turn — write/edit tool output
Server → item/fileChange/outputDelta   { itemId, delta: "Wrote 42 lines" }

# During turn — plan tool steps
Server → item/plan/delta              { itemId, delta: "{\"steps\":[...]}" }
```

## Scope

### What changes

| Area | What Changes |
|------|-------------|
| `packages/protocol/src/` | Remove `ITEM_DELTA` + `ThreadItemDelta`, add 6 new notification methods + schemas |
| `packages/core/src/app-server/event-mapper.ts` | Replace unified delta emission with `toolName`-based routing to 6 methods |
| `packages/core/src/notification-adapter.ts` | Replace `item/delta` handler with 6 new notification handlers |
| `packages/core/src/tools/plan.ts` | Add `onUpdate()` streaming for plan steps |
| `packages/web/src/client/` | Remove `item/delta` handling; adapter absorbs change |
| `packages/cli/src/` | No direct changes — adapter absorbs change |

### What does NOT change

- `AgentEvent` internal types (`message_delta`, `tool_update`) — unchanged, only protocol boundary evolves
- `item/started` and `item/completed` notifications — unchanged
- Session persistence format — deltas are ephemeral, not stored
- `InitializeParams/Response` — no capability negotiation needed
- `item/reasoning/textDelta` — type defined but not emitted (placeholder for future OpenAI reasoning models)

## File Manifest

### packages/protocol/src/

| File | Action | Description |
|------|--------|------------|
| `methods.ts` | MODIFY | Remove `ITEM_DELTA`, add 6 new notification method constants |
| `server-notifications.ts` | MODIFY | Remove `ItemDeltaNotificationSchema`, add 6 new schemas, update union |
| `data-model.ts` | MODIFY | Remove `ThreadItemDeltaSchema` and `ThreadItemDelta` type |

### packages/core/src/app-server/

| File | Action | Description |
|------|--------|------------|
| `event-mapper.ts` | MODIFY | Replace `item/delta` emission with `toolName`-based routing |
| `server.ts` | MODIFY | No structural change — `emitFromAgentEvent` passes through |

### packages/core/src/

| File | Action | Description |
|------|--------|------------|
| `notification-adapter.ts` | MODIFY | Replace `item/delta` handler with 6 new method handlers |
| `tools/plan.ts` | MODIFY | Add `onUpdate()` call for streaming |

### packages/web/src/client/

| File | Action | Description |
|------|--------|------------|
| `App.tsx` | MODIFY | Ensure new notification methods routed through adapter (may be automatic via union) |

### Tests

| File | Action | Description |
|------|--------|------------|
| `packages/protocol/src/__tests__/server-notifications.test.ts` | MODIFY | Replace `item/delta` tests with 6 new notification tests |
| `packages/core/src/app-server/__tests__/event-mapper.test.ts` | MODIFY | Update expected output methods |
| `packages/core/src/__tests__/notification-adapter.test.ts` | MODIFY | Update reverse-mapping tests |

## Implementation Tasks

### Task 1: Protocol types — Remove old, add new

**Files:** `methods.ts`, `server-notifications.ts`, `data-model.ts`
**Decisions:** D093

Remove `ITEM_DELTA`, `ItemDeltaNotificationSchema`, `ThreadItemDeltaSchema`. Add 6 new methods and schemas.

```typescript
// methods.ts
export const DILIGENT_SERVER_NOTIFICATION_METHODS = {
  // ... existing (minus ITEM_DELTA)
  ITEM_AGENT_MESSAGE_DELTA: "item/agentMessage/delta",
  ITEM_REASONING_SUMMARY_TEXT_DELTA: "item/reasoning/summaryTextDelta",
  ITEM_REASONING_TEXT_DELTA: "item/reasoning/textDelta",
  ITEM_PLAN_DELTA: "item/plan/delta",
  ITEM_TOOL_EXECUTION_OUTPUT_DELTA: "item/toolExecution/outputDelta",
  ITEM_FILE_CHANGE_OUTPUT_DELTA: "item/fileChange/outputDelta",
} as const;
```

```typescript
// server-notifications.ts — shared base for all v2 deltas
const V2DeltaBaseParams = {
  threadId: z.string(),
  turnId: z.string(),
  itemId: z.string(),
  delta: z.string(),
  childThreadId: z.string().optional(),
  nickname: z.string().optional(),
  ...ThreadStatusSnapshotFields,
};

export const AgentMessageDeltaNotificationSchema = z.object({
  method: z.literal(DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_AGENT_MESSAGE_DELTA),
  params: z.object(V2DeltaBaseParams),
});

export const ReasoningSummaryTextDeltaNotificationSchema = z.object({
  method: z.literal(DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_REASONING_SUMMARY_TEXT_DELTA),
  params: z.object(V2DeltaBaseParams),
});

export const ReasoningTextDeltaNotificationSchema = z.object({
  method: z.literal(DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_REASONING_TEXT_DELTA),
  params: z.object(V2DeltaBaseParams),
});

export const PlanDeltaNotificationSchema = z.object({
  method: z.literal(DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_PLAN_DELTA),
  params: z.object(V2DeltaBaseParams),
});

export const ToolExecutionOutputDeltaNotificationSchema = z.object({
  method: z.literal(DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_TOOL_EXECUTION_OUTPUT_DELTA),
  params: z.object(V2DeltaBaseParams),
});

export const FileChangeOutputDeltaNotificationSchema = z.object({
  method: z.literal(DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_FILE_CHANGE_OUTPUT_DELTA),
  params: z.object(V2DeltaBaseParams),
});
```

All 6 share identical params shape — `delta` is a flat `string`. The **method name itself** carries the semantic type. Simpler than the old nested union approach.

```typescript
// data-model.ts — remove ThreadItemDeltaSchema entirely
// (was: z.union of messageText | messageThinking | toolOutput)
```

**Verify:** `bun test packages/protocol` — new schemas parse; old references removed.

### Task 2: Event mapper — Direct routing by tool name

**Files:** `packages/core/src/app-server/event-mapper.ts`
**Decisions:** D093

Replace unified `item/delta` emission with direct method-per-type routing.

```typescript
const FILE_CHANGE_TOOLS = new Set(["write", "apply_patch"]);

// message_delta case
case "message_delta": {
  const method = event.delta.type === "text_delta"
    ? DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_AGENT_MESSAGE_DELTA
    : DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_REASONING_SUMMARY_TEXT_DELTA;
  return {
    method,
    params: withThreadStatus({
      threadId, turnId,
      itemId: event.itemId,
      delta: event.delta.delta,
    }, context),
  };
}

// tool_update case
case "tool_update": {
  let method: string;
  if (event.toolName === "plan") {
    method = DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_PLAN_DELTA;
  } else if (FILE_CHANGE_TOOLS.has(event.toolName)) {
    method = DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_FILE_CHANGE_OUTPUT_DELTA;
  } else {
    method = DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_TOOL_EXECUTION_OUTPUT_DELTA;
  }
  return {
    method,
    params: withThreadStatus({
      threadId, turnId,
      itemId: event.itemId,
      delta: event.partialResult,
      ...(event.childThreadId ? { childThreadId: event.childThreadId, nickname: event.nickname } : {}),
    }, context),
  };
}
```

No v1/v2 branching — always emits the new methods.

**Verify:** Unit tests assert correct method names per event type + tool name.

### Task 3: Plan tool — Add onUpdate streaming

**Files:** `packages/core/src/tools/plan.ts`
**Decisions:** D093

```typescript
async execute(args: PlanArgs, ctx: ToolContext): Promise<ToolResult> {
  const planPayload = JSON.stringify({
    title: args.title,
    steps: args.steps.map(s => ({
      text: s.text,
      status: s.status ?? "pending",
    })),
    ...(args.close ? { close: true } : {}),
  });

  // Stream so it flows through item/plan/delta
  ctx.onUpdate?.(planPayload);

  return { output: planPayload };
}
```

The agent loop sets `toolName: "plan"` on `tool_update` events, which the event mapper routes to `item/plan/delta`.

**Verify:** Plan tool execution produces `item/plan/delta` notification.

### Task 4: Notification adapter — Handle 6 new methods

**Files:** `packages/core/src/notification-adapter.ts`
**Decisions:** D093

Replace the single `item/delta` handler with 6 method-specific handlers. All convert back to the same `AgentEvent` types — downstream client code unchanged.

```typescript
case DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_AGENT_MESSAGE_DELTA: {
  const { itemId, delta } = notification.params;
  const message = this.getOrCreateMessage(itemId);
  return [{
    type: "message_delta", itemId, message,
    delta: { type: "text_delta", delta },
  }];
}

case DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_REASONING_SUMMARY_TEXT_DELTA: {
  const { itemId, delta } = notification.params;
  const message = this.getOrCreateMessage(itemId);
  return [{
    type: "message_delta", itemId, message,
    delta: { type: "thinking_delta", delta },
  }];
}

case DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_PLAN_DELTA:
case DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_TOOL_EXECUTION_OUTPUT_DELTA:
case DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_FILE_CHANGE_OUTPUT_DELTA: {
  const { itemId, delta, childThreadId, nickname } = notification.params;
  return [{
    type: "tool_update", itemId,
    toolCallId: this.getToolCallId(itemId) ?? itemId,
    toolName: this.getToolName(itemId) ?? "unknown",
    partialResult: delta,
    ...(childThreadId ? { childThreadId, nickname } : {}),
  }];
}

case DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_REASONING_TEXT_DELTA:
  return []; // placeholder — no emission yet
```

**Key**: Because the adapter converts v2 notifications back to `message_delta`/`tool_update` AgentEvents, **Web thread-store reducer and TUI handlers need zero changes**.

**Verify:** Unit tests — each new method produces correct AgentEvent.

### Task 5: Clean up references + update notification union

**Files:** `server-notifications.ts`, any imports of `ThreadItemDelta`/`ItemDeltaNotification`
**Decisions:** D093

1. Update `DiligentServerNotificationSchema` union — remove `ItemDeltaNotificationSchema`, add 6 new schemas
2. Remove all imports of `ThreadItemDelta`, `ThreadItemDeltaSchema`, `ItemDeltaNotification` across the codebase
3. Update `App.tsx` if it explicitly checks for `item/delta` method name

```typescript
// server-notifications.ts
export const DiligentServerNotificationSchema = z.union([
  // ... existing (minus ItemDeltaNotificationSchema)
  AgentMessageDeltaNotificationSchema,
  ReasoningSummaryTextDeltaNotificationSchema,
  ReasoningTextDeltaNotificationSchema,
  PlanDeltaNotificationSchema,
  ToolExecutionOutputDeltaNotificationSchema,
  FileChangeOutputDeltaNotificationSchema,
]);
```

**Verify:** `bun run typecheck` — no dangling references. `bun test` — all green.

### Task 6: Tests

**Files:** test files listed in File Manifest

1. **Protocol parse tests**: Each new notification schema parses valid JSON and rejects invalid
2. **Event mapper tests**: `message_delta(text_delta)` → `item/agentMessage/delta`, `tool_update(bash)` → `item/toolExecution/outputDelta`, `tool_update(write)` → `item/fileChange/outputDelta`, `tool_update(plan)` → `item/plan/delta`
3. **Notification adapter round-trip**: Each new method → correct `AgentEvent` type

**Verify:** `bun test` — all green.

## Acceptance Criteria

1. `bun test` — all tests pass
2. `bun run typecheck` passes
3. Old `item/delta` method, `ThreadItemDelta` type, `ItemDeltaNotification` schema removed entirely
4. `message_delta(text_delta)` → `item/agentMessage/delta`
5. `message_delta(thinking_delta)` → `item/reasoning/summaryTextDelta`
6. `tool_update` where `toolName === "plan"` → `item/plan/delta`
7. `tool_update` where `toolName ∈ {"write", "apply_patch"}` → `item/fileChange/outputDelta`
8. `tool_update` (all other tools) → `item/toolExecution/outputDelta`
9. Plan tool emits streaming update via `onUpdate()`
10. Web and TUI render identically — adapter absorbs protocol change
11. No `any` type escape hatches in new code

## Testing Strategy

| Category | What to Test | How |
|----------|-------------|-----|
| Unit | Protocol schema parsing (6 new notifications) | `bun test packages/protocol` |
| Unit | Event mapper routing by event type + tool name | `bun test packages/core` with mock events |
| Unit | Notification adapter reverse-mapping | `bun test packages/core` |
| Manual | Web client renders correctly | Start web, observe streaming |
| Manual | TUI client renders correctly | Run TUI, observe output |

## Risk Areas

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Missed `item/delta` reference somewhere in codebase | Compile error or runtime unknown notification | `bun run typecheck` + grep for `ITEM_DELTA` and `item/delta` |
| Plan tool `onUpdate` called but no `tool_start` emitted yet | Client can't find item slot for delta | Plan tool already emits `tool_start` via agent loop; `onUpdate` occurs after |
| `toolName` not available in `tool_update` event | Can't route to correct delta type | Verified: `toolName` present (set in `loop.ts`) |

## Decisions Referenced

| ID | Summary | Where Used |
|----|---------|------------|
| D093 | Fine-grained streaming delta types | All tasks — new methods, routing, plan streaming, adapter |
| D004 | AgentEvent tagged union | Task 2 — internal events unchanged, only protocol evolves |
| D086 | Codex protocol alignment | Overall — aligning delta granularity with codex-rs patterns |
