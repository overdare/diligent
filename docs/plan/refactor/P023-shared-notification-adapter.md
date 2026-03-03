---
id: P023
status: backlog
created: 2026-03-04
---

# Extract shared notification adapter to `@diligent/core`

## Context

Tech-lead review (2026-03-03-4209228, Finding #8) identified notification handling as the highest-compounding duplication. CLI's `ProtocolNotificationAdapter` (175 LOC) and Web's `reduceServerNotification` (260 LOC) independently convert `DiligentServerNotification` → display state. Adding a new notification type requires updating both — and they already diverge (Web handles `steering/injected`, CLI doesn't).

**Goal**: Move `ProtocolNotificationAdapter` to `@diligent/core` so both frontends share the `notification → AgentEvent` mapping. Each frontend keeps only its rendering logic.

## Steps

### 1. Create `packages/core/src/notification-adapter.ts`

Move from `packages/cli/src/tui/rpc-client.ts:18-269`:
- `createEmptyAssistantMessage()` helper
- `ProtocolNotificationAdapter` class

Add to the adapter:
- `steering_injected` case → `{ type: "steering_injected", messageCount }` (currently missing)
- `reset()` method → clears both internal Maps (needed for Web reconnect/hydration)

### 2. Export from `packages/core/src/index.ts`

```typescript
export { ProtocolNotificationAdapter } from "./notification-adapter";
```

### 3. Update CLI imports (minimal change)

**`packages/cli/src/tui/rpc-client.ts`**: Remove `ProtocolNotificationAdapter` class and `createEmptyAssistantMessage`. Keep `LocalAppServerRpcClient`. Import `ProtocolNotificationAdapter` from `@diligent/core`.

**`packages/cli/src/tui/runner.ts`**: Change import from `"./rpc-client"` to `"@diligent/core"` for `ProtocolNotificationAdapter`.

**`packages/cli/src/tui/app.ts`**: No change needed — imports `ProtocolNotificationAdapter` indirectly via rpc-client (verify).

### 4. Rewrite Web notification reducer using adapter

**`packages/web/src/client/App.tsx`**:
- Add `useRef(new ProtocolNotificationAdapter())` for adapter instance
- In `onNotification` callback: generate `AgentEvent[]` via adapter, dispatch both notification and events
- On hydration action: call `adapter.reset()` to clear stale state
- Change action type: `{ type: "notification"; payload: { notification, events } }`

**`packages/web/src/client/lib/thread-store.ts`**:
- Replace `reduceServerNotification(state, notification)` with `reduceServerNotification(state, notification, events)`
- Thread-level handling stays: `thread/started` → set activeThreadId, `thread/resumed` → set activeThreadId, thread filtering
- New `reduceAgentEvent(state, event)` function handles item lifecycle from `AgentEvent`
- Remove all raw notification string literals — they're handled by the adapter
- Keep `hydrateFromThreadRead` unchanged (works from history, not live notifications)
- Keep helper functions: `updateItem`, `stringifyUnknown`, `parsePlanOutput`, `withItem`
- Remove `toProtocolItemKey`, `addSeen` helpers (no longer needed)

### 5. Add tests for shared adapter

**`packages/core/test/notification-adapter.test.ts`**

### 6. Update Web tests

**`packages/web/test/thread-store.test.ts`**

## Files modified

| File | Change |
|------|--------|
| `packages/core/src/notification-adapter.ts` | **NEW** — adapter class moved from CLI |
| `packages/core/src/index.ts` | Add export |
| `packages/core/test/notification-adapter.test.ts` | **NEW** — adapter tests |
| `packages/cli/src/tui/rpc-client.ts` | Remove adapter class, import from core |
| `packages/cli/src/tui/runner.ts` | Update import |
| `packages/web/src/client/App.tsx` | Add adapter ref, change dispatch shape |
| `packages/web/src/client/lib/thread-store.ts` | Rewrite reducer to use AgentEvent, add reduceAgentEvent |
| `packages/web/test/thread-store.test.ts` | Update test setup |
